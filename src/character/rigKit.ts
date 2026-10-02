import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HASH_GLSL } from '../render/shaderChunks';

/**
 * Tools for building characters in code. A character is a bone hierarchy
 * with rigid armored parts attached to bones. All parts are merged into one
 * SkinnedMesh with weight 1 to their bone ("rigid skinning"), so a whole
 * character is one draw call while still animating per bone. Parts that
 * need smooth deformation (neck) can blend two bones.
 */

export interface PaletteEntry {
  color: THREE.ColorRepresentation;
  roughness: number;
  metalness: number;
  /** Emissive strength (multiplies the colour). */
  emissive?: number;
  /** 0 none, 1 blue-base digital camo, 2 yellow-base digital camo. */
  camo?: number;
}

export interface PaletteMaterialOptions {
  camoBlue?: THREE.ColorRepresentation;
  camoYellow?: THREE.ColorRepresentation;
  camoScale?: number;
}

const MAX_PALETTE = 16;

/**
 * MeshStandardMaterial whose colour, roughness, metalness and emissive come
 * from a palette indexed by a per-vertex `aMat` attribute. Optional
 * procedural digital camo from bind-pose position (`aBind`). Uniforms for hit
 * flash, power glow and dissolve are per instance.
 */
export function paletteMaterial(palette: PaletteEntry[], opts: PaletteMaterialOptions = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const colors: THREE.Vector3[] = [];
  const props: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_PALETTE; i++) {
    const e = palette[i] ?? palette[0];
    const c = new THREE.Color(e.color);
    colors.push(new THREE.Vector3(c.r, c.g, c.b));
    props.push(new THREE.Vector4(e.roughness, e.metalness, e.emissive ?? 0, e.camo ?? 0));
  }
  const blue = new THREE.Color(opts.camoBlue ?? 0x1f4fd6);
  const yellow = new THREE.Color(opts.camoYellow ?? 0xf2c418);
  const uniforms = {
    uPalColors: { value: colors },
    uPalProps: { value: props },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uGlow: { value: new THREE.Vector4(0.2, 0.9, 1, 0) },
    uDissolve: { value: 0 },
    uCamoBlue: { value: new THREE.Vector3(blue.r, blue.g, blue.b) },
    uCamoYellow: { value: new THREE.Vector3(yellow.r, yellow.g, yellow.b) },
    uCamoScale: { value: opts.camoScale ?? 30 },
    uOpacity: { value: 1 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aMat;
attribute vec3 aBind;
varying float vMat;
varying vec3 vBind;
varying vec3 vPalViewN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMat = aMat;
vBind = aBind;`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
vPalViewN = normalize(transformedNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uPalColors[${MAX_PALETTE}];
uniform vec4 uPalProps[${MAX_PALETTE}];
uniform vec4 uFlash;
uniform vec4 uGlow;
uniform float uDissolve;
uniform vec3 uCamoBlue;
uniform vec3 uCamoYellow;
uniform float uCamoScale;
uniform float uOpacity;
varying float vMat;
varying vec3 vBind;
varying vec3 vPalViewN;
${HASH_GLSL}
float na_hash3(vec3 p) {
  return fract(sin(dot(p, vec3(17.13, 61.71, 12.77))) * 43758.5453);
}
float na_vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(na_hash3(i), na_hash3(i + vec3(1,0,0)), f.x), mix(na_hash3(i + vec3(0,1,0)), na_hash3(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(na_hash3(i + vec3(0,0,1)), na_hash3(i + vec3(1,0,1)), f.x), mix(na_hash3(i + vec3(0,1,1)), na_hash3(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Digital camo: noise sampled on a coarse voxel grid so blotches are blocky.
vec3 na_camo(float mode) {
  vec3 q = floor(vBind * uCamoScale) + 0.5;
  float n = na_vnoise3(q * 0.16) * 0.62 + na_vnoise3(q * 0.37 + 11.0) * 0.38;
  float accent = na_vnoise3(q * 0.23 + 47.0);
  vec3 base = mode < 1.5 ? uCamoBlue : uCamoYellow;
  vec3 other = mode < 1.5 ? uCamoYellow : uCamoBlue;
  float th = mode < 1.5 ? 0.6 : 0.62;
  vec3 c = n > th ? other : base;
  // A third tone: darker/lighter patches of the base colour.
  if (n <= th && accent > 0.68) c = base * (mode < 1.5 ? 0.62 : 0.78);
  if (n <= th && accent < 0.2) c = mix(base, vec3(1.0), 0.12);
  return c;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
int palIdx = int(vMat + 0.5);
vec3 palColor = uPalColors[palIdx];
vec4 palProps = uPalProps[palIdx];
if (palProps.w > 0.5) palColor = na_camo(palProps.w);
diffuseColor.rgb *= palColor;
if (uDissolve > 0.0) {
  float dn = na_vnoise3(vBind * 18.0);
  if (dn < uDissolve) discard;
}
diffuseColor.a *= uOpacity;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = palProps.x;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = palProps.y;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += palColor * palProps.z;
float rim = pow(1.0 - abs(dot(normalize(vPalViewN), vec3(0.0, 0.0, 1.0))), 2.0);
totalEmissiveRadiance += uFlash.rgb * uFlash.a;
totalEmissiveRadiance += uGlow.rgb * uGlow.a * (0.25 + rim * 1.6);
if (uDissolve > 0.0) {
  float dn2 = na_vnoise3(vBind * 18.0);
  totalEmissiveRadiance += vec3(1.0, 0.55, 0.15) * smoothstep(uDissolve + 0.08, uDissolve, dn2) * 4.0;
}`,
      );
  };
  m.customProgramCacheKey = () => 'palette-v1';
  return m;
}

