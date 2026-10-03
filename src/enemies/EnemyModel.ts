import * as THREE from 'three';
import {
  RigBuilder, paletteMaterial, clonePaletteMaterial, roundedBox, limb, ellipsoid, capsule,
  type PaletteEntry,
} from '../character/rigKit';

export type EnemyKind = 'grunt' | 'trooper' | 'heavy';

/** Palette slots shared by all crew models. */
export const PAL = {
  fabric: 0, armor: 1, armorDark: 2, gold: 3, visor: 4, skin: 5, gun: 6, gunGlow: 7, weak: 8, boot: 9, accent: 10,
} as const;

interface Spec {
  scale: number;
  bulk: number;
  armor: number;
  accent: number;
  gunLength: number;
  gunBulk: number;
  pack: boolean;
  pauldrons: number;
}

const SPECS: Record<EnemyKind, Spec> = {
  grunt: { scale: 1.0, bulk: 1.0, armor: 0x1f6f63, accent: 0x9fe8d0, gunLength: 0.75, gunBulk: 1, pack: false, pauldrons: 1 },
  trooper: { scale: 1.04, bulk: 1.15, armor: 0x2a4f7a, accent: 0x7fc8ff, gunLength: 0.55, gunBulk: 1.15, pack: true, pauldrons: 1.25 },
  heavy: { scale: 1.3, bulk: 1.45, armor: 0x5b4a2e, accent: 0xffb060, gunLength: 1.0, gunBulk: 1.9, pack: true, pauldrons: 1.7 },
};

function palette(spec: Spec): PaletteEntry[] {
  return [
    { color: 0x24282e, roughness: 0.85, metalness: 0.05 },
    { color: spec.armor, roughness: 0.45, metalness: 0.35 },
    { color: 0x15181c, roughness: 0.5, metalness: 0.4 },
    { color: 0xc9a24a, roughness: 0.3, metalness: 0.9 },
    { color: 0xffa020, roughness: 0.3, metalness: 0, emissive: 3.2 },
    { color: 0x4a3022, roughness: 0.7, metalness: 0 },
    { color: 0x2b2e33, roughness: 0.4, metalness: 0.7 },
    { color: 0xff3a20, roughness: 0.3, metalness: 0, emissive: 2.5 },
    { color: 0xff7a18, roughness: 0.2, metalness: 0, emissive: 5 },
    { color: 0x111214, roughness: 0.8, metalness: 0.1 },
    { color: spec.accent, roughness: 0.3, metalness: 0.2, emissive: 1.2 },
  ];
}

interface BuiltModel {
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  muzzleLocal: THREE.Vector3;
  weakLocal: THREE.Vector3 | null;
}

const cache = new Map<EnemyKind, { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; muzzle: THREE.Vector3; weak: THREE.Vector3 | null; boneNames: string[]; bind: { pos: THREE.Vector3; parent: number }[] }>();

/**
 * Builds (once per kind) the crew model: a crocodile-snouted visor helmet,
 * armour in the gang's colours, and the weapon baked into the right hand.
 */
