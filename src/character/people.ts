import * as THREE from 'three';
import { RigBuilder, paletteMaterial, clonePaletteMaterial, roundedBox, limb, ellipsoid, capsule, type PaletteEntry } from './rigKit';

/**
 * People of Hathor's Reach, built in code like Imani: a simple rig with
 * rigid parts, one draw call each. A Look describes clothes, hair and build;
 * the named characters have fixed looks, civilians are generated.
 */

export type Outfit = 'coat' | 'vest' | 'shirt' | 'apron' | 'robe' | 'jumpsuit' | 'jacket';
export type HairStyle = 'short' | 'wrap' | 'bald' | 'afro' | 'bob' | 'bun' | 'cap' | 'locs';
export type Prop = 'tablet' | 'ladle' | 'tool' | 'lamp' | null;

export interface Look {
  skin: number;
  /** Outer garment (coat, vest, apron, robe...). */
  top: number;
  trim: number;
  shirt: number;
  pants: number;
  hair: number;
  hairStyle: HairStyle;
  /** Head wrap / cap colour. */
  wrap?: number;
  height: number;
  build: number;
  outfit: Outfit;
  accent: number;
  beard?: number;
  goggles?: boolean;
  collar?: boolean;
  prop?: Prop;
  /** Emissive trim (reflective stripe on a dock coat). */
  glowTrim?: boolean;
}

export const SL = { skin: 0, top: 1, trim: 2, shirt: 3, pants: 4, hair: 5, wrap: 6, eyeW: 7, iris: 8, dark: 9, lip: 10, accent: 11, screen: 12, beard: 13 };

/**
 * Characters are rigid-skinned, so the geometry's own bounds don't follow
 * the bones. A sphere around the whole body in any pose (walking, kneeling,
 * arms up) lets them frustum-cull like anything else.
 */
export function cullAsPerson(mesh: THREE.SkinnedMesh, height: number): void {
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height * 0.85);
  mesh.frustumCulled = true;
}

