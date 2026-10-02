import * as THREE from 'three';
import { RigBuilder, paletteMaterial, roundedBox, limb, ellipsoid, capsule, type PaletteEntry } from './rigKit';
import type { NpcDef } from '../level/sections/types';
import type { Game } from '../game/Game';
import type { Director } from '../game/Director';

interface Look {
  skin: number;
  coat: number;
  coatTrim: number;
  shirt: number;
  pants: number;
  hair: number;
  wrap: number | null;
  height: number;
  build: number;
  longCoat: boolean;
  accent: number;
}

const LOOKS: Record<NpcDef['id'], Look> = {
  // Odette: dockmaster, sixties, grey locs under a teal wrap, long coat with a reflective stripe.
  odette: { skin: 0x5a3a28, coat: 0x1f4f5a, coatTrim: 0xe08a2a, shirt: 0xd8cbb0, pants: 0x2a2a30, hair: 0x9a9a9a, wrap: 0x2a8a86, height: 1.66, build: 1.05, longCoat: true, accent: 0xd4a640 },
  // Yaw: bartender, late twenties, black vest, white shirt, gold tie.
  yaw: { skin: 0x4a2e20, coat: 0x1a1a1e, coatTrim: 0xd4a640, shirt: 0xe8e4dc, pants: 0x202024, hair: 0x15100c, wrap: null, height: 1.8, build: 1.0, longCoat: false, accent: 0xd4a640 },
};

const SL = { skin: 0, coat: 1, trim: 2, shirt: 3, pants: 4, hair: 5, wrap: 6, eyeW: 7, iris: 8, dark: 9, lip: 10, accent: 11, screen: 12 };