function buildKind(kind: EnemyKind): BuiltModel {
  const s = SPECS[kind];
  const k = s.scale;
  const b = s.bulk;
  const rig = new RigBuilder();
  rig.bone('hips', 'root', 0, 0.98 * k, 0);
  rig.bone('spine', 'hips', 0, 0.14 * k, 0);
  rig.bone('chest', 'spine', 0, 0.22 * k, 0);
  rig.bone('neck', 'chest', 0, 0.22 * k, 0);
  rig.bone('head', 'neck', 0, 0.09 * k, 0);
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    rig.bone(`shoulder${n}`, 'chest', 0.17 * k * b * side, 0.15 * k, 0);
    rig.bone(`upperArm${n}`, `shoulder${n}`, 0.06 * k * b * side, 0, 0);
    rig.bone(`foreArm${n}`, `upperArm${n}`, 0, -0.29 * k, 0);
    rig.bone(`hand${n}`, `foreArm${n}`, 0, -0.26 * k, 0);
    rig.bone(`thigh${n}`, 'hips', 0.1 * k * Math.sqrt(b) * side, -0.05 * k, 0);
    rig.bone(`shin${n}`, `thigh${n}`, 0, -0.44 * k, 0);
    rig.bone(`foot${n}`, `shin${n}`, 0, -0.44 * k, 0);
  }

  // Torso.
  rig.part('hips', roundedBox(0.34 * k * b, 0.2 * k, 0.22 * k * b, 0.04), PAL.fabric, { pos: [0, 0.02 * k, 0] });
  rig.part('hips', roundedBox(0.38 * k * b, 0.07 * k, 0.25 * k * b, 0.02), PAL.armorDark, { pos: [0, 0.09 * k, 0] });
  rig.part('spine', roundedBox(0.3 * k * b, 0.24 * k, 0.2 * k * b, 0.05), PAL.fabric, { pos: [0, 0.1 * k, 0] });
  rig.part('chest', roundedBox(0.42 * k * b, 0.3 * k, 0.26 * k * b, 0.06), PAL.fabric, { pos: [0, 0.06 * k, 0] });
  // Chest plate with a gold band.
  rig.part('chest', roundedBox(0.4 * k * b, 0.26 * k, 0.08 * k, 0.03), PAL.armor, { pos: [0, 0.08 * k, 0.12 * k * b], rot: [-0.08, 0, 0] });
  rig.part('chest', roundedBox(0.36 * k * b, 0.035 * k, 0.04 * k, 0.01), PAL.gold, { pos: [0, -0.01 * k, 0.165 * k * b] });
  rig.part('chest', roundedBox(0.38 * k * b, 0.24 * k, 0.07 * k, 0.03), PAL.armor, { pos: [0, 0.08 * k, -0.12 * k * b] });
  // Collar.
  rig.part('chest', limb(0.12 * k * b, 0.15 * k * b, 0.07 * k, 12), PAL.armorDark, { pos: [0, 0.24 * k, 0] });
  rig.part('neck', limb(0.055 * k, 0.06 * k, 0.1 * k, 8), PAL.fabric, { pos: [0, 0.1 * k, 0] });

  // Helmet: rounded dome + crocodile snout visor + glowing eye slits.
  rig.part('head', ellipsoid(0.12 * k, 0.13 * k, 0.13 * k), PAL.armorDark, { pos: [0, 0.1 * k, -0.01 * k] });
  rig.part('head', roundedBox(0.2 * k, 0.07 * k, 0.17 * k, 0.025), PAL.armor, { pos: [0, 0.07 * k, 0.13 * k], rot: [0.15, 0, 0] });
  rig.part('head', roundedBox(0.14 * k, 0.04 * k, 0.12 * k, 0.015), PAL.armor, { pos: [0, 0.035 * k, 0.21 * k], rot: [0.2, 0, 0] });
  // Teeth ridge.
  for (let i = -2; i <= 2; i++) {
    rig.part('head', new THREE.ConeGeometry(0.008 * k, 0.025 * k, 4), PAL.gold, { pos: [i * 0.025 * k, 0.015 * k, 0.2 * k + Math.abs(i) * -0.012 * k], rot: [Math.PI, 0, 0] });
  }
  rig.part('head', roundedBox(0.17 * k, 0.022 * k, 0.03 * k, 0.008), PAL.visor, { pos: [0, 0.125 * k, 0.105 * k] });
  // Ridge scales along the top.
  for (let i = 0; i < 4; i++) {
    rig.part('head', new THREE.ConeGeometry(0.018 * k, 0.04 * k, 4), PAL.armor, { pos: [0, 0.225 * k - i * 0.012 * k, 0.04 * k - i * 0.06 * k], rot: [-0.4 - i * 0.25, 0, 0] });
  }

  // Arms.
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    rig.part(`upperArm${n}`, limb(0.055 * k * b, 0.05 * k * b, 0.3 * k, 8), PAL.fabric);
    rig.part(`upperArm${n}`, ellipsoid(0.1 * k * s.pauldrons, 0.075 * k * s.pauldrons, 0.1 * k * s.pauldrons, 10, 8), PAL.armor, { pos: [0.02 * k * side, 0.01 * k, 0] });
    rig.part(`upperArm${n}`, roundedBox(0.03 * k, 0.02 * k, 0.12 * k * s.pauldrons, 0.008), PAL.gold, { pos: [0.08 * k * side * s.pauldrons, 0.0, 0] });
    rig.part(`foreArm${n}`, limb(0.05 * k * b, 0.04 * k * b, 0.26 * k, 8), PAL.fabric);
    rig.part(`foreArm${n}`, roundedBox(0.1 * k * b, 0.16 * k, 0.1 * k * b, 0.02), PAL.armorDark, { pos: [0, -0.15 * k, 0] });
    rig.part(`hand${n}`, roundedBox(0.07 * k, 0.1 * k, 0.08 * k, 0.02), PAL.boot, { pos: [0, -0.05 * k, 0.01 * k] });
  }

  // Legs.
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    rig.part(`thigh${n}`, limb(0.085 * k * b, 0.065 * k * b, 0.44 * k, 10), PAL.fabric);
    rig.part(`thigh${n}`, roundedBox(0.1 * k * b, 0.22 * k, 0.04 * k, 0.015), PAL.armor, { pos: [0.06 * k * side * b, -0.16 * k, 0.03 * k] , rot: [0, 0.4 * side, 0] });
    rig.part(`shin${n}`, limb(0.065 * k * b, 0.05 * k * b, 0.44 * k, 10), PAL.fabric);
    rig.part(`shin${n}`, ellipsoid(0.065 * k * b, 0.07 * k, 0.05 * k), PAL.armor, { pos: [0, -0.01 * k, 0.05 * k] });
    rig.part(`shin${n}`, roundedBox(0.1 * k * b, 0.26 * k, 0.08 * k, 0.02), PAL.armorDark, { pos: [0, -0.24 * k, 0.03 * k] });
    rig.part(`foot${n}`, roundedBox(0.11 * k * b, 0.09 * k, 0.24 * k, 0.03), PAL.boot, { pos: [0, -0.04 * k, 0.05 * k] });
  }

  // Back pack (shield emitter / power pack).
  let weakLocal: THREE.Vector3 | null = null;
  if (s.pack) {
    if (kind === 'heavy') {
      rig.part('chest', roundedBox(0.44 * k, 0.42 * k, 0.2 * k, 0.05), PAL.armorDark, { pos: [0, 0.06 * k, -0.25 * k] });
      rig.part('chest', capsule(0.085 * k, 0.16 * k, 4, 12), PAL.weak, { pos: [0, 0.08 * k, -0.36 * k], rot: [0, 0, 0] });
      // Cage bars around the core.
      for (const x of [-0.11, 0.11]) {
        rig.part('chest', roundedBox(0.025 * k, 0.4 * k, 0.03 * k, 0.008), PAL.gold, { pos: [x * k, 0.08 * k, -0.42 * k] });
      }
      rig.part('chest', limb(0.03 * k, 0.03 * k, 0.4 * k, 6), PAL.gun, { pos: [0.18 * k, 0.3 * k, -0.28 * k], rot: [0.4, 0, 0.6] });
      weakLocal = new THREE.Vector3(0, (0.98 + 0.14 + 0.22 + 0.08) * k, -0.38 * k);
    } else {
      rig.part('chest', roundedBox(0.3 * k, 0.3 * k, 0.12 * k, 0.04), PAL.armorDark, { pos: [0, 0.06 * k, -0.2 * k] });
      rig.part('chest', limb(0.04 * k, 0.04 * k, 0.24 * k, 10), PAL.accent, { pos: [0, 0.2 * k, -0.27 * k] });
    }
  }

  // Weapon in the right hand, pointing forward (+Z).
  const gl = s.gunLength;
  const gb = s.gunBulk;
  rig.part('handR', roundedBox(0.07 * k * gb, 0.11 * k * gb, gl * 0.55 * k, 0.015), PAL.gun, { pos: [0, -0.08 * k, gl * 0.18 * k] });
  rig.part('handR', limb(0.022 * k * gb, 0.022 * k * gb, gl * 0.5 * k, 8), PAL.gun, { pos: [0, -0.06 * k, gl * 0.45 * k], rot: [-Math.PI / 2, 0, 0] });
  rig.part('handR', roundedBox(0.03 * k, 0.03 * k, gl * 0.3 * k, 0.008), PAL.gunGlow, { pos: [0.04 * k * gb, -0.06 * k, gl * 0.2 * k] });
  if (kind === 'heavy') {
    // Rotary barrels.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      rig.part('handR', limb(0.016 * k, 0.016 * k, gl * 0.55 * k, 6), PAL.gun, { pos: [Math.cos(a) * 0.035 * k, -0.07 * k + Math.sin(a) * 0.035 * k, gl * 0.5 * k], rot: [-Math.PI / 2, 0, 0] });
    }
  }
  const muzzleLocal = new THREE.Vector3(0, -0.06 * k, gl * 0.95 * k);

  const material = paletteMaterial(palette(s));
  const built = rig.build(material);
  // Muzzle position relative to the right hand bone (bind pose).
  return { mesh: built.mesh, material, muzzleLocal, weakLocal };
}