export function buildPerson(look: Look): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone>; material: THREE.MeshStandardMaterial } {
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
  const o = look.outfit;
  const longTop = o === 'coat' || o === 'robe';
  const sleeve = o === 'coat' || o === 'jacket' || o === 'robe' || o === 'jumpsuit' ? SL.top : SL.shirt;
  const legs = o === 'jumpsuit' ? SL.top : SL.pants;
  rig.part('hips', roundedBox(0.32 * k * b, 0.2 * k, 0.2 * k * b, 0.05), legs, { pos: [0, 0, 0] });
  rig.part('spine', roundedBox(0.3 * k * b, 0.22 * k, 0.19 * k * b, 0.06), longTop || o === 'jumpsuit' ? SL.top : SL.shirt, { pos: [0, 0.1 * k, 0] });
  rig.part('chest', roundedBox(0.38 * k * b, 0.3 * k, 0.22 * k * b, 0.07), o === 'jumpsuit' || o === 'robe' ? SL.top : SL.shirt, { pos: [0, 0.08 * k, 0] });
  if (o !== 'shirt' && o !== 'robe' && o !== 'jumpsuit') {
    // Coat, vest, jacket or apron bib over the chest.
    const bibOnly = o === 'apron';
    rig.part('chest', roundedBox((bibOnly ? 0.26 : 0.4) * k * b, 0.31 * k, (bibOnly ? 0.226 : 0.235) * k * b, 0.07), SL.top, { pos: [0, 0.08 * k, bibOnly ? 0.01 : -0.005] });
    if (!bibOnly) {
      rig.part('chest', roundedBox(0.08 * k, 0.28 * k, 0.02, 0.01), SL.shirt, { pos: [0, 0.07 * k, 0.118 * k * b] });
      rig.part('chest', roundedBox(0.03 * k, 0.16 * k, 0.015, 0.005), SL.accent, { pos: [0, 0.1 * k, 0.13 * k * b] });
    }
  }
  if (o === 'apron') {
    rig.part('hips', roundedBox(0.3 * k * b, 0.5 * k, 0.02 * k, 0.01), SL.top, { pos: [0, -0.18 * k, 0.11 * k * b] });
    rig.part('spine', roundedBox(0.33 * k * b, 0.03 * k, 0.21 * k * b, 0.01), SL.trim, { pos: [0, 0.0, 0] });
  }
  if (longTop) {
    // Coat skirt / robe down to the shins (robes to the ankles).
    const len = o === 'robe' ? 0.86 : 0.62;
    rig.part('hips', limb(0.2 * k * b, (o === 'robe' ? 0.3 : 0.26) * k * b, len * k, 14, 1, 0.75), SL.top, { pos: [0, 0.02 * k, 0] });
    rig.part('hips', limb((o === 'robe' ? 0.302 : 0.262) * k * b, (o === 'robe' ? 0.302 : 0.262) * k * b, 0.05 * k, 14, 1, 0.75), SL.trim, { pos: [0, -(len - 0.12) * k, 0] });
    rig.part('chest', roundedBox(0.41 * k * b, 0.035 * k, 0.24 * k * b, 0.01), SL.trim, { pos: [0, -0.04 * k, 0] });
  }
  if (o === 'jumpsuit') {
    rig.part('hips', roundedBox(0.34 * k * b, 0.05 * k, 0.22 * k * b, 0.01), SL.trim, { pos: [0, 0.07 * k, 0] });
    rig.part('hips', roundedBox(0.08 * k, 0.1 * k, 0.06 * k, 0.01), SL.dark, { pos: [0.13 * k * b, 0.0, 0.08 * k] });
  }
  if (look.collar) {
    // Gold usekh collar.
    const g = new THREE.RingGeometry(0.07 * k, 0.17 * k, 24, 1).rotateX(-Math.PI / 2);
    rig.part('chest', g, SL.accent, { pos: [0, 0.235 * k, 0.005], rot: [-0.12, 0, 0] });
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
  if (look.beard !== undefined) {
    rig.part('jaw', ellipsoid(0.072 * k, 0.05 * k, 0.06 * k, 12, 8), SL.beard, { pos: [0, 0.0, 0.022 * k] });
    rig.part('head', roundedBox(0.06 * k, 0.012 * k, 0.02 * k, 0.005), SL.beard, { pos: [0, 0.07 * k, 0.093 * k] });
  }
  if (look.goggles) {
    rig.part('head', roundedBox(0.17 * k, 0.035 * k, 0.04 * k, 0.012), SL.dark, { pos: [0, 0.17 * k, 0.07 * k], rot: [-0.3, 0, 0] });
    for (const s of [-1, 1]) {
      rig.part('head', limb(0.026 * k, 0.026 * k, 0.028 * k, 10), SL.accent, { pos: [s * 0.04 * k, 0.17 * k, 0.098 * k], rot: [Math.PI / 2 - 0.3, 0, 0] });
      rig.part('head', ellipsoid(0.02 * k, 0.02 * k, 0.006 * k, 10, 6), SL.iris, { pos: [s * 0.04 * k, 0.172 * k, 0.112 * k], rot: [-0.3, 0, 0] });
    }
  }
  // Hair.
  const hs = look.hairStyle;
  if (hs === 'wrap' || hs === 'cap') {
    rig.part('head', ellipsoid(0.105 * k, 0.1 * k, 0.11 * k, 16, 10), SL.wrap, { pos: [0, 0.17 * k, -0.02 * k] });
    if (hs === 'wrap') {
      rig.part('head', ellipsoid(0.08 * k, 0.12 * k, 0.08 * k, 12, 8), SL.wrap, { pos: [0, 0.24 * k, -0.04 * k], rot: [-0.4, 0, 0] });
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.65 + (i / 8) * 0.7);
        rig.part('head', capsule(0.014 * k, 0.16 * k, 3, 6), SL.hair, { pos: [Math.cos(a) * 0.085 * k, 0.04 * k, Math.sin(a) * 0.075 * k - 0.02] });
      }
    } else {
      rig.part('head', roundedBox(0.16 * k, 0.015 * k, 0.1 * k, 0.006), SL.wrap, { pos: [0, 0.18 * k, 0.1 * k], rot: [0.15, 0, 0] });
    }
  } else if (hs === 'short') {
    rig.part('head', ellipsoid(0.09 * k, 0.07 * k, 0.1 * k, 14, 8), SL.hair, { pos: [0, 0.16 * k, -0.008 * k] });
  } else if (hs === 'afro') {
    rig.part('head', ellipsoid(0.135 * k, 0.12 * k, 0.13 * k, 16, 12), SL.hair, { pos: [0, 0.19 * k, -0.02 * k] });
  } else if (hs === 'bob') {
    rig.part('head', ellipsoid(0.1 * k, 0.09 * k, 0.11 * k, 16, 10), SL.hair, { pos: [0, 0.16 * k, -0.01 * k] });
    rig.part('head', limb(0.1 * k, 0.105 * k, 0.12 * k, 16, 1, 1.05), SL.hair, { pos: [0, 0.16 * k, -0.02 * k] });
    rig.part('head', roundedBox(0.2 * k, 0.012 * k, 0.21 * k, 0.005), SL.accent, { pos: [0, 0.19 * k, -0.01 * k] });
  } else if (hs === 'bun') {
    rig.part('head', ellipsoid(0.092 * k, 0.075 * k, 0.1 * k, 14, 8), SL.hair, { pos: [0, 0.16 * k, -0.01 * k] });
    rig.part('head', ellipsoid(0.05 * k, 0.05 * k, 0.05 * k, 10, 8), SL.hair, { pos: [0, 0.23 * k, -0.07 * k] });
  } else if (hs === 'locs') {
    rig.part('head', ellipsoid(0.095 * k, 0.08 * k, 0.1 * k, 14, 8), SL.hair, { pos: [0, 0.16 * k, -0.01 * k] });
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (0.55 + (i / 11) * 0.9);
      rig.part('head', capsule(0.016 * k, 0.22 * k, 3, 6), SL.hair, { pos: [Math.cos(a) * 0.09 * k, 0.03 * k, Math.sin(a) * 0.08 * k - 0.02] });
    }
  }
  // Arms and legs.
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    rig.part(`upperArm${n}`, limb(0.05 * k * b, 0.045 * k * b, 0.29 * k, 10), sleeve);
    rig.part(`foreArm${n}`, limb(0.044 * k * b, 0.036 * k * b, 0.26 * k, 10), o === 'vest' || o === 'apron' || o === 'shirt' ? SL.skin : sleeve);
    if (longTop) rig.part(`foreArm${n}`, limb(0.046 * k, 0.046 * k, 0.03 * k, 10), SL.trim, { pos: [0, -0.2 * k, 0] });
    rig.part(`hand${n}`, roundedBox(0.06 * k, 0.09 * k, 0.03 * k, 0.012), SL.skin, { pos: [0, -0.045 * k, 0.005] });
    rig.part(`hand${n}`, roundedBox(0.018 * k, 0.05 * k, 0.02 * k, 0.006), SL.skin, { pos: [side * -0.032 * k, -0.03 * k, 0.015], rot: [0, 0, side * 0.5] });
    rig.part(`thigh${n}`, limb(0.08 * k * b, 0.06 * k * b, 0.43 * k, 10), legs);
    rig.part(`shin${n}`, limb(0.058 * k * b, 0.045 * k * b, 0.44 * k, 10), legs);
    rig.part(`foot${n}`, roundedBox(0.09 * k, 0.07 * k, 0.22 * k, 0.025), SL.dark, { pos: [0, -0.035 * k, 0.05 * k] });
  }
  if (look.prop === 'tablet') rig.part('handL', roundedBox(0.16 * k, 0.22 * k, 0.012 * k, 0.008), SL.screen, { pos: [0.02, -0.1 * k, 0.04], rot: [0.2, 0, 0] });
  if (look.prop === 'ladle') {
    rig.part('handR', limb(0.01 * k, 0.01 * k, 0.32 * k, 6), SL.accent, { pos: [0, -0.06 * k, 0.03], rot: [0.4, 0, 0] });
    rig.part('handR', ellipsoid(0.04 * k, 0.025 * k, 0.04 * k, 8, 6), SL.accent, { pos: [0, -0.34 * k, 0.15 * k] });
  }
  if (look.prop === 'tool') rig.part('handR', limb(0.012 * k, 0.008 * k, 0.18 * k, 6), SL.screen, { pos: [0, -0.06 * k, 0.03], rot: [0.9, 0, 0] });
  if (look.prop === 'lamp') {
    rig.part('handL', limb(0.006 * k, 0.006 * k, 0.12 * k, 6), SL.accent, { pos: [0, -0.06 * k, 0.02] });
    rig.part('handL', ellipsoid(0.045 * k, 0.06 * k, 0.045 * k, 10, 8), SL.screen, { pos: [0, -0.22 * k, 0.02] });
  }

  const pal: PaletteEntry[] = [];
  pal[SL.skin] = { color: look.skin, roughness: 0.55, metalness: 0 };
  pal[SL.top] = { color: look.top, roughness: 0.75, metalness: 0.05 };
  pal[SL.trim] = { color: look.trim, roughness: 0.4, metalness: 0.2, emissive: look.glowTrim ? 0.6 : 0 };
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
  pal[SL.beard] = { color: look.beard ?? look.hair, roughness: 0.9, metalness: 0 };
  const material = paletteMaterial(pal);
  const built = rig.build(material);
  cullAsPerson(built.mesh, look.height);
  const bones: Record<string, THREE.Bone> = {};
  for (const bone of built.skeleton.bones) bones[bone.name] = bone;
  built.mesh.castShadow = true;
  return { mesh: built.mesh, bones, material };
}

