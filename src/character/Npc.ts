import * as THREE from 'three';
import { buildPerson, type Look } from './people';
import type { NpcDef } from '../level/sections/types';
import type { Game } from '../game/Game';
import type { Director } from '../game/Director';

export type NpcId = 'odette' | 'yaw' | 'bas' | 'nef' | 'kwame' | 'merit';

const LOOKS: Record<NpcId, Look> = {
  // Odette: dockmaster, sixties, grey locs under a teal wrap, long coat with a reflective stripe.
  odette: { skin: 0x5a3a28, top: 0x1f4f5a, trim: 0xe08a2a, shirt: 0xd8cbb0, pants: 0x2a2a30, hair: 0x9a9a9a, wrap: 0x2a8a86, hairStyle: 'wrap', height: 1.66, build: 1.05, outfit: 'coat', accent: 0xd4a640, prop: 'tablet', glowTrim: true },
  // Yaw: bartender, late twenties, black vest, white shirt, gold tie.
  yaw: { skin: 0x4a2e20, top: 0x1a1a1e, trim: 0xd4a640, shirt: 0xe8e4dc, pants: 0x202024, hair: 0x15100c, hairStyle: 'short', height: 1.8, build: 1.0, outfit: 'vest', accent: 0xd4a640 },
  // Bas: retired dome diver, seventies, grey beard, old teal diving jacket, gold earring.
  bas: { skin: 0x3a2418, top: 0x24525e, trim: 0xd4a640, shirt: 0x8a8070, pants: 0x2a2a30, hair: 0xb0b0a8, beard: 0xc8c8c0, hairStyle: 'short', height: 1.76, build: 1.08, outfit: 'jacket', accent: 0xd4a640 },
  // Auntie Nef: noodle stall, fifties, orange head wrap, apron over a print dress, ladle.
  nef: { skin: 0x5a3a28, top: 0xe8dcc0, trim: 0xb45a28, shirt: 0x7a2a5a, pants: 0x7a2a5a, hair: 0x15100c, wrap: 0xe07a20, hairStyle: 'wrap', height: 1.6, build: 1.2, outfit: 'apron', accent: 0xc0c0c0, prop: 'ladle' },
  // Kwame: implant tech, thirties, orange work jumpsuit, goggles up on the forehead.
  kwame: { skin: 0x3a2418, top: 0xb45a28, trim: 0x2a2a30, shirt: 0x2a2a30, pants: 0x2a2a30, hair: 0x0e0a08, hairStyle: 'short', height: 1.82, build: 1.0, outfit: 'jumpsuit', accent: 0xd4a640, goggles: true, prop: 'tool' },
  // Sister Merit: priestess of Hathor, white linen robe, gold collar, black bob with a gold band.
  merit: { skin: 0x6e4630, top: 0xe8e4d4, trim: 0xd4a640, shirt: 0xe8e4d4, pants: 0xe8e4d4, hair: 0x0e0a08, hairStyle: 'bob', height: 1.72, build: 0.95, outfit: 'robe', accent: 0xd4a640, collar: true, prop: 'lamp' },
};

/** A talkable character standing in the level. */
export class Npc {
  readonly root = new THREE.Group();
  readonly position: THREE.Vector3;
  private readonly bones: Record<string, THREE.Bone>;
  private readonly baseYaw: number;
  private time = Math.random() * 10;
  private talking = false;
  private lookTarget: THREE.Vector3 | null = null;
  private gone = false;
  private leaving = 0;
  private readonly headTmp = new THREE.Vector3();
  height: number;

  constructor(private readonly game: Game, readonly def: NpcDef) {
    const look = LOOKS[def.id];
    const { mesh, bones } = buildPerson(look);
    this.bones = bones;
    this.height = look.height;
    this.root.add(mesh);
    this.position = new THREE.Vector3(def.x, def.y, def.z);
    this.root.position.copy(this.position);
    this.baseYaw = def.yaw;
    this.root.rotation.y = def.yaw + Math.PI;
    game.scene.add(this.root);
    // A soft key light so faces read in close-ups.
    void this.game;
  }

  canTalk(d: Director): boolean {
    if (this.gone || this.leaving > 0 || this.game.state !== 'playing' || this.talked) return false;
    return this.def.available ? this.def.available(d) : true;
  }

  private talked = false;

  markTalked(): void {
    this.talked = true;
  }

  reset(): void {
    if (this.leaving > 0 && !this.gone) this.leaving = 0;
  }

  leave(): void {
    this.leaving = 0.001;
  }

  setTalking(t: boolean): void {
    this.talking = t;
  }

  lookAt(p: THREE.Vector3 | null): void {
    this.lookTarget = p ? p.clone() : null;
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.bones.head.updateWorldMatrix(true, false);
    return out.set(0, 0.11, 0.02).applyMatrix4(this.bones.head.matrixWorld);
  }

