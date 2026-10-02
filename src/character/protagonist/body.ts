import * as THREE from 'three';
import { RigBuilder, roundedBox, limb, ellipsoid, shell, type PaletteEntry } from '../rigKit';

/** Palette slots for Imani's body material. */
export const S = {
  SUIT: 0, PLATE: 1, STRAP: 2, GLOVE: 3, SOLE: 4, METAL: 5, SKIN: 6, EYEW: 7,
  IRIS: 8, PUPIL: 9, LIPS: 10, BROW: 11, KA: 12, GOLD: 13, LASH: 14,
} as const;

/** Colours from docs/protagonist.md. */
export const PALETTE: PaletteEntry[] = [
  { color: 0xffffff, roughness: 0.78, metalness: 0.02, camo: 1 }, // suit: blue-base digital camo
  { color: 0xffffff, roughness: 0.42, metalness: 0.12, camo: 2 }, // plates: yellow-base digital camo
  { color: 0x161616, roughness: 0.85, metalness: 0.05 }, // straps, belt
  { color: 0x161a2a, roughness: 0.6, metalness: 0.1 }, // gloves (navy-black)
  { color: 0x0d0d0f, roughness: 0.92, metalness: 0 }, // soles
  { color: 0x2a2d33, roughness: 0.35, metalness: 0.85 }, // dark metal
  { color: 0x8c5a3a, roughness: 0.52, metalness: 0 }, // skin (warm medium brown)
  { color: 0xeee7dc, roughness: 0.25, metalness: 0 }, // eye whites
  { color: 0x9a6428, roughness: 0.2, metalness: 0 }, // iris: light amber-brown
  { color: 0x0a0604, roughness: 0.15, metalness: 0 }, // pupil
  { color: 0x9a5c5e, roughness: 0.38, metalness: 0 }, // lips: rose-mauve
  { color: 0x2a1a10, roughness: 0.85, metalness: 0 }, // brows / scalp
  { color: 0x40e6ff, roughness: 0.3, metalness: 0, emissive: 2.4 }, // ka-amp glow
  { color: 0xd4a640, roughness: 0.3, metalness: 0.9 }, // gold
  { color: 0x120c08, roughness: 0.9, metalness: 0 }, // lashes
];

function gauss(p: THREE.Vector3, c: THREE.Vector3, sigma: number): number {
  return Math.exp(-p.distanceToSquared(c) / (2 * sigma * sigma));
}

/**
 * Head sculpted from a sphere: oval face, defined cheekbones, eye sockets,
 * brow ridge, nose bridge, a narrow rounded chin. Returned in head-bone
 * space centred at the skull.
 */
export function sculptHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const cheekL = new THREE.Vector3(0.62, -0.08, 0.72);
  const cheekR = new THREE.Vector3(-0.62, -0.08, 0.72);
  const eyeL = new THREE.Vector3(0.36, 0.1, 0.9);
  const eyeR = new THREE.Vector3(-0.36, 0.1, 0.9);
  const brow = new THREE.Vector3(0, 0.33, 0.92);
  const bridge = new THREE.Vector3(0, 0.02, 1.0);
  const mouth = new THREE.Vector3(0, -0.42, 0.9);
  const chin = new THREE.Vector3(0, -0.82, 0.55);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v);
    let r = 1;
    r += 0.06 * gauss(n, cheekL, 0.2) + 0.06 * gauss(n, cheekR, 0.2);
    r -= 0.1 * gauss(n, eyeL, 0.12) + 0.1 * gauss(n, eyeR, 0.12);
    r += 0.035 * gauss(n, brow, 0.18);
    r += 0.07 * Math.exp(-((n.x * n.x) / (2 * 0.06 * 0.06) + ((n.y - 0.02) ** 2) / (2 * 0.22 * 0.22))) * Math.max(0, n.z);
    r += 0.035 * gauss(n, mouth, 0.16);
    r += 0.03 * gauss(n, chin, 0.16);
    void bridge;
    v.multiplyScalar(r);
    // Oval proportions.
    let x = v.x * 0.074;
    let y = v.y * 0.1;
    let z = v.z * 0.088;
    // Jaw taper toward a narrow chin.
    if (v.y < 0) {
      const t = Math.min(1, -v.y);
      x *= 1 - 0.32 * Math.pow(t, 1.4);
      if (v.z > 0) z *= 1 + 0.06 * t;
    }
    // Fuller back of the skull.
    if (v.z < 0) z *= 1.1;
    // Slightly flatter temples.
    if (v.y > 0.1) x *= 0.97;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Adds every body part to the rig. */
