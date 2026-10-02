import * as THREE from 'three';
import { RigBuilder, paletteMaterial, roundedBox, limb, ellipsoid, capsule, type PaletteEntry } from '../character/rigKit';
import type { EnemyVisual, PoseParams } from './EnemyModel';

/** Boss actions the model can pose. */
export type BossAction = 'none' | 'volley' | 'slam' | 'drag' | 'lunge' | 'orbs' | 'roar' | 'channel' | 'downed' | 'stagger';

const P = { SCALE: 0, PLATE: 1, GOLD: 2, LINEN: 3, DARK: 4, KA: 5, EYE: 6, TEETH: 7, LAPIS: 8, CABLE: 9 } as const;

const PALETTE: PaletteEntry[] = [
  { color: 0xffffff, roughness: 0.5, metalness: 0.3, camo: 1 }, // scale pattern (green base)
  { color: 0xffffff, roughness: 0.38, metalness: 0.55, camo: 2 }, // bronze plates
  { color: 0xd4a640, roughness: 0.28, metalness: 0.95 },
  { color: 0xa89878, roughness: 0.85, metalness: 0 },
  { color: 0x121413, roughness: 0.6, metalness: 0.3 },
  { color: 0x40ff9a, roughness: 0.3, metalness: 0, emissive: 1.2 },
  { color: 0xa0ff70, roughness: 0.2, metalness: 0, emissive: 2.5 },
  { color: 0xe6dcc0, roughness: 0.4, metalness: 0 },
  { color: 0x2442a0, roughness: 0.35, metalness: 0.2 },
  { color: 0x1a1d1c, roughness: 0.7, metalness: 0.1 },
];

const K = 1.6;

/**
 * The Crocodile: a 2.9 m armoured figure in a crocodile helm with a gold
 * usekh collar, linen kilt and a short armoured tail. Stolen ka-amps feed a
 * glowing reservoir between his shoulders (the weak point) through cables
 * running down his arms. Posed procedurally per action.
 */
export class BossModel implements EnemyVisual {
  readonly root = new THREE.Group();
  readonly weakLocal = new THREE.Vector3(0, 0, 0);
  private readonly B: Record<string, THREE.Bone> = {};
  private readonly material: THREE.MeshStandardMaterial;
  private readonly hipsBind = new THREE.Vector3();
  private phase = 0;
  private time = 0;
  private recoil = 0;
  private hitReact = 0;
  private hitSide = 1;
  action: BossAction = 'none';
  actionT = 0;
  talking = false;
  /** 0..1 how bright the stolen ka glows (rises with phase). */
  kaLevel = 0.5;

