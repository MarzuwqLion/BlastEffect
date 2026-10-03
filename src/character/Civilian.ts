import * as THREE from 'three';
import { MASK } from '../core/Physics';
import { globalUniforms } from '../render/materials';
import type { Game } from '../game/Game';
import { buildCivilian } from './people';

export type CivilianMood = 'wander' | 'chat' | 'kneel' | 'sit' | 'dance';

export interface CrowdDef {
  /** Area they move around in: [x0, z0, x1, z1] at floor height y. */
  area: [number, number, number, number];
  y: number;
  count: number;
  seed: number;
  mood?: CivilianMood;
  /** Exact spots (bar stools); person i takes spot i. Without it they're spread over `area`. */
  spots?: [number, number][];
  /** Facing for people who stay put (kneeling at the altar, sitting at the bar); random otherwise. */
  face?: number;
  /** Where they run to when a fight starts nearby (then they're gone). Without it they duck where they stand. */
  flee?: [number, number, number];
}

type State = 'idle' | 'walk' | 'flee' | 'cower' | 'gone';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/**
 * A resident of the Reach: wanders, chats, kneels at the shrine. When the
 * shooting starts they either run for an exit or duck and cover their heads,
 * and get up again once it's over. Visual only (no collision), cheap to run.
 */
export class Civilian {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  private readonly bones: Record<string, THREE.Bone>;
  private state: State = 'idle';
  private stateT = 0;
  private readonly target = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;
  private phase = Math.random() * 10;
  private time = Math.random() * 10;
  private wait = 0;
  private fade = 1;
  private readonly home = new THREE.Vector3();
  /** Placed again on the first update, once the physics queries can see the level. */
  private needsPlace = true;

  constructor(private readonly game: Game, readonly def: CrowdDef, readonly section: number, private readonly index: number, parent: THREE.Object3D) {
    const { mesh, bones } = buildCivilian(def.seed * 31 + index);
    this.bones = bones;
    this.root.add(mesh);
    // In the section's group: hidden with the rest of the section.
    parent.add(this.root);
    this.reset(index);
  }

