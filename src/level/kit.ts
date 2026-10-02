import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelBuilder, PropPart } from './LevelBuilder';
import type { MatName } from './matlib';
import { glyphTexture, signTexture, type GlyphKind } from './textures';
import { globalUniforms } from '../render/materials';

/**
 * Egyptian-inspired architecture and street props, built from code.
 * Repeated props are prototypes for instancing; big pieces are merged into
 * the section geometry.
 */

type Mats = Record<MatName, THREE.Material>;

export function taperedBox(wb: number, db: number, wt: number, dt: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wt : wb), (p.getY(i) + 0.5) * h, p.getZ(i) * (top ? dt : db));
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe with bundled-stalk fluting, like a papyrus column. */
function fluted(points: THREE.Vector2[], segments: number, flutes: number, depth: number, yFrom: number, yTo: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points, segments);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y < yFrom || y > yTo) continue;
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const k = 1 + Math.cos(a * flutes) * depth;
    p.setXYZ(i, Math.cos(a) * r * k, y, Math.sin(a) * r * k);
  }
  g.computeVertexNormals();
  return g;
}

export interface Props {
  papyrusColumn: PropPart[];
  lotusColumn: PropPart[];
  lamp: PropPart[];
  crate: PropPart[];
  bench: PropPart[];
  reeds: PropPart[];
  palm: PropPart[];
  speaker: PropPart[];
  stool: PropPart[];
  barrel: PropPart[];
  table: PropPart[];
}