  constructor() {
    const rig = new RigBuilder();
    rig.bone('hips', 'root', 0, 0.98 * K, 0);
    rig.bone('spine', 'hips', 0, 0.14 * K, 0);
    rig.bone('chest', 'spine', 0, 0.22 * K, 0);
    rig.bone('neck', 'chest', 0, 0.22 * K, 0.02);
    rig.bone('head', 'neck', 0, 0.09 * K, 0.02);
    rig.bone('jaw', 'head', 0, 0.02 * K, 0.06 * K);
    rig.bone('tail', 'hips', 0, -0.05 * K, -0.14 * K);
    rig.bone('tail2', 'tail', 0, -0.04 * K, -0.3 * K);
    for (const side of [-1, 1] as const) {
      const n = side > 0 ? 'L' : 'R';
      rig.bone(`shoulder${n}`, 'chest', 0.2 * K * side, 0.15 * K, 0);
      rig.bone(`upperArm${n}`, `shoulder${n}`, 0.08 * K * side, 0, 0);
      rig.bone(`foreArm${n}`, `upperArm${n}`, 0, -0.3 * K, 0);
      rig.bone(`hand${n}`, `foreArm${n}`, 0, -0.27 * K, 0);
      rig.bone(`thigh${n}`, 'hips', 0.12 * K * side, -0.05 * K, 0);
      rig.bone(`shin${n}`, `thigh${n}`, 0, -0.45 * K, 0);
      rig.bone(`foot${n}`, `shin${n}`, 0, -0.44 * K, 0);
    }
    const part = (bone: string, g: THREE.BufferGeometry, m: number, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): void =>
      rig.part(bone, g, m, { pos: [pos[0] * K, pos[1] * K, pos[2] * K], rot });

    // Torso.
    part('hips', roundedBox(0.42 * K, 0.22 * K, 0.28 * K, 0.06), P.SCALE);
    part('hips', limb(0.24 * K, 0.3 * K, 0.07 * K, 16, 1, 0.7), P.GOLD, [0, 0.1, 0]);
    // Kilt (shendyt): pleated linen wedge with a gold front panel.
    part('hips', limb(0.23 * K, 0.33 * K, 0.36 * K, 18, 1, 0.75), P.LINEN, [0, 0.0, 0]);
    part('hips', roundedBox(0.12 * K, 0.34 * K, 0.02 * K, 0.01), P.GOLD, [0, -0.17, 0.215], [0.18, 0, 0]);
    part('spine', roundedBox(0.38 * K, 0.26 * K, 0.26 * K, 0.08), P.SCALE, [0, 0.1, 0]);
    for (let i = 0; i < 3; i++) part('spine', roundedBox(0.26 * K, 0.06 * K, 0.04 * K, 0.015), P.PLATE, [0, 0.03 + i * 0.07, 0.13]);
    part('chest', roundedBox(0.56 * K, 0.34 * K, 0.32 * K, 0.1), P.SCALE, [0, 0.07, 0]);
    for (const s of [-1, 1]) part('chest', roundedBox(0.25 * K, 0.18 * K, 0.06 * K, 0.03), P.PLATE, [s * 0.12, 0.09, 0.16], [-0.15, s * 0.22, 0]);
    part('chest', roundedBox(0.48 * K, 0.3 * K, 0.06 * K, 0.03), P.PLATE, [0, 0.09, -0.16]);
    // Usekh collar: banded gold / lapis / green disc around the neck.
    const bands = [P.GOLD, P.LAPIS, P.GOLD, P.KA, P.GOLD];
    bands.forEach((m, i) => {
      const r0 = (0.13 + i * 0.035) * K;
      const g = new THREE.RingGeometry(r0, r0 + 0.036 * K, 28, 1).rotateX(-Math.PI / 2);
      rig.part('chest', g, m, { pos: [0, (0.255 - i * 0.012) * K, 0.01 * K], rot: [-0.12 * (i + 1) * 0.3, 0, 0] });
    });
    part('chest', limb(0.17 * K, 0.21 * K, 0.08 * K, 20), P.GOLD, [0, 0.265, 0]);
    // Ka-amp reservoir rising between the shoulders, above the helm: the
    // weak point. Readable from the front over his head, wide open from behind.
    part('chest', capsule(0.1 * K, 0.26 * K, 6, 16), P.KA, [0, 0.52, -0.2]);
    for (const a of [0, 1, 2, 3]) {
      const ang = (a / 4) * Math.PI * 2 + 0.4;
      part('chest', roundedBox(0.025 * K, 0.5 * K, 0.025 * K, 0.008), P.GOLD, [Math.cos(ang) * 0.135, 0.52, -0.2 + Math.sin(ang) * 0.135]);
    }
    part('chest', limb(0.15 * K, 0.15 * K, 0.04 * K, 16), P.GOLD, [0, 0.79, -0.2]);
    part('chest', limb(0.16 * K, 0.17 * K, 0.08 * K, 16), P.GOLD, [0, 0.3, -0.2]);
    part('chest', roundedBox(0.2 * K, 0.22 * K, 0.12 * K, 0.03), P.PLATE, [0, 0.2, -0.2]);
    // Cables from the reservoir base to the shoulders.
    for (const s of [-1, 1]) {
      part('chest', limb(0.025 * K, 0.025 * K, 0.3 * K, 8), P.CABLE, [s * 0.1, 0.3, -0.2], [0, 0, s * 1.15]);
    }
    this.weakLocal.set(0, (0.98 + 0.14 + 0.22 + 0.52) * K, -0.2 * K);

    // Crocodile helm.
    part('neck', limb(0.09 * K, 0.11 * K, 0.12 * K, 12), P.SCALE, [0, 0.11, 0]);
    part('head', ellipsoid(0.15 * K, 0.13 * K, 0.17 * K, 16, 12), P.SCALE, [0, 0.1, -0.02]);
    part('head', roundedBox(0.2 * K, 0.08 * K, 0.36 * K, 0.03), P.SCALE, [0, 0.08, 0.2], [0.06, 0, 0]);
    part('head', roundedBox(0.13 * K, 0.05 * K, 0.18 * K, 0.02), P.PLATE, [0, 0.1, 0.32], [0.08, 0, 0]);
    for (const s of [-1, 1]) {
      part('head', ellipsoid(0.04 * K, 0.035 * K, 0.04 * K), P.SCALE, [s * 0.075, 0.16, 0.08]);
      part('head', ellipsoid(0.018 * K, 0.014 * K, 0.012 * K), P.EYE, [s * 0.08, 0.17, 0.11]);
      for (let i = 0; i < 6; i++) {
        part('head', new THREE.ConeGeometry(0.012 * K, 0.04 * K, 4), P.TEETH, [s * 0.085, 0.035, 0.06 + i * 0.05], [Math.PI, 0, 0]);
      }
    }
    for (let i = 0; i < 5; i++) part('head', new THREE.ConeGeometry(0.025 * K, 0.07 * K, 4), P.PLATE, [0, 0.24 - i * 0.02, 0.0 - i * 0.07], [-0.5, 0, 0]);
    // Lower jaw (opens on the roar).
    part('jaw', roundedBox(0.18 * K, 0.05 * K, 0.33 * K, 0.02), P.SCALE, [0, -0.03, 0.12]);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) part('jaw', new THREE.ConeGeometry(0.011 * K, 0.035 * K, 4), P.TEETH, [s * 0.075, 0.0, 0.02 + i * 0.05]);
    // Gold headdress lappets.
    for (const s of [-1, 1]) part('head', roundedBox(0.04 * K, 0.22 * K, 0.1 * K, 0.015), P.GOLD, [s * 0.15, 0.02, -0.04]);