export function buildBody(rig: RigBuilder): void {
  const P = (bone: string, g: THREE.BufferGeometry, mat: number, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): void =>
    rig.part(bone, g, mat, { pos, rot });

  // ---- Pelvis and belt ----
  P('hips', roundedBox(0.335, 0.2, 0.21, 0.07), S.SUIT, [0, -0.02, 0]);
  for (const s of [-1, 1]) {
    P('hips', ellipsoid(0.085, 0.09, 0.075), S.SUIT, [s * 0.075, -0.065, -0.055]);
    P('hips', roundedBox(0.05, 0.11, 0.13, 0.02), S.PLATE, [s * 0.17, -0.005, 0.005], [0, 0, s * 0.12]);
    P('hips', roundedBox(0.07, 0.07, 0.04, 0.015), S.STRAP, [s * 0.115, 0.04, 0.11]);
  }
  P('hips', roundedBox(0.35, 0.055, 0.235, 0.02), S.STRAP, [0, 0.065, 0]);
  P('hips', roundedBox(0.06, 0.042, 0.02, 0.006), S.METAL, [0, 0.065, 0.12]);
  P('hips', roundedBox(0.13, 0.07, 0.045, 0.015), S.STRAP, [0, 0.035, -0.125]);

  // ---- Abdomen ----
  P('spine', roundedBox(0.27, 0.2, 0.18, 0.07), S.SUIT, [0, 0.08, 0]);
  for (let i = 0; i < 3; i++) P('spine', roundedBox(0.19 - i * 0.01, 0.054, 0.036, 0.012), S.PLATE, [0, 0.025 + i * 0.058, 0.088], [-0.06, 0, 0]);

  // ---- Chest, plate carrier, collar ----
  P('chest', roundedBox(0.33, 0.25, 0.2, 0.08), S.SUIT, [0, 0.06, 0]);
  for (const s of [-1, 1]) {
    P('chest', ellipsoid(0.068, 0.062, 0.058), S.SUIT, [s * 0.064, 0.045, 0.075]);
    P('chest', roundedBox(0.155, 0.13, 0.045, 0.022), S.PLATE, [s * 0.078, 0.065, 0.113], [-0.16, s * 0.24, s * -0.06]);
  }
  P('chest', roundedBox(0.06, 0.11, 0.04, 0.015), S.PLATE, [0, 0.04, 0.122]);
  P('chest', roundedBox(0.27, 0.05, 0.04, 0.015), S.PLATE, [0, -0.035, 0.104], [-0.05, 0, 0]);
  P('chest', roundedBox(0.3, 0.23, 0.05, 0.03), S.PLATE, [0, 0.07, -0.108]);
  P('chest', roundedBox(0.22, 0.03, 0.055, 0.01), S.METAL, [0, -0.04, -0.11]);
  // Jump-jet nozzles on the back plate, with ka-glow rims.
  for (const s of [-1, 1]) {
    P('chest', limb(0.026, 0.034, 0.08, 10), S.METAL, [s * 0.075, 0.02, -0.15], [0.35, 0, 0]);
    P('chest', limb(0.036, 0.036, 0.008, 10), S.KA, [s * 0.075, -0.055, -0.175], [0.35, 0, 0]);
  }
  // High mock-neck collar.
  P('chest', limb(0.073, 0.098, 0.115, 16), S.SUIT, [0, 0.275, -0.005]);
  // Harness straps over the shoulders and the rifle sling across the chest.
  for (const s of [-1, 1]) {
    P('chest', roundedBox(0.036, 0.2, 0.012, 0.005), S.STRAP, [s * 0.1, 0.13, 0.128], [-0.25, 0, 0]);
    P('chest', roundedBox(0.036, 0.2, 0.012, 0.005), S.STRAP, [s * 0.1, 0.13, -0.135], [0.2, 0, 0]);
    P('chest', roundedBox(0.038, 0.014, 0.25, 0.005), S.STRAP, [s * 0.11, 0.235, -0.002]);
  }
  P('chest', roundedBox(0.042, 0.5, 0.012, 0.005), S.STRAP, [0.005, 0.015, 0.142], [0, 0, -0.62]);
  P('chest', roundedBox(0.03, 0.03, 0.02, 0.006), S.METAL, [0.07, 0.11, 0.146]);

  // ---- Neck and ka-amp implant ----
  P('neck', limb(0.046, 0.051, 0.11, 12), S.SKIN, [0, 0.095, 0.005]);
  P('neck', roundedBox(0.042, 0.05, 0.016, 0.006), S.METAL, [0, 0.055, -0.046]);
  P('neck', roundedBox(0.026, 0.032, 0.006, 0.002), S.KA, [0, 0.055, -0.055]);

  // ---- Head ----
  const head = sculptHead();
  P('head', head, S.SKIN, [0, 0.095, 0.006]);
  // Scalp under the hair.
  P('head', ellipsoid(0.077, 0.062, 0.088, 16, 10), S.BROW, [0, 0.148, -0.006]);
  // Nose.
  P('head', ellipsoid(0.011, 0.0105, 0.012, 12, 8), S.SKIN, [0, 0.068, 0.0885]);
  for (const s of [-1, 1]) P('head', ellipsoid(0.0078, 0.0062, 0.0072, 10, 6), S.SKIN, [s * 0.0105, 0.064, 0.0825]);
  // Eyes: whites, amber irises, pupils.
  for (const s of [-1, 1]) {
    P('head', ellipsoid(0.0122, 0.0122, 0.0122, 14, 10), S.EYEW, [s * 0.032, 0.088, 0.0735]);
    P('head', ellipsoid(0.0066, 0.0066, 0.0028, 14, 8), S.IRIS, [s * 0.032, 0.0885, 0.0853]);
    P('head', ellipsoid(0.0029, 0.0029, 0.0015, 10, 6), S.PUPIL, [s * 0.032, 0.0885, 0.0881]);
    // Lower lid line.
    P('head', roundedBox(0.022, 0.003, 0.006, 0.0012), S.SKIN, [s * 0.032, 0.0775, 0.081], [0.4, 0, 0]);
    // Brows: full, softly arched.
    P('head', roundedBox(0.019, 0.0055, 0.008, 0.0025), S.BROW, [s * 0.022, 0.1055, 0.0855], [0.15, 0, s * 0.12]);
    P('head', roundedBox(0.017, 0.0048, 0.008, 0.0022), S.BROW, [s * 0.04, 0.106, 0.081], [0.15, s * 0.3, s * -0.22]);
  }
  // Lips: full, closed; a slight lift at her right corner.
  P('head', ellipsoid(0.021, 0.0062, 0.0105, 14, 8), S.LIPS, [0, 0.0475, 0.0845], [0.15, 0, 0.03]);
  P('head', ellipsoid(0.006, 0.003, 0.004, 8, 6), S.SKIN, [-0.0225, 0.0455, 0.081], [0, 0, 0.5]);
  P('jaw', ellipsoid(0.0195, 0.0068, 0.0105, 14, 8), S.LIPS, [0, 0.0275, 0.0565], [-0.1, 0, 0]);

  // Eyelids (blink by rotating the lid bones).
  for (const side of ['L', 'R'] as const) {
    const lid = new THREE.SphereGeometry(0.0131, 14, 8, 0, Math.PI * 2, 0, 0.78);
    rig.part(`lid${side}`, lid, S.SKIN, { rot: [0.18, 0, 0] });
    rig.part(`lid${side}`, roundedBox(0.023, 0.0026, 0.0035, 0.001), S.LASH, { pos: [0, 0.0062, 0.0119], rot: [0.96, 0, 0] });
  }

  // ---- Arms ----
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const ua = `upperArm${side}`;
    P(ua, limb(0.05, 0.043, 0.28, 12), S.SUIT);
    P(ua, ellipsoid(0.056, 0.062, 0.056), S.SUIT, [s * 0.005, -0.03, 0]);
    // Layered pauldron.
    for (let i = 0; i < 3; i++) {
      const r = 0.074 - i * 0.005;
      const cap = shell(r, 0, Math.PI * 2, 0, Math.PI / 2.4, 0.008, 16, 6);
      cap.scale(1, 0.6, 1.0);
      P(ua, cap, S.PLATE, [s * (0.014 + i * 0.006), 0.016 - i * 0.03, 0], [0, 0, s * -(0.3 + i * 0.14)]);
    }
    P(ua, roundedBox(0.028, 0.11, 0.066, 0.012), S.PLATE, [s * 0.044, -0.155, 0.004]);
    P(ua, limb(0.048, 0.048, 0.02, 12), S.STRAP, [0, -0.2, 0]);
    const fa = `foreArm${side}`;
    P(fa, limb(0.043, 0.036, 0.25, 12), S.SUIT);
    P(fa, roundedBox(0.088, 0.155, 0.086, 0.022), S.PLATE, [0, -0.135, 0]);
    P(fa, limb(0.046, 0.046, 0.025, 12), S.METAL, [0, -0.215, 0]);
    // Glove: palm faces inward (-s on X); knuckles run along Z.
    const h = `hand${side}`;
    P(h, roundedBox(0.032, 0.085, 0.074, 0.012), S.GLOVE, [0, -0.045, 0.004]);
    P(h, roundedBox(0.012, 0.03, 0.07, 0.005), S.METAL, [s * 0.019, -0.074, 0.004]);
    const fz = [-0.026, -0.0085, 0.0085, 0.025];
    const fl = [0.062, 0.075, 0.072, 0.06];
    for (let i = 0; i < 4; i++) {
      const cap = new THREE.CapsuleGeometry(0.0085, fl[i] - 0.017, 3, 6);
      P(`fingers${side}`, cap, S.GLOVE, [0, -fl[i] / 2, fz[i]]);
    }
    P(`thumb${side}`, new THREE.CapsuleGeometry(0.0105, 0.04, 3, 6), S.GLOVE, [0, -0.028, 0.004], [-0.4, 0, -s * 0.3]);
  }

  // ---- Legs ----
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const th = `thigh${side}`;
    P(th, limb(0.09, 0.063, 0.43, 14), S.SUIT);
    P(th, roundedBox(0.036, 0.25, 0.155, 0.02), S.PLATE, [s * 0.086, -0.125, 0.01], [0, 0, s * 0.07]);
    P(th, roundedBox(0.105, 0.15, 0.03, 0.012), S.PLATE, [0, -0.17, 0.073], [-0.05, 0, 0]);
    P(th, limb(0.083, 0.08, 0.02, 14), S.STRAP, [0, -0.3, 0]);
    if (side === 'R') {
      P(th, roundedBox(0.045, 0.13, 0.1, 0.015), S.STRAP, [-0.094, -0.245, 0.0]);
      P(th, roundedBox(0.05, 0.03, 0.105, 0.008), S.PLATE, [-0.095, -0.17, 0.0]);
    } else {
      P(th, roundedBox(0.045, 0.1, 0.075, 0.012), S.METAL, [0.093, -0.28, 0.02]);
    }
    const sh = `shin${side}`;
    P(sh, limb(0.06, 0.045, 0.42, 12), S.SUIT);
    P(sh, ellipsoid(0.066, 0.076, 0.047), S.PLATE, [0, -0.005, 0.054]);
    P(sh, roundedBox(0.095, 0.24, 0.058, 0.022), S.PLATE, [0, -0.22, 0.042]);
    P(sh, roundedBox(0.088, 0.16, 0.05, 0.02), S.PLATE, [0, -0.17, -0.043]);
    P(sh, limb(0.063, 0.06, 0.018, 12), S.STRAP, [0, -0.12, 0]);
    P(sh, limb(0.055, 0.053, 0.018, 12), S.STRAP, [0, -0.31, 0]);
    const ft = `foot${side}`;
    P(ft, limb(0.058, 0.06, 0.06, 12), S.PLATE, [0, 0.055, 0]);
    P(ft, roundedBox(0.1, 0.11, 0.17, 0.035), S.SUIT, [0, -0.005, 0.03]);
    P(ft, roundedBox(0.106, 0.036, 0.125, 0.012), S.SOLE, [0, -0.044, -0.012]);
    const toe = `toe${side}`;
    P(toe, roundedBox(0.1, 0.068, 0.095, 0.03), S.SUIT, [0, 0.016, 0.015]);
    P(toe, roundedBox(0.106, 0.031, 0.112, 0.012), S.SOLE, [0, -0.0145, 0.015]);
  }
}