/** Clone a palette material with its own per-instance uniforms. */
export function clonePaletteMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = src.clone();
  const su = src.userData.uniforms as Record<string, { value: unknown }>;
  const uniforms: Record<string, { value: unknown }> = {};
  for (const k of Object.keys(su)) {
    const v = su[k].value;
    uniforms[k] = { value: v instanceof THREE.Vector4 || v instanceof THREE.Vector3 ? v.clone() : v };
  }
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader, r) => {
    src.onBeforeCompile.call(m, shader, r);
    Object.assign(shader.uniforms, uniforms);
  };
  m.customProgramCacheKey = src.customProgramCacheKey;
  return m;
}

export type Vec3 = [number, number, number];

interface Part {
  geom: THREE.BufferGeometry;
  bone: number;
  /** Optional second bone for smooth blending, with per-vertex weight fn. */
  bone2?: number;
  weight2?: (local: THREE.Vector3) => number;
  mat: number;
}

/**
 * Builds a rigid-skinned character. Bones are created in bind pose; parts
 * are given in bone-local space and baked into model space at build time.
 */
export class RigBuilder {
  readonly root = new THREE.Bone();
  readonly bones: THREE.Bone[] = [];
  private readonly byName = new Map<string, THREE.Bone>();
  private readonly parts: Part[] = [];

  constructor(rootName = 'root') {
    this.root.name = rootName;
    this.bones.push(this.root);
    this.byName.set(rootName, this.root);
  }