// ---- Civilians: a few body variants, recoloured per person ----

const SKINS = [0x3a2418, 0x4a2e20, 0x5a3a28, 0x6e4630, 0x8a5a3c, 0xa8724e, 0xc08a62, 0x2e1c14];
const HAIRS = [0x0e0a08, 0x15100c, 0x2a1a10, 0x4a2c16, 0x8a8a8a, 0x5a2a12];
const CLOTH = [0x1f4f5a, 0x7a2a2a, 0xc9a24a, 0x2a4a7a, 0x3a3a3e, 0xd8cbb0, 0x5a7a3a, 0x8a3a6a, 0xe0e0d8, 0x1a1a1e, 0xb45a28, 0x2a8a86];
const PANTS = [0x202024, 0x2a2a30, 0x3a3020, 0x1a2a3a, 0x4a3a2a];

interface Variant {
  outfit: Outfit;
  hairStyle: HairStyle;
  height: number;
  build: number;
}

const VARIANTS: Variant[] = [
  { outfit: 'shirt', hairStyle: 'short', height: 1.78, build: 1.0 },
  { outfit: 'robe', hairStyle: 'wrap', height: 1.66, build: 1.0 },
  { outfit: 'jacket', hairStyle: 'afro', height: 1.72, build: 1.0 },
  { outfit: 'coat', hairStyle: 'bun', height: 1.68, build: 0.95 },
  { outfit: 'vest', hairStyle: 'bald', height: 1.84, build: 1.12 },
  { outfit: 'shirt', hairStyle: 'locs', height: 1.74, build: 0.95 },
  { outfit: 'jumpsuit', hairStyle: 'cap', height: 1.76, build: 1.05 },
  { outfit: 'robe', hairStyle: 'bob', height: 1.7, build: 0.92 },
];

