import * as THREE from 'three';
import { mergeParts, roundedBox, limb } from '../rigKit';

/**
 * Imani's weapons, built in gun space: origin at the pistol grip, +Z out of
 * the muzzle, +Y up. Sockets mark the muzzle and where each hand goes.
 */
export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  /** Where the left hand supports the weapon. */
  fore: THREE.Object3D;
  mag: THREE.Object3D;
  magMesh: THREE.Mesh;
  setAmmo?: (n: number) => void;
  length: number;
}

const yellow = new THREE.MeshStandardMaterial({ color: 0xf0c020, roughness: 0.42, metalness: 0.08, name: 'gunYellow' });
const black = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.5, metalness: 0.45, name: 'gunBlack' });
const lens = new THREE.MeshStandardMaterial({ color: 0x0a2030, roughness: 0.05, metalness: 0.9, emissive: 0x062030, name: 'lens' });

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function socket(group: THREE.Group, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  group.add(o);
  return o;
}

/** Seven-segment style red ammo counter on a small canvas. */
function readout(): { mesh: THREE.Mesh; set: (n: number) => void } {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4), toneMapped: true });
  mat.name = 'readout';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), mat);
  let last = -1;
  const SEG: Record<string, number[]> = {
    '0': [1, 1, 1, 1, 1, 1, 0], '1': [0, 1, 1, 0, 0, 0, 0], '2': [1, 1, 0, 1, 1, 0, 1], '3': [1, 1, 1, 1, 0, 0, 1],
    '4': [0, 1, 1, 0, 0, 1, 1], '5': [1, 0, 1, 1, 0, 1, 1], '6': [1, 0, 1, 1, 1, 1, 1], '7': [1, 1, 1, 0, 0, 0, 0],
    '8': [1, 1, 1, 1, 1, 1, 1], '9': [1, 1, 1, 1, 0, 1, 1],
  };
  const digit = (ch: string, x: number): void => {
    const s = SEG[ch];
    const w = 18;
    const h = 24;
    const t = 4;
    const y = 4;
    const segs: [number, number, number, number][] = [
      [x + t, y, w - 2 * t, t], [x + w - t, y + t, t, h / 2 - t], [x + w - t, y + h / 2, t, h / 2 - t],
      [x + t, y + h - t, w - 2 * t, t], [x, y + h / 2, t, h / 2 - t], [x, y + t, t, h / 2 - t], [x + t, y + h / 2 - t / 2, w - 2 * t, t],
    ];
    segs.forEach((r, i) => {
      g.fillStyle = s[i] ? '#ff2a14' : 'rgba(80,10,6,0.6)';
      g.fillRect(...r);
    });
  };
  const set = (n: number): void => {
    if (n === last) return;
    last = n;
    g.fillStyle = '#120202';
    g.fillRect(0, 0, 64, 32);
    const str = String(Math.max(0, Math.min(99, n))).padStart(2, '0');
    digit(str[0], 8);
    digit(str[1], 36);
    tex.needsUpdate = true;
  };
  set(40);
  return { mesh, set };
}

export function createSmg(): WeaponModel {
  const group = new THREE.Group();
  const y = mergeParts([
    place(roundedBox(0.06, 0.095, 0.3, 0.014), 0, 0.035, 0.07),
    place(roundedBox(0.058, 0.07, 0.11, 0.02), 0, 0.03, -0.13),
    place(roundedBox(0.05, 0.05, 0.05, 0.01), 0, -0.02, 0.07),
    place(roundedBox(0.062, 0.02, 0.06, 0.006), 0, 0.0, 0.2),
  ]);
  const b = mergeParts([
    place(roundedBox(0.03, 0.02, 0.24, 0.004), 0, 0.093, 0.07),
    ...[0, 1, 2, 3, 4, 5].map((i) => place(roundedBox(0.034, 0.008, 0.012, 0.002), 0, 0.105, -0.02 + i * 0.035)),
    place(roundedBox(0.046, 0.052, 0.06, 0.01), 0, 0.04, 0.245),
    place(limb(0.012, 0.012, 0.05, 10), 0, 0.045, 0.27, -Math.PI / 2),
    place(roundedBox(0.034, 0.1, 0.04, 0.01), 0, -0.045, -0.008, 0.25),
    place(roundedBox(0.01, 0.035, 0.05, 0.003), 0, -0.03, 0.035),
    place(roundedBox(0.03, 0.07, 0.035, 0.01), 0, -0.03, 0.16, -0.1),
    place(roundedBox(0.05, 0.03, 0.012, 0.006), 0, 0.02, -0.19),
  ]);
  group.add(new THREE.Mesh(y, yellow), new THREE.Mesh(b, black));
  const magMesh = new THREE.Mesh(place(roundedBox(0.028, 0.11, 0.04, 0.008), 0, -0.04, 0), black);
  const mag = socket(group, 0, -0.04, 0.075);
  mag.rotation.x = 0.15;
  mag.add(magMesh);
  const r = readout();
  r.mesh.position.set(0.0315, 0.05, 0.085);
  r.mesh.rotation.y = Math.PI / 2;
  group.add(r.mesh);
  const r2 = r.mesh.clone();
  r2.position.x = -0.0315;
  r2.rotation.y = -Math.PI / 2;
  group.add(r2);
  group.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return {
    group,
    muzzle: socket(group, 0, 0.045, 0.31),
    fore: socket(group, 0, -0.03, 0.16),
    mag,
    magMesh,
    setAmmo: r.set,
    length: 0.5,
  };
}

export function createRifle(): WeaponModel {
  const group = new THREE.Group();
  const y = mergeParts([
    place(roundedBox(0.055, 0.1, 0.42, 0.015), 0, 0.04, 0.12),
    place(roundedBox(0.045, 0.11, 0.26, 0.02), 0, 0.015, -0.22),
    place(roundedBox(0.05, 0.04, 0.08, 0.01), 0, 0.075, -0.05),
  ]);
  const b = mergeParts([
    place(roundedBox(0.05, 0.13, 0.03, 0.01), 0, 0.0, -0.36),
    place(roundedBox(0.046, 0.06, 0.25, 0.012), 0, 0.035, 0.44),
    place(limb(0.012, 0.012, 0.55, 10), 0, 0.045, 0.56, -Math.PI / 2),
    place(roundedBox(0.03, 0.03, 0.07, 0.008), 0, 0.045, 0.9),
    place(limb(0.022, 0.022, 0.26, 14), 0, 0.125, -0.02, -Math.PI / 2),
    place(limb(0.028, 0.022, 0.05, 14), 0, 0.125, 0.24, -Math.PI / 2),
    place(roundedBox(0.014, 0.04, 0.02, 0.004), 0, 0.1, 0.02),
    place(roundedBox(0.014, 0.04, 0.02, 0.004), 0, 0.1, 0.17),
    place(roundedBox(0.034, 0.1, 0.04, 0.01), 0, -0.045, -0.01, 0.25),
  ]);
  const l = place(new THREE.CircleGeometry(0.02, 14), 0, 0.125, 0.241);
  group.add(new THREE.Mesh(y, yellow), new THREE.Mesh(b, black), new THREE.Mesh(l, lens));
  const magMesh = new THREE.Mesh(place(roundedBox(0.03, 0.12, 0.05, 0.008), 0, -0.05, 0), black);
  const mag = socket(group, 0, -0.02, 0.1);
  mag.add(magMesh);
  group.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return {
    group,
    muzzle: socket(group, 0, 0.045, 0.95),
    fore: socket(group, 0, -0.005, 0.4),
    mag,
    magMesh,
    length: 1.3,
  };
}