  /** Back to a starting spot (level start, checkpoint reload). */
  reset(index = this.index): void {
    const [x0, z0, x1, z1] = this.def.area;
    const r = (n: number): number => ((Math.sin((this.def.seed + index) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    // A free spot (not inside a stall or the fountain).
    const spot = this.def.spots?.[index % this.def.spots.length];
    if (spot) this.position.set(spot[0], this.def.y, spot[1]);
    else for (let k = 0; k < 10; k++) {
      this.position.set(x0 + (x1 - x0) * r(1 + k * 5), this.def.y, z0 + (z1 - z0) * r(2 + k * 5));
      let hit = false;
      this.game.physics.overlapSphere(_v3.copy(this.position).setY(this.def.y + 0.9), 0.45, MASK.world, () => (hit = true));
      if (!hit) break;
    }
    this.home.copy(this.position);
    this.yaw = this.def.face !== undefined ? this.def.face + (r(3) - 0.5) * 0.5 : r(3) * Math.PI * 2;
    this.state = 'idle';
    this.stateT = 0;
    this.wait = 1 + r(4) * 5;
    this.fade = 1;
    this.root.visible = true;
    this.sync();
  }

  get gone(): boolean {
    return this.state === 'gone';
  }

  /** A fight started (true) or ended (false) in this civilian's section. */
  alarm(on: boolean): void {
    if (this.state === 'gone') return;
    if (on) {
      if (this.def.flee) {
        this.state = 'flee';
        this.target.set(...this.def.flee);
      } else {
        this.state = 'cower';
      }
      this.stateT = 0;
    } else if (this.state === 'cower') {
      this.state = 'idle';
      this.wait = 2 + Math.random() * 3;
      this.stateT = 0;
    }
  }

  private pickTarget(): boolean {
    const [x0, z0, x1, z1] = this.def.area;
    for (let i = 0; i < 6; i++) {
      _v.set(x0 + Math.random() * (x1 - x0), this.def.y, z0 + Math.random() * (z1 - z0));
      const d = _v.distanceTo(this.position);
      if (d < 2) continue;
      // Keep a clear line at knee height so they don't walk through stalls.
      _v2.copy(_v).sub(this.position).normalize();
      const from = _v3.copy(this.position).setY(this.def.y + 0.5);
      if (this.game.physics.raycast(from, _v2, d, MASK.world, this.game.scratchHit)) continue;
      this.target.copy(_v);
      return true;
    }
    return false;
  }

  update(dt: number, camera: THREE.Vector3): void {
    if (this.needsPlace) {
      this.needsPlace = false;
      this.reset(this.index);
    }
    if (this.state === 'gone') return;
    this.stateT += dt;
    this.time += dt;
    const mood = this.def.mood ?? 'wander';
    let wantSpeed = 0;
    switch (this.state) {
      case 'idle':
        this.wait -= dt;
        if (this.wait <= 0 && mood === 'wander') {
          if (this.pickTarget()) {
            this.state = 'walk';
            this.stateT = 0;
          } else {
            this.wait = 2;
          }
        }
        break;
      case 'walk': {
        wantSpeed = 1.25;
        const dx = this.target.x - this.position.x;
        const dz = this.target.z - this.position.z;
        if (Math.hypot(dx, dz) < 0.4 || this.stateT > 20) {
          this.state = 'idle';
          this.wait = 2 + Math.random() * 6;
        } else {
          this.turnTo(Math.atan2(dx, dz), dt, 4);
        }
        break;
      }
      case 'flee': {
        wantSpeed = 4.6;
        const dx = this.target.x - this.position.x;
        const dz = this.target.z - this.position.z;
        this.turnTo(Math.atan2(dx, dz), dt, 9);
        if (Math.hypot(dx, dz) < 1 || this.stateT > 9) {
          this.fade -= dt * 2;
          if (this.fade <= 0) {
            this.state = 'gone';
            this.root.visible = false;
            return;
          }
        }
        break;
      }
      case 'cower':
        break;
    }
    this.speed += (wantSpeed - this.speed) * Math.min(1, dt * 5);
    this.position.x += Math.sin(this.yaw) * this.speed * dt;
    this.position.z += Math.cos(this.yaw) * this.speed * dt;
    this.sync();
    // Animate (and draw) only when someone could see it.
    const near = camera.distanceToSquared(this.position) < 60 * 60;
    this.root.visible = near;
    if (near) this.pose(dt, mood);
  }

  private turnTo(want: number, dt: number, rate: number): void {
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  private sync(): void {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
  }

  private pose(dt: number, mood: CivilianMood): void {
    const B = this.bones;
    const t = this.time;
    for (const k in B) B[k].rotation.set(0, 0, 0);
    const run = this.state === 'flee';
    const moving = this.speed > 0.2;
    this.phase += this.speed * dt * (run ? 2.6 : 3.4);
    const sw = Math.sin(this.phase);
    const amp = moving ? Math.min(1, this.speed / 1.3) * (run ? 0.85 : 0.45) : 0;
    B.thighL.rotation.x = sw * amp;
    B.thighR.rotation.x = -sw * amp;
    B.shinL.rotation.x = Math.max(0, -Math.cos(this.phase)) * amp * 1.4;
    B.shinR.rotation.x = Math.max(0, Math.cos(this.phase)) * amp * 1.4;
    B.upperArmL.rotation.x = -sw * amp * 0.8;
    B.upperArmR.rotation.x = sw * amp * 0.8;
    B.upperArmL.rotation.z = -0.08;
    B.upperArmR.rotation.z = 0.08;
    B.foreArmL.rotation.x = run ? -1.2 : -0.2;
    B.foreArmR.rotation.x = run ? -1.2 : -0.2;
    B.spine.rotation.x = run ? 0.25 : Math.sin(t * 1.6) * 0.012;
    if (!moving) {
      B.hips.rotation.z = Math.sin(t * 0.4) * 0.03;
      B.neck.rotation.y = Math.sin(t * 0.3) * 0.5;
      if (mood === 'chat' && this.state === 'idle') {
        // Talking with their hands.
        const g = Math.max(0, Math.sin(t * 1.7));
        B.upperArmR.rotation.x = -0.3 - g * 0.4;
        B.foreArmR.rotation.x = -0.9 - g * 0.3;
        B.jaw.rotation.x = Math.max(0, Math.sin(t * 11) * Math.sin(t * 4.1)) * 0.15;
      }
      if (mood === 'kneel' && this.state === 'idle') {
        B.thighL.rotation.x = -1.5;
        B.shinL.rotation.x = 1.6;
        B.thighR.rotation.x = 0.1;
        B.shinR.rotation.x = 2.2;
        B.spine.rotation.x = 0.35 + Math.sin(t * 0.8) * 0.05;
        B.upperArmL.rotation.x = -0.9;
        B.upperArmR.rotation.x = -0.9;
        B.foreArmL.rotation.x = -1.4;
        B.foreArmR.rotation.x = -1.4;
        this.root.position.y = this.position.y - 0.45;
      }
      if (mood === 'dance' && this.state === 'idle') {
        // On the beat (the club track is ~112 bpm), each with their own move.
        const beat = (globalUniforms.uTime.value as number) * Math.PI * 2 * 1.87;
        const style = Math.floor(this.phase * 7) % 3;
        const bob = Math.abs(Math.sin(beat / 2));
        this.root.position.y = this.position.y - bob * 0.07;
        B.thighL.rotation.x = -bob * 0.25;
        B.thighR.rotation.x = -bob * 0.25;
        B.shinL.rotation.x = bob * 0.45;
        B.shinR.rotation.x = bob * 0.45;
        B.spine.rotation.z = Math.sin(beat / 4) * 0.12;
        B.hips.rotation.y = Math.sin(beat / 4) * 0.25;
        if (style === 0) {
          // Hands up.
          B.upperArmL.rotation.x = -2.7 + Math.sin(beat / 2) * 0.2;
          B.upperArmR.rotation.x = -2.7 - Math.sin(beat / 2) * 0.2;
          B.foreArmL.rotation.x = -0.3;
          B.foreArmR.rotation.x = -0.3;
        } else if (style === 1) {
          // Elbows in, shoulders rolling.
          B.upperArmL.rotation.x = -0.5 + Math.sin(beat / 2) * 0.3;
          B.upperArmR.rotation.x = -0.5 - Math.sin(beat / 2) * 0.3;
          B.foreArmL.rotation.x = -1.6;
          B.foreArmR.rotation.x = -1.6;
        } else {
          // One arm pointing up on the beat.
          B.upperArmR.rotation.x = -2.2 - bob * 0.5;
          B.upperArmR.rotation.z = 0.3;
          B.upperArmL.rotation.x = -0.4;
          B.foreArmL.rotation.x = -1.3;
        }
        B.neck.rotation.x = bob * 0.2;
        B.neck.rotation.y = 0;
      }
      if (mood === 'sit' && this.state === 'idle') {
        B.thighL.rotation.x = -1.5;
        B.thighR.rotation.x = -1.5;
        B.shinL.rotation.x = 1.5;
        B.shinR.rotation.x = 1.5;
        this.root.position.y = this.position.y - 0.42;
      }
    }
    if (this.state === 'cower') {
      // Ducked, hands over the head.
      const c = Math.min(1, this.stateT * 4);
      B.thighL.rotation.x = -1.7 * c;
      B.thighR.rotation.x = -1.7 * c;
      B.shinL.rotation.x = 2.2 * c;
      B.shinR.rotation.x = 2.2 * c;
      B.spine.rotation.x = 0.6 * c;
      B.upperArmL.rotation.x = -2.6 * c;
      B.upperArmR.rotation.x = -2.6 * c;
      B.foreArmL.rotation.x = -1.6 * c;
      B.foreArmR.rotation.x = -1.6 * c;
      B.upperArmL.rotation.z = -0.4 * c;
      B.upperArmR.rotation.z = 0.4 * c;
      this.root.position.y = this.position.y - 0.62 * c + Math.sin(t * 20) * 0.004;
    }
    if (this.fade < 1) this.root.scale.setScalar(Math.max(0.01, this.fade));
  }
}