const civilianCache = new Map<number, { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; boneNames: string[]; bind: { pos: THREE.Vector3; parent: number }[] }>();

/** Deterministic pseudo-random for repeatable crowds. */
function rand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A civilian body: shares geometry with others of its variant, gets its own
 * colours. Returns a mesh with a fresh skeleton.
 */
export function buildCivilian(seed: number): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone>; height: number } {
  const r = rand(seed + 17);
  const vi = Math.floor(r() * VARIANTS.length);
  const v = VARIANTS[vi];
  let c = civilianCache.get(vi);
  if (!c) {
    const built = buildPerson({
      skin: SKINS[0], top: CLOTH[0], trim: CLOTH[2], shirt: CLOTH[5], pants: PANTS[0], hair: HAIRS[0], wrap: CLOTH[3],
      hairStyle: v.hairStyle, height: v.height, build: v.build, outfit: v.outfit, accent: 0xd4a640,
    });
    const bones = built.mesh.skeleton.bones;
    c = {
      geometry: built.mesh.geometry,
      material: built.material,
      boneNames: bones.map((b) => b.name),
      bind: bones.map((b) => ({ pos: b.position.clone(), parent: bones.indexOf(b.parent as THREE.Bone) })),
    };
    civilianCache.set(vi, c);
  }
  const bones: THREE.Bone[] = c.boneNames.map((name, i) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(c!.bind[i].pos);
    return b;
  });
  c.bind.forEach((info, i) => {
    if (info.parent >= 0) bones[info.parent].add(bones[i]);
  });
  const mat = clonePaletteMaterial(c.material);
  // The palette arrays are shared by the clone; give this person their own colours.
  const u = mat.userData.uniforms as { uPalColors: { value: THREE.Vector3[] } };
  u.uPalColors.value = u.uPalColors.value.map((x) => x.clone());
  const pick = (a: number[]): number => a[Math.floor(r() * a.length)];
  const set = (slot: number, hex: number): void => {
    const col = new THREE.Color(hex);
    u.uPalColors.value[slot].set(col.r, col.g, col.b);
  };
  set(SL.skin, pick(SKINS));
  set(SL.top, pick(CLOTH));
  set(SL.trim, pick(CLOTH));
  set(SL.shirt, pick(CLOTH));
  set(SL.pants, pick(PANTS));
  set(SL.hair, pick(HAIRS));
  set(SL.wrap, pick(CLOTH));
  const mesh = new THREE.SkinnedMesh(c.geometry, mat);
  mesh.add(bones[0]);
  bones[0].updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  cullAsPerson(mesh, v.height);
  mesh.castShadow = true;
  const byName: Record<string, THREE.Bone> = {};
  for (const b of bones) byName[b.name] = b;
  return { mesh, bones: byName, height: v.height };
}