export function createProps(m: Mats): Props {
  // Papyrus column: 7 m tall at scale 1.
  const shaft = fluted(
    [
      new THREE.Vector2(0.0, 0), new THREE.Vector2(0.62, 0), new THREE.Vector2(0.62, 0.35), new THREE.Vector2(0.5, 0.4),
      new THREE.Vector2(0.46, 0.6), new THREE.Vector2(0.52, 1.0), new THREE.Vector2(0.5, 2.5), new THREE.Vector2(0.44, 4.8),
      new THREE.Vector2(0.4, 5.3),
    ],
    16, 8, 0.07, 0.4, 5.3,
  );
  const bands = new THREE.LatheGeometry([new THREE.Vector2(0.43, 5.0), new THREE.Vector2(0.46, 5.05), new THREE.Vector2(0.46, 5.35), new THREE.Vector2(0.42, 5.4)], 16);
  const capital = fluted(
    [new THREE.Vector2(0.38, 5.35), new THREE.Vector2(0.55, 5.8), new THREE.Vector2(0.85, 6.3), new THREE.Vector2(0.95, 6.55), new THREE.Vector2(0.6, 6.6), new THREE.Vector2(0.0, 6.6)],
    16, 16, 0.05, 5.4, 6.6,
  );
  const abacus = new THREE.BoxGeometry(1.1, 0.4, 1.1).translate(0, 6.8, 0);
  const papyrusColumn: PropPart[] = [
    { geometry: mergeGeometries([shaft.toNonIndexed(), abacus.toNonIndexed()])!, material: m.sandstone },
    { geometry: mergeGeometries([bands.toNonIndexed(), capital.toNonIndexed()])!, material: m.gold },
  ];

  // Lotus-bud column: 4 m.
  const lshaft = fluted([new THREE.Vector2(0, 0), new THREE.Vector2(0.38, 0), new THREE.Vector2(0.36, 0.2), new THREE.Vector2(0.3, 0.3), new THREE.Vector2(0.32, 2.8), new THREE.Vector2(0.28, 3.0)], 12, 6, 0.08, 0.3, 3.0);
  const lcap = new THREE.LatheGeometry([new THREE.Vector2(0.27, 3.0), new THREE.Vector2(0.42, 3.3), new THREE.Vector2(0.38, 3.75), new THREE.Vector2(0.22, 3.95), new THREE.Vector2(0.5, 4.0), new THREE.Vector2(0, 4.05)], 12);
  const lotusColumn: PropPart[] = [
    { geometry: lshaft, material: m.lapis },
    { geometry: lcap, material: m.gold },
  ];

  // Street lamp: slim pole with a glowing lotus bud.
  const pole = new THREE.CylinderGeometry(0.05, 0.08, 3.6, 8).translate(0, 1.8, 0);
  const lampBase = new THREE.CylinderGeometry(0.18, 0.22, 0.3, 8).translate(0, 0.15, 0);
  const bud = new THREE.LatheGeometry([new THREE.Vector2(0.05, 3.55), new THREE.Vector2(0.2, 3.75), new THREE.Vector2(0.17, 4.05), new THREE.Vector2(0.02, 4.2)], 10);
  const lamp: PropPart[] = [
    { geometry: mergeGeometries([pole.toNonIndexed(), lampBase.toNonIndexed()])!, material: m.darkMetal },
    { geometry: bud, material: m.neonGold, castShadow: false },
  ];

  // Cargo crate 1.2 m.
  const crateBody = new THREE.BoxGeometry(1.2, 1.1, 1.2).translate(0, 0.55, 0);
  const crateTrim = mergeGeometries([
    new THREE.BoxGeometry(1.26, 0.08, 1.26).translate(0, 0.04, 0).toNonIndexed(),
    new THREE.BoxGeometry(1.26, 0.08, 1.26).translate(0, 1.06, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.08, 1.1, 1.26).translate(0.6, 0.55, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.08, 1.1, 1.26).translate(-0.6, 0.55, 0).toNonIndexed(),
  ])!;
  const crate: PropPart[] = [
    { geometry: crateBody, material: m.metal },
    { geometry: crateTrim, material: m.trim },
  ];

  const bench: PropPart[] = [
    { geometry: mergeGeometries([new THREE.BoxGeometry(2, 0.12, 0.6).translate(0, 0.45, 0).toNonIndexed(), new THREE.BoxGeometry(0.2, 0.45, 0.5).translate(-0.8, 0.22, 0).toNonIndexed(), new THREE.BoxGeometry(0.2, 0.45, 0.5).translate(0.8, 0.22, 0).toNonIndexed()])!, material: m.sandstoneDark },
  ];

  // Papyrus reeds: a clump of thin stalks with fan tops.
  const stalks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.12 + (i % 3) * 0.07;
    const h = 0.45 + (i % 4) * 0.14;
    const s = new THREE.CylinderGeometry(0.008, 0.014, h, 4).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    const top = new THREE.ConeGeometry(0.09, 0.12, 6, 1, true).rotateX(Math.PI).translate(Math.cos(a) * r, h + 0.04, Math.sin(a) * r);
    stalks.push(s.toNonIndexed(), top.toNonIndexed());
  }
  const reeds: PropPart[] = [{ geometry: mergeGeometries(stalks)!, material: m.plant, castShadow: false }];

  // Date palm: segmented trunk and drooping fronds.
  const trunkParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) trunkParts.push(new THREE.CylinderGeometry(0.16, 0.2, 0.6, 7).translate(Math.sin(i * 0.3) * 0.05 * i, 0.3 + i * 0.55, 0).toNonIndexed());
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.PlaneGeometry(0.5, 2.4, 1, 4);
    const p = f.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 1.2;
      p.setXYZ(k, p.getX(k) * (1 - y / 3), y, -y * y * 0.12);
    }
    f.rotateX(-0.6);
    f.rotateY((i / 9) * Math.PI * 2);
    f.translate(0.3, 5.0, 0);
    fronds.push(f.toNonIndexed());
  }
  const palm: PropPart[] = [
    { geometry: mergeGeometries(trunkParts)!, material: m.wood },
    { geometry: mergeGeometries(fronds)!, material: m.plant, castShadow: false },
  ];

  const speaker: PropPart[] = [
    { geometry: new THREE.BoxGeometry(1.4, 2.4, 1.0).translate(0, 1.2, 0), material: m.trim },
    {
      geometry: mergeGeometries([
        new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16).rotateX(Math.PI / 2).translate(0, 0.7, 0.51).toNonIndexed(),
        new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16).rotateX(Math.PI / 2).translate(0, 1.6, 0.51).toNonIndexed(),
        new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12).rotateX(Math.PI / 2).translate(0, 2.15, 0.51).toNonIndexed(),
      ])!,
      material: m.rubber,
    },
  ];

  const stool: PropPart[] = [
    { geometry: mergeGeometries([new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10).translate(0, 0.75, 0).toNonIndexed(), new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6).translate(0, 0.37, 0).toNonIndexed()])!, material: m.gold },
  ];

  const barrel: PropPart[] = [
    { geometry: new THREE.CylinderGeometry(0.35, 0.35, 1.0, 12).translate(0, 0.5, 0), material: m.darkMetal },
  ];

  const table: PropPart[] = [
    { geometry: mergeGeometries([new THREE.CylinderGeometry(0.5, 0.5, 0.05, 14).translate(0, 1.05, 0).toNonIndexed(), new THREE.CylinderGeometry(0.05, 0.12, 1.05, 8).translate(0, 0.52, 0).toNonIndexed()])!, material: m.blackGlass },
  ];

  return { papyrusColumn, lotusColumn, lamp, crate, bench, reeds, palm, speaker, stool, barrel, table };
}