  bone(name: string, parent: string, x: number, y: number, z: number): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    const p = this.byName.get(parent);
    if (!p) throw new Error(`Unknown parent bone ${parent}`);
    p.add(b);
    this.bones.push(b);
    this.byName.set(name, b);
    return b;
  }

  get(name: string): THREE.Bone {
    const b = this.byName.get(name);
    if (!b) throw new Error(`Unknown bone ${name}`);
    return b;
  }

  /** Add a part in the bone's local space. `geom` is consumed. */
  part(boneName: string, geom: THREE.BufferGeometry, mat: number, opts?: { pos?: Vec3; rot?: Vec3; scale?: Vec3 }): void {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (opts) {
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(...(opts.pos ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0]))),
        new THREE.Vector3(...(opts.scale ?? [1, 1, 1])),
      );
      g.applyMatrix4(m4);
    }
    this.parts.push({ geom: g, bone: this.bones.indexOf(this.get(boneName)), mat });
  }

  /** A part blended between two bones by `weight2(localPos)`. */
  blendPart(boneName: string, bone2Name: string, geom: THREE.BufferGeometry, mat: number, weight2: (p: THREE.Vector3) => number, opts?: { pos?: Vec3; rot?: Vec3; scale?: Vec3 }): void {
    this.part(boneName, geom, mat, opts);
    const p = this.parts[this.parts.length - 1];
    p.bone2 = this.bones.indexOf(this.get(bone2Name));
    p.weight2 = weight2;
  }

  /** Bakes all parts into one skinned geometry and returns the mesh. */
  build(material: THREE.Material): { mesh: THREE.SkinnedMesh; skeleton: THREE.Skeleton } {
    this.root.updateMatrixWorld(true);
    const geoms: THREE.BufferGeometry[] = [];
    const local = new THREE.Vector3();
    for (const part of this.parts) {
      const g = part.geom;
      const bone = this.bones[part.bone];
      const count = g.attributes.position.count;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      const mat = new Float32Array(count).fill(part.mat);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        skinIndex[i * 4] = part.bone;
        if (part.bone2 !== undefined && part.weight2) {
          local.fromBufferAttribute(pos, i);
          const w2 = THREE.MathUtils.clamp(part.weight2(local), 0, 1);
          skinIndex[i * 4 + 1] = part.bone2;
          skinWeight[i * 4] = 1 - w2;
          skinWeight[i * 4 + 1] = w2;
        } else {
          skinWeight[i * 4] = 1;
        }
      }
      // Bake bone-local → model space.
      g.applyMatrix4(bone.matrixWorld);
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
      g.setAttribute('aBind', (g.attributes.position as THREE.BufferAttribute).clone());
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      }
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'aMat', 'aBind'].includes(name)) g.deleteAttribute(name);
      }
      geoms.push(g);
    }
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('Failed to merge character geometry');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    for (const g of geoms) g.dispose();
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.add(this.root);
    const skeleton = new THREE.Skeleton(this.bones);
    mesh.bind(skeleton);
    mesh.frustumCulled = false;
    return { mesh, skeleton };
  }
}

// ---- Primitive helpers (all return non-indexed-ready BufferGeometry) ----

/** Rounded box with bevelled edges. */
export function roundedBox(w: number, h: number, d: number, r = 0.02, seg = 2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, seg + 1, seg + 1, seg + 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const hd = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = THREE.MathUtils.clamp(v.x, -hw, hw);
    const cy = THREE.MathUtils.clamp(v.y, -hh, hh);
    const cz = THREE.MathUtils.clamp(v.z, -hd, hd);
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      v.set(cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Capsule along Y, centred at origin. */
export function capsule(radius: number, length: number, capSeg = 4, radial = 10): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length, capSeg, radial);
}

/** Tapered limb segment from y=0 down to y=-len (radiusTop at top). */
export function limb(rTop: number, rBottom: number, len: number, radial = 10, sx = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, radial, 2, false);
  g.translate(0, -len / 2, 0);
  g.scale(sx, 1, sz);
  return g;
}

/** Ellipsoid. */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 14, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

/** Curved armour shell: part of a sphere/cylinder band, for pauldrons and plates. */
export function shell(radius: number, phiStart: number, phiLen: number, thetaStart: number, thetaLen: number, thickness = 0.015, ws = 12, hs = 8): THREE.BufferGeometry {
  const outer = new THREE.SphereGeometry(radius, ws, hs, phiStart, phiLen, thetaStart, thetaLen);
  const inner = new THREE.SphereGeometry(radius - thickness, ws, hs, phiStart, phiLen, thetaStart, thetaLen);
  // Flip inner faces.
  const idx = inner.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  const n = inner.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const merged = mergeGeometries([outer.toNonIndexed(), inner.toNonIndexed()]);
  return merged!;
}

export function mergeParts(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geoms.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
    }
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return mergeGeometries(list)!;
}
