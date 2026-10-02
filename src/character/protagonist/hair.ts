import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../../level/textures';

/**
 * The afro: a volume of small, bumpy curl clusters (instanced) filling an
 * ellipsoid around the head, with a face opening. Inner clusters are darker
 * (roots, shadowed interior), outer ones lighter honey at the tips, with
 * highlights on top. Instances are generated in order of importance so a
 * lower quality preset can simply draw fewer.
 */

const ROOT = new THREE.Color(0x3b2412);
const MID = new THREE.Color(0x94612e);
const TIP = new THREE.Color(0xd29a4e);
const HIGHLIGHT = new THREE.Color(0xecbd74);

/** Hair ellipsoid in head-bone space. */
const C = new THREE.Vector3(0, 0.152, -0.014);
const R = new THREE.Vector3(0.158, 0.168, 0.16);

function curlGeometry(): THREE.BufferGeometry {
  // Smooth-shaded bumpy sphere: shared vertices so normals interpolate.
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = seeded(77);
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rnd() * 0.32;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Is a head-space point part of the hair volume (and not the face)? */
function inHair(x: number, y: number, z: number): number {
  const dx = (x - C.x) / R.x;
  const dy = (y - C.y) / R.y;
  const dz = (z - C.z) / R.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > 1) return -1;
  // Face opening: front, below the hairline, between the curls that frame it.
  const hairline = 0.172;
  if (z > 0.02 && y < hairline && Math.abs(x) < 0.074 + (hairline - y) * 0.12) return -1;
  // Nothing below the jaw except at the back.
  if (y < 0.035 && z > -0.035) return -1;
  if (y < -0.02) return -1;
  // Skip points deep inside the skull.
  const sx = x / 0.072;
  const sy = (y - 0.095) / 0.098;
  const sz = (z - 0.006) / 0.09;
  if (sx * sx + sy * sy + sz * sz < 0.8) return -1;
  return d;
}

export function createHair(maxCount: number): THREE.InstancedMesh {
  const geo = curlGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.02 });
  mat.name = 'hair';
  const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
  const rnd = seeded(1234);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  // Generate outer-shell curls first (most important), then inner fill.
  const outer: [number, number, number, number][] = [];
  const inner: [number, number, number, number][] = [];
  let guard = 0;
  while ((outer.length < maxCount * 0.8 || inner.length < maxCount * 0.2) && guard++ < 400000) {
    const x = C.x + (rnd() * 2 - 1) * R.x;
    const y = C.y + (rnd() * 2 - 1) * R.y;
    const z = C.z + (rnd() * 2 - 1) * R.z;
    const d = inHair(x, y, z);
    if (d < 0) continue;
    if (d > 0.8 && outer.length < maxCount * 0.8) outer.push([x, y, z, d]);
    else if (d > 0.55 && d <= 0.8 && inner.length < maxCount * 0.2) inner.push([x, y, z, d]);
  }
  // Interleave so any prefix has both an even shell and some fill.
  const all: [number, number, number, number][] = [];
  const ratio = outer.length / Math.max(1, inner.length);
  let oi = 0;
  let ii = 0;
  while (all.length < maxCount && (oi < outer.length || ii < inner.length)) {
    for (let k = 0; k < Math.ceil(ratio) && oi < outer.length; k++) all.push(outer[oi++]);
    if (ii < inner.length) all.push(inner[ii++]);
  }
  all.forEach(([x, y, z, d], i) => {
    const outerness = THREE.MathUtils.clamp((d - 0.55) / 0.45, 0, 1);
    const size = (0.0095 + rnd() * 0.0065) * (outerness > 0.5 ? 1 : 1.4);
    p.set(x, y, z);
    e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    q.setFromEuler(e);
    s.set(size, size * (1 + rnd() * 0.5), size);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    // Colour: roots inside, honey tips outside, highlights on top.
    col.copy(ROOT).lerp(MID, Math.min(1, outerness * 1.4));
    if (outerness > 0.5) col.lerp(TIP, (outerness - 0.5) * 2 * (0.6 + rnd() * 0.4));
    const top = THREE.MathUtils.clamp((y - C.y) / R.y, 0, 1);
    if (outerness > 0.7 && rnd() < 0.25 + top * 0.4) col.lerp(HIGHLIGHT, 0.5 + rnd() * 0.4);
    col.multiplyScalar(0.85 + rnd() * 0.25);
    mesh.setColorAt(i, col);
  });
  mesh.count = all.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.maxCount = all.length;
  return mesh;
}