    // Arms.
    for (const side of [-1, 1] as const) {
      const n = side > 0 ? 'L' : 'R';
      part(`upperArm${n}`, limb(0.09 * K, 0.08 * K, 0.3 * K, 12), P.SCALE);
      part(`upperArm${n}`, ellipsoid(0.15 * K, 0.1 * K, 0.14 * K), P.PLATE, [side * 0.03, 0.02, 0]);
      part(`upperArm${n}`, limb(0.095 * K, 0.095 * K, 0.03 * K, 14), P.GOLD, [0, -0.2, 0]);
      part(`foreArm${n}`, limb(0.08 * K, 0.07 * K, 0.27 * K, 12), P.SCALE);
      part(`foreArm${n}`, roundedBox(0.17 * K, 0.2 * K, 0.17 * K, 0.04), P.PLATE, [0, -0.15, 0]);
      part(`foreArm${n}`, limb(0.03 * K, 0.03 * K, 0.22 * K, 8), P.KA, [side * 0.09, -0.04, 0.02]);
      part(`hand${n}`, roundedBox(0.11 * K, 0.13 * K, 0.12 * K, 0.03), P.DARK, [0, -0.07, 0.01]);
      for (let i = 0; i < 3; i++) part(`hand${n}`, new THREE.ConeGeometry(0.014 * K, 0.06 * K, 4), P.TEETH, [(-0.03 + i * 0.03), -0.16, 0.04], [Math.PI - 0.3, 0, 0]);
    }
    // Legs.
    for (const side of [-1, 1] as const) {
      const n = side > 0 ? 'L' : 'R';
      part(`thigh${n}`, limb(0.13 * K, 0.1 * K, 0.45 * K, 12), P.SCALE);
      part(`shin${n}`, limb(0.1 * K, 0.08 * K, 0.44 * K, 12), P.SCALE);
      part(`shin${n}`, ellipsoid(0.1 * K, 0.1 * K, 0.07 * K), P.PLATE, [0, 0, 0.06]);
      part(`shin${n}`, roundedBox(0.15 * K, 0.3 * K, 0.08 * K, 0.03), P.PLATE, [0, -0.22, 0.05]);
      part(`foot${n}`, roundedBox(0.16 * K, 0.1 * K, 0.3 * K, 0.04), P.DARK, [0, -0.04, 0.06]);
      for (let i = 0; i < 3; i++) part(`foot${n}`, new THREE.ConeGeometry(0.018 * K, 0.06 * K, 4), P.TEETH, [(-0.05 + i * 0.05), -0.06, 0.22], [Math.PI / 2, 0, 0]);
    }
    // Tail.
    part('tail', limb(0.11 * K, 0.08 * K, 0.34 * K, 10), P.SCALE, [0, 0, 0], [-1.2, 0, 0]);
    part('tail2', limb(0.08 * K, 0.02 * K, 0.4 * K, 10), P.SCALE, [0, 0, 0], [-1.3, 0, 0]);
    for (let i = 0; i < 4; i++) part('tail2', new THREE.ConeGeometry(0.025 * K, 0.06 * K, 4), P.PLATE, [0, 0.04 - i * 0.02, -0.06 - i * 0.08], [-0.6, 0, 0]);