function buildNpc(look: Look): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone> } {
  const k = look.height / 1.75;
  const b = look.build;
  const rig = new RigBuilder();
  rig.bone('hips', 'root', 0, 0.95 * k, 0);
  rig.bone('spine', 'hips', 0, 0.13 * k, 0);
  rig.bone('chest', 'spine', 0, 0.2 * k, 0);
  rig.bone('neck', 'chest', 0, 0.24 * k, 0);
  rig.bone('head', 'neck', 0, 0.09 * k, 0);
  rig.bone('jaw', 'head', 0, 0.02 * k, 0.03 * k);
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    rig.bone(`upperArm${n}`, 'chest', 0.19 * k * b * side, 0.17 * k, 0);
    rig.bone(`foreArm${n}`, `upperArm${n}`, 0, -0.28 * k, 0);
    rig.bone(`hand${n}`, `foreArm${n}`, 0, -0.25 * k, 0);
    rig.bone(`thigh${n}`, 'hips', 0.095 * k * side, -0.04 * k, 0);
    rig.bone(`shin${n}`, `thigh${n}`, 0, -0.43 * k, 0);
    rig.bone(`foot${n}`, `shin${n}`, 0, -0.44 * k, 0);
  }
  rig.part('hips', roundedBox(0.32 * k * b, 0.2 * k, 0.2 * k * b, 0.05), SL.pants, { pos: [0, 0, 0] });
  rig.part('spine', roundedBox(0.3 * k * b, 0.22 * k, 0.19 * k * b, 0.06), look.longCoat ? SL.coat : SL.shirt, { pos: [0, 0.1 * k, 0] });
  rig.part('chest', roundedBox(0.38 * k * b, 0.3 * k, 0.22 * k * b, 0.07), SL.shirt, { pos: [0, 0.08 * k, 0] });
  // Coat or vest over the chest.
  rig.part('chest', roundedBox(0.4 * k * b, 0.31 * k, 0.235 * k * b, 0.07), SL.coat, { pos: [0, 0.08 * k, -0.005], scale: [1, 1, look.longCoat ? 1 : 0.98] });
  rig.part('chest', roundedBox(0.08 * k, 0.28 * k, 0.02, 0.01), SL.shirt, { pos: [0, 0.07 * k, 0.118 * k * b] });
  rig.part('chest', roundedBox(0.03 * k, 0.16 * k, 0.015, 0.005), SL.accent, { pos: [0, 0.1 * k, 0.13 * k * b] });
  if (look.longCoat) {
    rig.part('hips', limb(0.2 * k * b, 0.26 * k * b, 0.62 * k, 14, 1, 0.75), SL.coat, { pos: [0, 0.02 * k, 0] });
    rig.part('hips', limb(0.262 * k * b, 0.262 * k * b, 0.05 * k, 14, 1, 0.75), SL.trim, { pos: [0, -0.5 * k, 0] });
    rig.part('chest', roundedBox(0.41 * k * b, 0.035 * k, 0.24 * k * b, 0.01), SL.trim, { pos: [0, -0.04 * k, 0] });
  }
  rig.part('neck', limb(0.05 * k, 0.055 * k, 0.1 * k, 10), SL.skin, { pos: [0, 0.1 * k, 0] });
  // Head and face.
  rig.part('head', ellipsoid(0.085 * k, 0.11 * k, 0.095 * k, 18, 14), SL.skin, { pos: [0, 0.1 * k, 0.005] });
  rig.part('jaw', ellipsoid(0.07 * k, 0.05 * k, 0.07 * k, 14, 10), SL.skin, { pos: [0, 0.03 * k, -0.005] });
  for (const s of [-1, 1]) {
    rig.part('head', ellipsoid(0.017 * k, 0.011 * k, 0.008 * k, 10, 8), SL.eyeW, { pos: [s * 0.033 * k, 0.115 * k, 0.083 * k] });
    rig.part('head', ellipsoid(0.008 * k, 0.008 * k, 0.004 * k, 8, 6), SL.iris, { pos: [s * 0.033 * k, 0.115 * k, 0.09 * k] });
    rig.part('head', roundedBox(0.04 * k, 0.008 * k, 0.012 * k, 0.003), SL.dark, { pos: [s * 0.034 * k, 0.137 * k, 0.088 * k], rot: [0, 0, s * -0.12] });
    rig.part('head', ellipsoid(0.012 * k, 0.025 * k, 0.012 * k, 8, 6), SL.skin, { pos: [s * 0.087 * k, 0.105 * k, 0.0] });
  }
  rig.part('head', ellipsoid(0.016 * k, 0.026 * k, 0.02 * k, 8, 6), SL.skin, { pos: [0, 0.088 * k, 0.095 * k] });
  rig.part('jaw', ellipsoid(0.03 * k, 0.009 * k, 0.012 * k, 10, 6), SL.lip, { pos: [0, 0.04 * k, 0.07 * k] });
  // Hair / wrap.
  if (look.wrap !== null) {
    rig.part('head', ellipsoid(0.105 * k, 0.1 * k, 0.11 * k, 16, 10), SL.wrap, { pos: [0, 0.17 * k, -0.02 * k], scale: [1, 1, 1] });
    rig.part('head', ellipsoid(0.08 * k, 0.12 * k, 0.08 * k, 12, 8), SL.wrap, { pos: [0, 0.24 * k, -0.04 * k], rot: [-0.4, 0, 0] });
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.65 + (i / 8) * 0.7);
      rig.part('head', capsule(0.014 * k, 0.16 * k, 3, 6), SL.hair, { pos: [Math.cos(a) * 0.085 * k, 0.04 * k, Math.sin(a) * 0.075 * k - 0.02] });
    }
  } else {
    rig.part('head', ellipsoid(0.09 * k, 0.07 * k, 0.1 * k, 14, 8), SL.hair, { pos: [0, 0.16 * k, -0.008 * k] });
  }
  // Arms.
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    const sleeve = look.longCoat ? SL.coat : SL.shirt;
    rig.part(`upperArm${n}`, limb(0.05 * k * b, 0.045 * k * b, 0.29 * k, 10), sleeve);
    rig.part(`foreArm${n}`, limb(0.044 * k * b, 0.036 * k * b, 0.26 * k, 10), sleeve);
    if (look.longCoat) rig.part(`foreArm${n}`, limb(0.046 * k, 0.046 * k, 0.03 * k, 10), SL.trim, { pos: [0, -0.2 * k, 0] });
    rig.part(`hand${n}`, roundedBox(0.06 * k, 0.09 * k, 0.03 * k, 0.012), SL.skin, { pos: [0, -0.045 * k, 0.005] });
    rig.part(`hand${n}`, roundedBox(0.018 * k, 0.05 * k, 0.02 * k, 0.006), SL.skin, { pos: [side * -0.032 * k, -0.03 * k, 0.015], rot: [0, 0, side * 0.5] });
    rig.part(`thigh${n}`, limb(0.08 * k * b, 0.06 * k * b, 0.43 * k, 10), SL.pants);
    rig.part(`shin${n}`, limb(0.058 * k * b, 0.045 * k * b, 0.44 * k, 10), SL.pants);
    rig.part(`foot${n}`, roundedBox(0.09 * k, 0.07 * k, 0.22 * k, 0.025), SL.dark, { pos: [0, -0.035 * k, 0.05 * k] });
  }
  // Odette carries a tablet.
  if (look.longCoat) rig.part('handL', roundedBox(0.16 * k, 0.22 * k, 0.012 * k, 0.008), SL.screen, { pos: [0.02, -0.1 * k, 0.04], rot: [0.2, 0, 0] });

  const pal: PaletteEntry[] = [];
  pal[SL.skin] = { color: look.skin, roughness: 0.55, metalness: 0 };
  pal[SL.coat] = { color: look.coat, roughness: 0.75, metalness: 0.05 };
  pal[SL.trim] = { color: look.coatTrim, roughness: 0.4, metalness: 0.2, emissive: look.longCoat ? 0.6 : 0 };
  pal[SL.shirt] = { color: look.shirt, roughness: 0.8, metalness: 0 };
  pal[SL.pants] = { color: look.pants, roughness: 0.8, metalness: 0 };
  pal[SL.hair] = { color: look.hair, roughness: 0.9, metalness: 0 };
  pal[SL.wrap] = { color: look.wrap ?? look.hair, roughness: 0.85, metalness: 0 };
  pal[SL.eyeW] = { color: 0xe8e2d8, roughness: 0.3, metalness: 0 };
  pal[SL.iris] = { color: 0x2a1608, roughness: 0.2, metalness: 0 };
  pal[SL.dark] = { color: 0x141110, roughness: 0.7, metalness: 0 };
  pal[SL.lip] = { color: 0x5a2f2a, roughness: 0.5, metalness: 0 };
  pal[SL.accent] = { color: look.accent, roughness: 0.3, metalness: 0.9 };
  pal[SL.screen] = { color: 0x40c8ff, roughness: 0.2, metalness: 0, emissive: 1.5 };
  const built = rig.build(paletteMaterial(pal));
  const bones: Record<string, THREE.Bone> = {};
  for (const bone of built.skeleton.bones) bones[bone.name] = bone;
  built.mesh.castShadow = true;
  return { mesh: built.mesh, bones };
}

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
    const { mesh, bones } = buildNpc(look);
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
    B.foreArmL.rotation.x = this.def.id === 'odette' ? -1.1 : -0.25;
    B.foreArmR.rotation.x = this.def.id === 'yaw' ? -0.5 : -0.15;
    B.upperArmL.rotation.x = this.def.id === 'odette' ? -0.25 : 0;
    if (this.talking) {
      B.jaw.rotation.x = Math.max(0, Math.sin(t * 13) * Math.sin(t * 5.3)) * 0.18;
      B.foreArmR.rotation.x = -0.6 - Math.max(0, Math.sin(t * 2.1)) * 0.5;
      B.upperArmR.rotation.x = -0.2 - Math.max(0, Math.sin(t * 2.1)) * 0.2;
    } else {
      B.jaw.rotation.x = 0;
    }
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
      let rel = world - (this.baseYaw + Math.PI);
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