export type PoseMode = 'normal' | 'stagger' | 'lifted' | 'dead' | 'flung' | 'stomp' | 'throw';

export interface PoseParams {
  speed: number;
  strafe: number;
  back: boolean;
  aim: number;
  crouch: number;
  pitch: number;
  mode: PoseMode;
  modeT: number;
  spin: number;
}

/** What Enemy needs from a visual (crew members and the boss implement it). */
export interface EnemyVisual {
  readonly root: THREE.Group;
  readonly weakLocal: THREE.Vector3 | null;
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
  headWorld(out: THREE.Vector3): THREE.Vector3;
  chestWorld(out: THREE.Vector3): THREE.Vector3;
  weakWorld(out: THREE.Vector3): THREE.Vector3;
  kickRecoil(amount?: number): void;
  react(side: number, amount: number): void;
  setFlash(r: number, g: number, b: number, a: number): void;
  setGlow(r: number, g: number, b: number, a: number): void;
  setDissolve(v: number): void;
  pose(dt: number, p: PoseParams): void;
  spinUp(amount: number): void;
}

/**
 * One enemy's visual: the skinned crew model plus procedural animation
 * (walk cycle, aim, crouch, recoil, stagger, lift flail, limp death).
 */
export class EnemyModel implements EnemyVisual {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly bones: Record<string, THREE.Bone> = {};
  private readonly muzzleLocal: THREE.Vector3;
  readonly weakLocal: THREE.Vector3 | null;
  private readonly kindScale: number;
  private phase = Math.random() * 10;
  private recoil = 0;
  private hitReact = 0;
  private hitSide = 0;
  private flail = 0;
  private time = Math.random() * 10;
  private readonly bindHips = new THREE.Vector3();