    this.material = paletteMaterial(PALETTE, { camoBlue: 0x23402a, camoYellow: 0x7a5f2c, camoScale: 16 });
    const built = rig.build(this.material);
    built.mesh.castShadow = true;
    for (const b of built.skeleton.bones) this.B[b.name] = b;
    this.hipsBind.copy(this.B.hips.position);
    this.root.add(built.mesh);
  }

  private get uniforms(): { uFlash: { value: THREE.Vector4 }; uGlow: { value: THREE.Vector4 }; uPalProps: { value: THREE.Vector4[] } } {
    return this.material.userData.uniforms;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.handR.updateWorldMatrix(true, false);
    return out.set(0, -0.16 * K, 0.06).applyMatrix4(this.B.handR.matrixWorld);
  }

  handWorld(out: THREE.Vector3, side: 1 | -1): THREE.Vector3 {
    const b = side > 0 ? this.B.handL : this.B.handR;
    b.updateWorldMatrix(true, false);
    return out.set(0, -0.12 * K, 0.04).applyMatrix4(b.matrixWorld);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.head.updateWorldMatrix(true, false);
    return out.set(0, 0.14 * K, 0.12 * K).applyMatrix4(this.B.head.matrixWorld);
  }

  /** Centre of the helm (for the head hitbox). */
  headCenterWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.head.updateWorldMatrix(true, false);
    return out.set(0, 0.1 * K, 0.06 * K).applyMatrix4(this.B.head.matrixWorld);
  }

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.chest.updateWorldMatrix(true, false);
    return out.set(0, 0.08 * K, 0).applyMatrix4(this.B.chest.matrixWorld);
  }

  weakWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.chest.updateWorldMatrix(true, false);
    return out.set(0, 0.52 * K, -0.2 * K).applyMatrix4(this.B.chest.matrixWorld);
  }

  kickRecoil(amount = 1): void {
    this.recoil = Math.min(1.5, this.recoil + amount);
  }

  react(side: number, amount: number): void {
    this.hitReact = Math.min(1, this.hitReact + amount * 0.5);
    this.hitSide = side;
  }

  setFlash(r: number, g: number, b: number, a: number): void {
    this.uniforms.uFlash.value.set(r, g, b, a * 0.6);
  }

  setGlow(r: number, g: number, b: number, a: number): void {
    this.uniforms.uGlow.value.set(r, g, b, a);
  }

  setDissolve(v: number): void {
    (this.material.userData.uniforms.uDissolve as { value: number }).value = v;
  }

  spinUp(): void {}

  /** Enemy's generic pose call: walk/turn; boss actions layer on in bossPose. */
  pose(dt: number, p: PoseParams): void {
    this.bossPose(dt, p.speed, p.pitch);
  }

  bossPose(dt: number, speed: number, pitch: number): void {
    const B = this.B;
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.hitReact = Math.max(0, this.hitReact - dt * 3);
    for (const name in B) B[name].rotation.set(0, 0, 0);
    B.hips.position.copy(this.hipsBind);
    const t = this.time;
    const run = Math.min(1, speed / 3);
    this.phase += (speed / (1.6 * K)) * Math.PI * dt;
    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);
    // Heavy, wide stance.
    B.thighL.rotation.z = 0.08;
    B.thighR.rotation.z = -0.08;
    B.thighL.rotation.x = -sw * 0.55 * run - 0.1;
    B.thighR.rotation.x = sw * 0.55 * run - 0.1;
    B.shinL.rotation.x = Math.max(0, cw) * 0.8 * run + 0.18;
    B.shinR.rotation.x = Math.max(0, -cw) * 0.8 * run + 0.18;
    B.hips.position.y -= 0.06 * K + Math.abs(sw) * -0.03 * run;
    B.spine.rotation.x = 0.12 + run * 0.08;
    B.chest.rotation.x = 0.06 + Math.sin(t * 1.4) * 0.025;
    B.chest.rotation.y = -sw * 0.08 * run;
    B.neck.rotation.x = -0.15 - pitch * 0.3;
    B.head.rotation.x = -pitch * 0.3;
    B.tail.rotation.x = 0.15 + Math.sin(t * 1.3) * 0.06;
    B.tail.rotation.y = Math.sin(t * 0.9) * 0.25;
    B.tail2.rotation.y = Math.sin(t * 0.9 - 0.8) * 0.35;
    // Arms hang heavy, swinging a little.
    B.upperArmL.rotation.z = 0.28;
    B.upperArmR.rotation.z = -0.28;
    B.upperArmL.rotation.x = sw * 0.3 * run - 0.1;
    B.upperArmR.rotation.x = -sw * 0.3 * run - 0.1;
    B.foreArmL.rotation.x = -0.5;
    B.foreArmR.rotation.x = -0.5;

    const a = this.actionT;
    switch (this.action) {
      case 'volley': {
        // Both hands forward, palms out, then a push.
        const push = a > 0.8 ? 1 : a / 0.8;
        B.upperArmL.rotation.x = -1.3 * push;
        B.upperArmR.rotation.x = -1.3 * push;
        B.upperArmL.rotation.z = 0.15;
        B.upperArmR.rotation.z = -0.15;
        B.foreArmL.rotation.x = -0.3;
        B.foreArmR.rotation.x = -0.3;
        B.chest.rotation.x -= 0.15 * push - this.recoil * 0.2;
        break;
      }
      case 'slam': {
        // Raise both fists overhead, then hammer down.
        const up = Math.min(1, a / 0.75);
        const down = a > 0.75 ? (a - 0.75) / 0.25 : 0;
        B.upperArmL.rotation.x = -2.8 * up + down * 2.2;
        B.upperArmR.rotation.x = -2.8 * up + down * 2.2;
        B.foreArmL.rotation.x = -0.6;
        B.foreArmR.rotation.x = -0.6;
        B.spine.rotation.x = -0.2 * up + down * 0.7;
        B.thighL.rotation.x = -0.4 * down;
        B.thighR.rotation.x = -0.4 * down;
        B.shinL.rotation.x = 0.8 * down;
        B.shinR.rotation.x = 0.8 * down;
        B.hips.position.y -= 0.3 * down;
        break;
      }
      case 'drag': {
        // Right arm reaches out, then hauls back.
        const reach = a < 0.6 ? a / 0.6 : 1 - (a - 0.6) / 0.4 * 0.7;
        B.upperArmR.rotation.x = -1.5 * reach;
        B.upperArmR.rotation.y = 0.3 * reach;
        B.foreArmR.rotation.x = -0.2 - (1 - reach) * 1.2;
        B.chest.rotation.y = 0.35 * reach;
        break;
      }
      case 'lunge': {
        const crouch = Math.min(1, a * 1.5);
        B.spine.rotation.x = 0.5 * crouch;
        B.chest.rotation.x = 0.2 * crouch;
        B.thighL.rotation.x = -0.9 * crouch;
        B.thighR.rotation.x = 0.3 * crouch;
        B.shinL.rotation.x = 1.0 * crouch;
        B.shinR.rotation.x = 0.8 * crouch;
        B.upperArmL.rotation.x = -0.9 * crouch;
        B.upperArmR.rotation.x = -0.9 * crouch;
        B.hips.position.y -= 0.25 * crouch;
        B.jaw.rotation.x = 0.35 * crouch;
        break;
      }
      case 'orbs': {
        const lift = Math.min(1, a * 1.3);
        B.upperArmL.rotation.z = 0.28 + 1.0 * lift;
        B.upperArmR.rotation.z = -0.28 - 1.0 * lift;
        B.upperArmL.rotation.x = -0.6 * lift;
        B.upperArmR.rotation.x = -0.6 * lift;
        B.foreArmL.rotation.x = -1.2 * lift;
        B.foreArmR.rotation.x = -1.2 * lift;
        B.head.rotation.x -= 0.25 * lift;
        break;
      }
      case 'roar': {
        const r = Math.sin(Math.min(1, a) * Math.PI);
        B.upperArmL.rotation.z = 0.28 + 1.2 * r;
        B.upperArmR.rotation.z = -0.28 - 1.2 * r;
        B.foreArmL.rotation.x = -0.4;
        B.foreArmR.rotation.x = -0.4;
        B.chest.rotation.x -= 0.35 * r;
        B.neck.rotation.x -= 0.4 * r;
        B.head.rotation.x -= 0.3 * r;
        B.jaw.rotation.x = 0.6 * r;
        break;
      }
      case 'channel': {
        B.upperArmL.rotation.z = 1.1;
        B.upperArmR.rotation.z = -1.1;
        B.foreArmL.rotation.x = -0.6 + Math.sin(t * 3) * 0.1;
        B.foreArmR.rotation.x = -0.6 + Math.sin(t * 3 + 1) * 0.1;
        B.head.rotation.x -= 0.2;
        break;
      }
      case 'stagger': {
        const s = Math.sin(Math.min(1, a) * Math.PI);
        B.spine.rotation.x -= 0.35 * s;
        B.chest.rotation.z = 0.2 * s * this.hitSide;
        B.upperArmL.rotation.z = 0.8 * s + 0.28;
        B.upperArmR.rotation.z = -0.8 * s - 0.28;
        break;
      }
      case 'downed': {
        // Down on one knee, head bowed, hand on the ground.
        const d = Math.min(1, a * 2);
        B.hips.position.y -= 0.55 * K * d;
        B.thighL.rotation.x = -1.4 * d;
        B.shinL.rotation.x = 1.5 * d;
        B.thighR.rotation.x = 0.1 * d;
        B.shinR.rotation.x = 2.0 * d;
        B.footR.rotation.x = -0.5 * d;
        B.spine.rotation.x = 0.35 * d;
        B.chest.rotation.x = 0.15 * d;
        B.neck.rotation.x = 0.2 * d;
        B.upperArmR.rotation.x = -0.4 * d;
        B.foreArmR.rotation.x = -0.3 * d;
        B.upperArmL.rotation.x = -0.9 * d;
        B.foreArmL.rotation.x = -1.2 * d;
        break;
      }
    }
    if (this.talking && this.action !== 'roar') B.jaw.rotation.x = Math.max(0, Math.sin(t * 11) * Math.sin(t * 3.7)) * 0.22;
    if (this.hitReact > 0) {
      B.spine.rotation.x -= this.hitReact * 0.15;
      B.spine.rotation.z += this.hitReact * 0.1 * this.hitSide;
    }
    // Ka glow pulses with power.
    this.uniforms.uPalProps.value[P.KA].z = 0.35 + this.kaLevel * 0.6 + Math.sin(t * 6) * 0.15 * this.kaLevel;
  }
}