// ---- Merged architecture helpers ----

/** Pylon tower: tapered, with a gorge cornice and glowing glyph panel. */
export function pylon(b: LevelBuilder, m: Mats, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, glow = true): void {
  const pos = new THREE.Vector3(x, y, z);
  b.mesh(taperedBox(w, d, w * 0.8, d * 0.8, h), m.relief, pos, rotY);
  // Torus moulding along the edges and a cavetto cornice.
  const cornice = taperedBox(w * 0.82, d * 0.82, w * 0.92, d * 0.95, 0.9);
  b.mesh(cornice, m.sandstone, new THREE.Vector3(x, y + h, z), rotY);
  b.mesh(new THREE.BoxGeometry(w * 0.93, 0.2, d * 0.96).translate(0, 0.1, 0), m.gold, new THREE.Vector3(x, y + h + 0.9, z), rotY);
  b.blocker(x, y, z, w, h, d, rotY);
  if (glow) {
    // Glyph panel on both faces.
    for (const side of [1, -1]) {
      const panel = new THREE.PlaneGeometry(w * 0.45, h * 0.55);
      if (side < 0) panel.rotateY(Math.PI);
      const off = new THREE.Vector3(0, h * 0.45, (d * 0.92) / 2 * side - 0.02 * -side).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      // Faces are tilted by the taper; push it slightly out.
      off.add(new THREE.Vector3(0, 0, 0.12 * side).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
      b.mesh(panel, m.glowGlyph, new THREE.Vector3(x + off.x, y + off.y, z + off.z), rotY, 1, false, false);
    }
  }
}

export function obelisk(b: LevelBuilder, m: Mats, x: number, y: number, z: number, h: number, w: number, glow = true): void {
  b.mesh(taperedBox(w, w, w * 0.65, w * 0.65, h), m.basalt, new THREE.Vector3(x, y, z));
  const tip = new THREE.ConeGeometry(w * 0.47, w * 0.7, 4).rotateY(Math.PI / 4).translate(0, h + w * 0.35, 0);
  b.mesh(tip, m.gold, new THREE.Vector3(x, y, z));
  b.mesh(new THREE.BoxGeometry(w * 1.6, 0.6, w * 1.6).translate(0, 0.3, 0), m.sandstoneDark, new THREE.Vector3(x, y, z));
  b.blocker(x, y, z, w * 1.1, h, w * 1.1);
  if (glow) {
    for (let i = 0; i < 4; i++) {
      const strip = new THREE.PlaneGeometry(w * 0.12, h * 0.75).translate(0, h * 0.45, 0);
      const a = (i * Math.PI) / 2;
      const r = w * 0.43;
      strip.rotateX(Math.atan2(w * 0.175, h) * 1);
      strip.translate(0, 0, r);
      strip.rotateY(a);
      b.mesh(strip, m.neonCyanDim, new THREE.Vector3(x, y, z), 0, 1, false, false);
    }
  }
}

/** Neon sign: an emissive textured plane plus a soft reflection card on the wet ground. */
export function neonSign(
  b: LevelBuilder, text: string, x: number, y: number, z: number, rotY: number, w: number, h: number, color: string,
  opts: { groundY?: number; reflection?: boolean; glyphs?: boolean; border?: boolean } = {},
): THREE.Mesh {
  const texture = signTexture(text, color, { width: 512, height: Math.round(512 * (h / w)), border: opts.border, glyphs: opts.glyphs });
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.renderOrder = 4;
  b.group.add(mesh);
  // Back plate.
  const plate = new THREE.BoxGeometry(w * 1.04, h * 1.1, 0.08).translate(0, 0, -0.06);
  b.mesh(plate, b.game.mats.trim, new THREE.Vector3(x, y, z), rotY, 1, false, false);
  if (opts.reflection !== false && opts.groundY !== undefined) reflectionCard(b, x, opts.groundY, z, rotY, w, color, y - opts.groundY);
  const c = new THREE.Color(color);
  b.light(x + Math.sin(rotY) * 1.5, y, z + Math.cos(rotY) * 1.5, c, 6, 9, Math.random() < 0.15 ? 1 : 0);
  return mesh;
}

/** A blurred vertical streak on the ground under a light: cheap wet-street reflection. */
export function reflectionCard(b: LevelBuilder, x: number, groundY: number, z: number, rotY: number, w: number, color: string, height: number): void {
  const mat = reflectionMaterial(color);
  const len = Math.min(8, 2 + height * 1.2);
  const g = new THREE.PlaneGeometry(w * 0.9, len).rotateX(-Math.PI / 2).translate(0, 0, len / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, groundY + 0.025, z);
  mesh.rotation.y = rotY;
  mesh.renderOrder = 3;
  b.group.add(mesh);
}

const reflectionMats = new Map<string, THREE.ShaderMaterial>();
function reflectionMaterial(color: string): THREE.ShaderMaterial {
  let m = reflectionMats.get(color);
  if (m) return m;
  const c = new THREE.Color(color);
  m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Vector3(c.r, c.g, c.b) }, uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW; uniform vec3 uColor; uniform float uTime;
      void main(){
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float along = 1.0 - vUv.y;
        float ripple = 0.75 + 0.25 * sin(vW.x * 7.0 + vW.z * 3.0 + uTime * 1.5) * sin(vW.z * 5.0 - uTime);
        float a = pow(across, 1.5) * along * along * ripple * 0.32;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  reflectionMats.set(color, m);
  return m;
}

/** Rotating hologram glyph with scanlines. */
export function hologram(b: LevelBuilder, x: number, y: number, z: number, kind: GlyphKind, color: string, size: number): THREE.Mesh {
  const t = glyphTexture(kind, color);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: t }, uTime: globalUniforms.uTime, uSeed: { value: Math.random() * 10 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime; uniform float uSeed; varying vec2 vUv; varying float vY;
      void main(){
        float glitch = step(0.97, fract(sin(floor(uTime * 8.0 + uSeed) * 12.9898) * 43758.5453));
        vec2 uv = vUv + vec2(glitch * 0.03 * sin(vY * 40.0), 0.0);
        vec3 c = texture2D(uMap, uv).rgb;
        float scan = 0.7 + 0.3 * sin(vY * 90.0 - uTime * 6.0);
        float flick = 0.85 + 0.15 * sin(uTime * 23.0 + uSeed);
        gl_FragColor = vec4(c * scan * flick * 1.8, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.position.set(x, y, z);
  mesh.renderOrder = 4;
  b.group.add(mesh);
  // Projector base.
  b.light(x, y, z, new THREE.Color(color), 4, 7);
  const speed = 0.4 + Math.random() * 0.3;
  b.anims.push((time) => {
    mesh.rotation.y = time * speed;
    mesh.position.y = y + Math.sin(time * 1.3) * 0.08;
  });
  return mesh;
}

/** Market stall: counter (low cover), posts, striped awning, neon trim. */
export function stall(b: LevelBuilder, m: Mats, x: number, z: number, rotY: number, awning: 'awningTeal' | 'awningRed', neon: MatName): void {
  const w = 3.2;
  const d = 1.3;
  b.box(x, 0, z, w, 1.1, d, { mat: m.wood, rotY, cover: 'low' });
  const rot = (lx: number, lz: number): THREE.Vector3 => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(new THREE.Vector3(x, 0, z));
  b.box(rot(0, 0).x, 1.1, rot(0, 0).z, w + 0.1, 0.06, d + 0.1, { mat: m.gold, rotY, collide: false });
  for (const sx of [-1, 1]) {
    const p = rot((sx * w) / 2 - sx * 0.1, -d / 2 + 0.1);
    b.box(p.x, 0, p.z, 0.1, 2.6, 0.1, { mat: m.darkMetal, rotY, collide: false });
  }
  // Sloped awning.
  const aw = new THREE.BoxGeometry(w + 0.6, 0.05, d + 1.4);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25));
  const c = rot(0, 0.2);
  b.meshMatrix(aw, m[awning], new THREE.Matrix4().compose(new THREE.Vector3(c.x, 2.65, c.z), q, new THREE.Vector3(1, 1, 1)));
  // Neon edge along the awning front.
  const f = rot(0, d / 2 + 0.85);
  b.box(f.x, 2.45, f.z, w + 0.6, 0.05, 0.05, { mat: m[neon], rotY, collide: false, shadow: false });
  // Goods on the counter.
  for (let i = 0; i < 4; i++) {
    const p = rot(-w / 2 + 0.5 + i * 0.75, 0);
    b.box(p.x, 1.16, p.z, 0.35, 0.18 + (i % 2) * 0.15, 0.35, { mat: i % 2 ? m.neonGold : m.lapis, rotY: rotY + i, collide: false, shadow: false });
  }
  b.light(c.x, 2.2, c.z, m[neon] instanceof THREE.MeshBasicMaterial ? (m[neon] as THREE.MeshBasicMaterial).color.clone().multiplyScalar(0.3) : new THREE.Color(0xffc060), 5, 7);
}

/** Planter: low stone box with papyrus reeds; low cover. */
export function planter(b: LevelBuilder, m: Mats, props: Props, x: number, y: number, z: number, w: number, d: number, rotY = 0): void {
  b.box(x, y, z, w, 0.95, d, { mat: m.sandstoneDark, rotY, cover: 'low' });
  b.box(x, y + 0.95, z, w + 0.12, 0.08, d + 0.12, { mat: m.gold, rotY, collide: false });
  const n = Math.max(1, Math.round((w * d) / 1.5));
  for (let i = 0; i < n; i++) {
    const lx = (((i + 0.5) / n) - 0.5) * (w - 0.5);
    const p = new THREE.Vector3(lx, 0, (i % 2 ? 0.15 : -0.15) * d).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    b.instance(props.reeds, x + p.x, y + 0.95, z + p.z, i * 1.7, 0.9 + (i % 3) * 0.15);
  }
}

/** Cover crate: collider + cover from a box, visuals instanced. */
export function crateCover(b: LevelBuilder, props: Props, x: number, y: number, z: number, rotY = 0, stack = 1): void {
  b.box(x, y, z, 1.26, 1.1 * stack, 1.26, { mat: b.game.mats.metal, rotY, visible: false, cover: true, surface: 'metal' });
  for (let i = 0; i < stack; i++) b.instance(props.crate, x, y + i * 1.1, z, rotY + i * 0.3);
}

/** A building front along the street: plaster wall, pilasters, lit windows, door. */
export function facade(b: LevelBuilder, m: Mats, x0: number, z0: number, z1: number, height: number, side: 1 | -1, style: 'teal' | 'ochre' | 'stone'): void {
  const len = Math.abs(z1 - z0);
  const zc = (z0 + z1) / 2;
  const mat = style === 'teal' ? m.plasterTeal : style === 'ochre' ? m.plasterOchre : m.sandstone;
  const thick = 1;
  const xc = x0 + side * (thick / 2);
  b.box(xc, 0, zc, thick, height, len, { mat });
  // Cornice.
  b.box(xc - side * 0.25, height, zc, thick + 0.5, 0.5, len + 0.2, { mat: m.sandstone, collide: false });
  b.box(xc - side * 0.3, height + 0.5, zc, thick + 0.6, 0.12, len + 0.3, { mat: m.gold, collide: false });
  // Pilasters and windows.
  const bays = Math.max(1, Math.floor(len / 4));
  for (let i = 0; i <= bays; i++) {
    const z = Math.min(z0, z1) + (i * len) / bays;
    b.box(x0 - side * 0.15, 0, z, 0.3, height, 0.5, { mat: m.sandstoneDark, collide: false });
    if (i < bays) {
      const wz = z + len / bays / 2;
      for (let f = 1; f < Math.floor(height / 3.2); f++) {
        const lit = (i * 7 + f * 3) % 4 !== 0;
        b.box(x0 - side * 0.03, f * 3.2 + 0.6, wz, 0.06, 1.5, 1.6, { mat: lit ? ((i + f) % 3 === 0 ? m.windowCool : (i + f) % 3 === 1 ? m.windowWarm : m.windowWarm2) : m.blackGlass, collide: false, shadow: false });
        b.box(x0 - side * 0.06, f * 3.2 + 0.5, wz, 0.1, 0.12, 1.9, { mat: m.trim, collide: false });
      }
    }
  }
}