  constructor(readonly kind: EnemyKind) {
    let c = cache.get(kind);
    if (!c) {
      const built = buildKind(kind);
      const bones = built.mesh.skeleton.bones;
      c = {
        geometry: built.mesh.geometry,
        material: built.material,
        muzzle: built.muzzleLocal,
        weak: built.weakLocal,
        boneNames: bones.map((b) => b.name),
        bind: bones.map((b) => ({ pos: b.position.clone(), parent: bones.indexOf(b.parent as THREE.Bone) })),
      };
      cache.set(kind, c);
    }
    // Rebuild a fresh skeleton for this instance sharing the geometry.
    const bones: THREE.Bone[] = c.boneNames.map((name, i) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.copy(c!.bind[i].pos);
      this.bones[name] = b;
      return b;
    });
    c.bind.forEach((info, i) => {
      if (info.parent >= 0) bones[info.parent].add(bones[i]);
    });
    this.material = clonePaletteMaterial(c.material);
    this.mesh = new THREE.SkinnedMesh(c.geometry, this.material);
    this.mesh.add(bones[0]);
    bones[0].updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    this.mesh.bind(skeleton);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.muzzleLocal = c.muzzle;
    this.weakLocal = c.weak;
    this.kindScale = SPECS[kind].scale;
    this.bindHips.copy(this.bones.hips.position);
  }

  get uniforms(): Record<string, { value: THREE.Vector4 & number }> {
    return this.material.userData.uniforms;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.bones.handR.updateWorldMatrix(true, false);
    return out.copy(this.muzzleLocal).applyMatrix4(this.bones.handR.matrixWorld);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.bones.head.updateWorldMatrix(true, false);
    return out.set(0, 0.1 * this.kindScale, 0.05).applyMatrix4(this.bones.head.matrixWorld);
  }

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    this.bones.chest.updateWorldMatrix(true, false);
    return out.set(0, 0.05, 0).applyMatrix4(this.bones.chest.matrixWorld);
  }

  weakWorld(out: THREE.Vector3): THREE.Vector3 {
    this.bones.chest.updateWorldMatrix(true, false);
    return out.set(0, 0.08 * this.kindScale, -0.38 * this.kindScale).applyMatrix4(this.bones.chest.matrixWorld);
  }

  kickRecoil(amount = 1): void {
    this.recoil = Math.min(1.5, this.recoil + amount);
  }

  react(side: number, amount: number): void {
    this.hitReact = Math.min(1, this.hitReact + amount);
    this.hitSide = side;
  }

  setFlash(r: number, g: number, b: number, a: number): void {
    this.uniforms.uFlash.value.set(r, g, b, a);
  }

  setGlow(r: number, g: number, b: number, a: number): void {
    this.uniforms.uGlow.value.set(r, g, b, a);
  }

  setDissolve(v: number): void {
    (this.material.userData.uniforms.uDissolve as { value: number }).value = v;
  }

  /**
   * Procedural pose. `speed` m/s, `strafe` -1..1 sideways share, `aim` 0..1
   * weapon raised, `crouch` 0..1, `pitch` aim pitch (rad), `mode` for
   * special states.
   */
  pose(dt: number, p: PoseParams): void {
    const B = this.bones;
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.hitReact = Math.max(0, this.hitReact - dt * 4);
    const k = this.kindScale;
    const stride = 1.3 * k;
    this.phase += (p.speed / stride) * Math.PI * dt * (p.back ? -1 : 1);
    const run = Math.min(1, p.speed / (2.5 * k));
    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);

    for (const name in B) B[name].rotation.set(0, 0, 0);
    B.hips.position.copy(this.bindHips);

    if (p.mode === 'dead' || p.mode === 'flung') {
      // Limp, loose limbs; the physics body carries the motion.
      this.flail = Math.min(1, this.flail + dt * 3);
      const t = this.time * (p.mode === 'flung' ? 9 : 0);
      const limp = p.mode === 'dead' ? 1 : 0.6;
      B.thighL.rotation.x = -0.5 * limp + Math.sin(t) * 0.4;
      B.thighR.rotation.x = 0.2 * limp + Math.sin(t + 2) * 0.4;
      B.shinL.rotation.x = 0.7 * limp;
      B.shinR.rotation.x = 0.4 * limp;
      B.upperArmL.rotation.z = -1.0 - Math.sin(t + 1) * 0.5;
      B.upperArmR.rotation.z = 1.2 + Math.sin(t + 3) * 0.5;
      B.upperArmL.rotation.x = -0.6;
      B.upperArmR.rotation.x = -0.3;
      B.foreArmL.rotation.x = -0.5;
      B.foreArmR.rotation.x = -0.7;
      B.head.rotation.x = 0.4 * limp;
      B.head.rotation.z = 0.3 * limp;
      return;
    }
    this.flail = 0;

    if (p.mode === 'lifted') {
      // Helpless float: slow tumble, limbs drifting.
      const t = this.time;
      B.spine.rotation.x = Math.sin(t * 1.3) * 0.25 - 0.2;
      B.thighL.rotation.x = -0.6 + Math.sin(t * 2.1) * 0.5;
      B.thighR.rotation.x = -0.2 + Math.sin(t * 1.7 + 1) * 0.5;
      B.shinL.rotation.x = 0.8;
      B.shinR.rotation.x = 0.5 + Math.sin(t * 2.3) * 0.3;
      B.upperArmL.rotation.z = -1.3 + Math.sin(t * 2.7) * 0.4;
      B.upperArmR.rotation.z = 1.3 + Math.sin(t * 2.2 + 2) * 0.4;
      B.foreArmL.rotation.x = -0.8;
      B.foreArmR.rotation.x = -0.6;
      B.head.rotation.x = Math.sin(t * 1.9) * 0.3;
      return;
    }

    const crouch = p.crouch;
    // Legs: walk/run cycle.
    const amp = THREE.MathUtils.lerp(0.35, 0.75, run) * Math.min(1, p.speed * 1.2);
    const strafeK = 1 - Math.abs(p.strafe) * 0.6;
    B.thighL.rotation.x = -sw * amp * strafeK - crouch * 1.2;
    B.thighR.rotation.x = sw * amp * strafeK - crouch * 1.2;
    B.thighL.rotation.z = p.strafe * sw * 0.25;
    B.thighR.rotation.z = -p.strafe * sw * 0.25;
    B.shinL.rotation.x = Math.max(0, cw) * amp * 1.3 + crouch * 2.0;
    B.shinR.rotation.x = Math.max(0, -cw) * amp * 1.3 + crouch * 2.0;
    B.footL.rotation.x = -crouch * 0.8;
    B.footR.rotation.x = -crouch * 0.8;
    // Bob and crouch drop.
    B.hips.position.y = this.bindHips.y - crouch * 0.4 * k + Math.abs(sw) * 0.04 * run * k - 0.02 * run * k;
    B.hips.rotation.y = sw * 0.12 * run;
    B.spine.rotation.x = 0.12 * run + crouch * 0.25;
    B.chest.rotation.y = -sw * 0.1 * run;

    // Arms: lowered carry vs raised aim.
    const aim = p.aim;
    const pitch = THREE.MathUtils.clamp(p.pitch, -0.9, 0.9);
    // Torso pitch spreads the aim.
    B.chest.rotation.x += -pitch * 0.5 * aim;
    B.neck.rotation.x = -pitch * 0.3 * aim;
    const rec = this.recoil;
    // Right arm holds the grip, left supports the barrel.
    B.upperArmR.rotation.x = THREE.MathUtils.lerp(-0.35 + sw * 0.1, -1.35 - pitch * 0.2, aim) + rec * 0.15;
    B.upperArmR.rotation.z = THREE.MathUtils.lerp(0.15, 0.25, aim);
    B.foreArmR.rotation.x = THREE.MathUtils.lerp(-0.9, -0.25, aim) - rec * 0.1;
    B.handR.rotation.x = THREE.MathUtils.lerp(0.6, 0.05 + 0.2, aim) * 1 + THREE.MathUtils.lerp(0, -pitch * 0.2, aim);
    B.upperArmL.rotation.x = THREE.MathUtils.lerp(-0.5 - sw * 0.1, -1.25 - pitch * 0.2, aim);
    B.upperArmL.rotation.z = THREE.MathUtils.lerp(-0.25, -0.55, aim);
    B.upperArmL.rotation.y = THREE.MathUtils.lerp(0, -0.4, aim);
    B.foreArmL.rotation.x = THREE.MathUtils.lerp(-1.1, -0.55, aim);
    B.foreArmL.rotation.y = THREE.MathUtils.lerp(0, -0.5, aim);
    B.chest.rotation.x += -rec * 0.12;

    // Breathing.
    B.chest.rotation.x += Math.sin(this.time * 1.8) * 0.015;

    // Hit react.
    if (this.hitReact > 0) {
      const h = this.hitReact;
      B.spine.rotation.x -= h * 0.35;
      B.spine.rotation.z += h * 0.3 * this.hitSide;
      B.head.rotation.x -= h * 0.3;
    }

    if (p.mode === 'stagger') {
      const t = p.modeT;
      B.spine.rotation.x -= 0.45 * Math.sin(Math.min(1, t * 2) * Math.PI);
      B.upperArmL.rotation.z = -0.9;
      B.upperArmR.rotation.z = 0.7;
      B.head.rotation.x -= 0.3;
    } else if (p.mode === 'stomp') {
      // Wind up a stomp: lift a leg and hunch, then slam.
      const t = p.modeT;
      B.thighR.rotation.x = -1.3 * t;
      B.shinR.rotation.x = 1.2 * t;
      B.spine.rotation.x = 0.3 * t;
      B.upperArmL.rotation.z = -0.8 * t;
    } else if (p.mode === 'throw') {
      // Free hand wound back over the shoulder, then whipped forward.
      const t = Math.min(1, p.modeT);
      const rel = p.modeT > 1 ? Math.min(1, (p.modeT - 1) * 5) : 0;
      B.upperArmL.rotation.x = THREE.MathUtils.lerp(-2.7 * t, -1.1, rel);
      B.upperArmL.rotation.y = 0;
      B.upperArmL.rotation.z = THREE.MathUtils.lerp(-0.25, -0.1, rel);
      B.foreArmL.rotation.x = THREE.MathUtils.lerp(-1.5 * t, -0.15, rel);
      B.foreArmL.rotation.y = 0;
      B.chest.rotation.y += THREE.MathUtils.lerp(0.4 * t, -0.35, rel);
      B.spine.rotation.x += THREE.MathUtils.lerp(-0.18 * t, 0.3, rel);
    }
    void capsule;
  }

  /** Weapon spin-up visual for the heavy's barrels. */
  spinUp(amount: number): void {
    this.bones.handR.rotation.z += amount;
  }
}