  update(dt: number): void {
    if (this.gone) return;
    this.time += dt;
    const B = this.bones;
    if (this.leaving > 0) {
      this.leaving += dt;
      // Walk away toward the club entrance and vanish.
      const dir = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      this.root.position.addScaledVector(dir, dt * 1.3);
      this.root.rotation.y += (Math.atan2(0 - this.root.position.x, -150 - this.root.position.z) - this.root.rotation.y) * Math.min(1, dt * 2);
      const ph = this.time * 6;
      B.thighL.rotation.x = Math.sin(ph) * 0.4;
      B.thighR.rotation.x = -Math.sin(ph) * 0.4;
      if (this.leaving > 6) {
        this.gone = true;
        this.root.visible = false;
      }
      return;
    }
    // Idle: breathing, weight shift, small gestures while talking.
    const t = this.time;
    B.spine.rotation.x = Math.sin(t * 1.6) * 0.012;
    B.chest.rotation.x = Math.sin(t * 1.6 + 0.4) * 0.015;
    B.hips.rotation.z = Math.sin(t * 0.35) * 0.025;
    B.upperArmL.rotation.z = -0.08;
    B.upperArmR.rotation.z = 0.08;
    const id = this.def.id;
    B.foreArmL.rotation.x = id === 'odette' ? -1.1 : id === 'merit' ? -1.3 : -0.25;
    B.foreArmR.rotation.x = id === 'yaw' ? -0.5 : -0.15;
    B.upperArmL.rotation.x = id === 'odette' ? -0.25 : id === 'merit' ? -0.35 : 0;
    if (id === 'nef' && !this.talking) {
      // Stirring the pot.
      B.upperArmR.rotation.x = -0.55 + Math.sin(t * 2.4) * 0.12;
      B.upperArmR.rotation.z = 0.15 + Math.cos(t * 2.4) * 0.12;
      B.foreArmR.rotation.x = -0.9;
    }
    if (id === 'kwame' && !this.talking) {
      // Fiddling with an implant on the bench.
      B.upperArmR.rotation.x = -0.7;
      B.foreArmR.rotation.x = -0.9 + Math.sin(t * 7) * 0.06;
      B.upperArmL.rotation.x = -0.6;
      B.foreArmL.rotation.x = -1.0;
      B.spine.rotation.x += 0.18;
      B.neck.rotation.x = 0.25;
    }
    if (id === 'bas') {
      // Hands clasped behind his back.
      B.upperArmL.rotation.x = 0.35;
      B.upperArmR.rotation.x = 0.35;
      B.foreArmL.rotation.x = -0.6;
      B.foreArmR.rotation.x = -0.6;
    }
    if (this.talking) {
      B.jaw.rotation.x = Math.max(0, Math.sin(t * 13) * Math.sin(t * 5.3)) * 0.18;
      B.foreArmR.rotation.x = -0.6 - Math.max(0, Math.sin(t * 2.1)) * 0.5;
      B.upperArmR.rotation.x = -0.2 - Math.max(0, Math.sin(t * 2.1)) * 0.2;
    } else {
      B.jaw.rotation.x = 0;
    }
    // In conversation the whole body turns to face her; otherwise back to the post.
    let wantYaw = this.baseYaw + Math.PI;
    if (this.lookTarget) wantYaw = Math.atan2(this.lookTarget.x - this.root.position.x, this.lookTarget.z - this.root.position.z);
    let turn = wantYaw - this.root.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.root.rotation.y += THREE.MathUtils.clamp(turn, -dt * 3, dt * 3);
    // Head turns toward the player when close, or toward the dialogue target.
    let target = this.lookTarget;
    const p = this.game.player.position;
    if (!target && p.distanceTo(this.position) < 6) target = this.headTmp.set(p.x, p.y + 1.55, p.z);
    let yawT = 0;
    let pitchT = 0;
    if (target) {
      this.headWorld(_h);
      const dx = target.x - _h.x;
      const dz = target.z - _h.z;
      const world = Math.atan2(dx, dz);
      let rel = world - this.root.rotation.y;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      yawT = THREE.MathUtils.clamp(rel, -1.1, 1.1);
      pitchT = THREE.MathUtils.clamp(-Math.atan2(target.y - _h.y, Math.hypot(dx, dz)), -0.5, 0.5);
    }
    B.neck.rotation.y += (yawT * 0.4 - B.neck.rotation.y) * Math.min(1, dt * 4);
    B.head.rotation.y += (yawT * 0.6 - B.head.rotation.y) * Math.min(1, dt * 4);
    B.head.rotation.x += (pitchT - B.head.rotation.x) * Math.min(1, dt * 4);
  }
}

const _h = new THREE.Vector3();
