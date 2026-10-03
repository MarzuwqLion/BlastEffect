import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SIGNS } from '../../strings';
import { globalUniforms } from '../../render/materials';
import type { Game } from '../../game/Game';
import { hologram, neonSign, planter, stall } from '../kit';
import type { LevelBuilder } from '../LevelBuilder';
import type { MatName } from '../matlib';

type Mats = Record<MatName, THREE.Material>;

/**
 * Optional areas off the main route: the Glass (an observation gallery off
 * the dock), Souk Hathor (a night market off the strip) and the Shrine of
 * Hathor with Mari's room (a rooftop garden off the terraces).
 */

type Style = 'teal' | 'ochre' | 'stone';

/** A building wall running along x (the strip's facade() runs along z). */
function wallX(b: LevelBuilder, m: Mats, z0: number, x0: number, x1: number, height: number, side: 1 | -1, style: Style): void {
  const len = Math.abs(x1 - x0);
  const xc = (x0 + x1) / 2;
  const mat = style === 'teal' ? m.plasterTeal : style === 'ochre' ? m.plasterOchre : m.sandstone;
  const zc = z0 + side * 0.5;
  b.box(xc, 0, zc, len, height, 1, { mat });
  b.box(xc, height, zc - side * 0.25, len + 0.2, 0.5, 1.5, { mat: m.sandstone, collide: false });
  b.box(xc, height + 0.5, zc - side * 0.3, len + 0.3, 0.12, 1.6, { mat: m.gold, collide: false });
  const bays = Math.max(1, Math.floor(len / 4));
  for (let i = 0; i <= bays; i++) {
    const x = Math.min(x0, x1) + (i * len) / bays;
    b.box(x, 0, z0 - side * 0.15, 0.5, height, 0.3, { mat: m.sandstoneDark, collide: false });
    if (i === bays) break;
    const wx = x + len / bays / 2;
    for (let f = 1; f < Math.floor(height / 3.2); f++) {
      const lit = (i * 5 + f * 3) % 4 !== 0;
      b.box(wx, f * 3.2 + 0.6, z0 - side * 0.03, 1.6, 1.5, 0.06, { mat: lit ? ((i + f) % 2 ? m.windowWarm : m.windowWarm2) : m.blackGlass, collide: false, shadow: false });
    }
  }
}

/** Flickering flame over a bowl (offering lamps, braziers). */
function flame(b: LevelBuilder, game: Game, x: number, y: number, z: number, size = 1): void {
  const m = game.mats;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * size, 0.14 * size, 0.24 * size, 10), m.gold);
  bowl.position.set(x, y, z);
  b.group.add(bowl);
  b.anims.push((_t, dt) => {
    if (Math.random() < dt * 22 * size) game.fx.add.emit(x + (Math.random() - 0.5) * 0.2 * size, y + 0.15, z + (Math.random() - 0.5) * 0.2 * size, 0, 0.9 + Math.random() * 0.6, 0, 3, 1.3, 0.35, 0.16 * size, 0.45, { endSize: 0.03, drag: 1 });
  });
  b.light(x, y + 0.6, z, 0xff9a40, 2.5 * size, 5);
}

/**
 * The open sea outside the Glass's window: a lit backdrop with light shafts
 * from the surface, kelp, rocks and a school of fish. Grandmother swims
 * between the window and the backdrop so she reads as a silhouette.
 */
function seaView(b: LevelBuilder, game: Game): void {
  const m = game.mats;
  // Backdrop: deep water, brighter toward the surface, slow light shafts.
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 70).rotateY(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime },
      fog: false,
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec3 vW;
        void main(){
          float h = clamp((vW.y + 16.0) / 60.0, 0.0, 1.0);
          vec3 deep = vec3(0.012, 0.05, 0.07);
          vec3 high = vec3(0.07, 0.30, 0.38);
          vec3 col = mix(deep, high, pow(h, 1.4));
          float s = vW.z * 0.09 + vW.y * 0.035;
          float rays = pow(max(0.0, sin(s + uTime * 0.13)), 10.0) * 0.7 + pow(max(0.0, sin(s * 1.7 - uTime * 0.09 + 1.3)), 14.0) * 0.5;
          col += vec3(0.10, 0.32, 0.36) * rays * smoothstep(0.1, 0.9, h);
          float speck = step(0.996, fract(sin(dot(floor(vW.zy * 3.0), vec2(12.9898, 78.233))) * 43758.5453));
          col += vec3(0.25, 0.6, 0.65) * speck * (0.4 + 0.6 * sin(uTime * 0.8 + vW.z));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  back.position.set(88, 18, -25);
  b.group.add(back);
  // Sea floor, rocks and kelp: merged into a few draw calls.
  let seed = 7;
  const r = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stems: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  const rocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 80; i++) {
    const x = 39 + r() * 45;
    const z = -80 + r() * 110;
    const h = 8 + r() * 16;
    stems.push(new THREE.CylinderGeometry(0.12, 0.3, h, 5).translate(x, -14 + h / 2, z));
    if (i % 2 === 0) tips.push(new THREE.SphereGeometry(0.22 + r() * 0.22, 6, 4).translate(x, -14 + h - r() * 3, z));
  }
  for (let i = 0; i < 14; i++) {
    const g = new THREE.DodecahedronGeometry(2 + r() * 5, 0);
    g.scale(1, 0.55 + r() * 0.5, 1);
    rocks.push(g.translate(42 + r() * 40, -14, -80 + r() * 110));
  }
  const floor = new THREE.PlaneGeometry(60, 140).rotateX(-Math.PI / 2).translate(64, -14, -25);
  b.mesh(floor, m.basalt, new THREE.Vector3(), 0, 1, false, false);
  b.mesh(mergeGeometries(rocks)!, m.basalt, new THREE.Vector3(), 0, 1, false, false);
  b.mesh(mergeGeometries(stems)!, kelpMat, new THREE.Vector3(), 0, 1, false, false);
  b.mesh(mergeGeometries(tips)!, m.neonCyanDim, new THREE.Vector3(), 0, 1, false, false);
  // A school of small fish circling in front of the window.
  const n = 48;
  const fish = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.5, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ad8e0 }), n);
  fish.frustumCulled = false;
  b.group.add(fish);
  const offs = Array.from({ length: n }, () => [r() * Math.PI * 2, (r() - 0.5) * 4, (r() - 0.5) * 3, 0.8 + r() * 0.4] as const);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  b.anims.push((t) => {
    if (!fish.parent?.visible) return;
    for (let i = 0; i < n; i++) {
      const [a0, dy, dr, sp] = offs[i];
      const a = a0 * 0.15 + t * 0.22 * sp;
      const rad = 9 + dr + Math.sin(t * 0.3 + a0) * 1.5;
      pos.set(48 + Math.cos(a) * rad * 0.7, 2 + dy + Math.sin(a * 2 + a0) * 0.8, -25 + Math.sin(a) * rad * 1.6);
      // Heading along the circle.
      q.setFromAxisAngle(up, Math.atan2(-Math.sin(a) * 0.7, Math.cos(a) * 1.6));
      mtx.compose(pos, q, one);
      fish.setMatrixAt(i, mtx);
    }
    fish.instanceMatrix.needsUpdate = true;
  });
}

const kelpMat = new THREE.MeshStandardMaterial({ color: 0x1c4a3c, emissive: 0x0a2a24, roughness: 0.9 });

// ---------------------------------------------------------------------------

/**
 * The Glass: through an opening in the dock's east wall, a long gallery
 * with a window onto the open sea. Bas watches from the benches.
 */
export function buildGlass(b: LevelBuilder, game: Game): void {
  const m = game.mats;
  const p = game.props;
  // Corridor x 15..21, z -22.5..-27.5.
  b.box(17.6, -0.6, -25, 7.4, 0.6, 5, { mat: m.basalt });
  b.box(18, 0, -22.25, 6.5, 4.5, 0.5, { mat: m.lapis });
  b.box(18, 0, -27.75, 6.5, 4.5, 0.5, { mat: m.lapis });
  b.box(18, 4.5, -25, 6.5, 0.4, 6, { mat: m.sandstoneDark });
  for (const z of [-22.55, -27.45]) b.box(18, 3.9, z, 6.4, 0.06, 0.06, { mat: m.neonCyan, collide: false, shadow: false });
  b.light(18, 3.4, -25, 0x40d8ff, 3, 7);

  // Gallery x 21..35, z -14..-36.
  b.box(28, -0.6, -25, 14, 0.6, 22, { mat: m.tile });
  b.box(28, 0, -13.75, 14.5, 8, 0.5, { mat: m.relief });
  b.box(28, 0, -36.25, 14.5, 8, 0.5, { mat: m.relief });
  b.box(21.25, 0, -18.25, 0.5, 8, 8.5, { mat: m.relief });
  b.box(21.25, 0, -31.75, 0.5, 8, 8.5, { mat: m.relief });
  b.box(21.25, 4.5, -25, 0.5, 3.5, 5, { mat: m.relief });
  b.box(28, 8, -25, 14.5, 0.4, 22.5, { mat: m.sandstoneDark });
  b.box(28, 7.7, -25, 13.5, 0.08, 0.3, { mat: m.neonCyanDim, collide: false, shadow: false });
  // The window: sill, header, glass, gold mullions.
  b.box(35.25, 0, -25, 0.5, 0.9, 22, { mat: m.sandstoneDark });
  b.box(35.25, 7, -25, 0.5, 1, 22, { mat: m.sandstone });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(21.5, 6.1), m.glass);
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(35.2, 3.95, -25);
  b.group.add(glass);
  for (let z = -14.5; z >= -35.5; z -= 3.5) b.box(35.15, 0.9, z, 0.25, 6.1, 0.18, { mat: m.gold, collide: false });
  b.box(35.15, 3.9, -25, 0.22, 0.12, 21.6, { mat: m.gold, collide: false });
  b.blocker(35.3, 0.9, -25, 0.5, 6.1, 22);
  seaView(b, game);
  // Benches facing the sea.
  for (const z of [-19, -25.5, -32]) {
    b.instance(p.bench, 29.5, 0, z, Math.PI / 2);
    b.box(29.5, 0, z, 0.6, 0.5, 2, { mat: m.trim, visible: false });
  }
  planter(b, m, p, 23, 0, -15.6, 3, 0.9);
  planter(b, m, p, 23, 0, -34.4, 3, 0.9);
  hologram(b, 24.5, 5.4, -25, 'water', '#30e0ff', 2.2);
  // Sea light falling in through the window, a warm lamp by the benches.
  b.light(31, 6.8, -18, 0x3ab8d8, 5, 12);
  b.light(31, 6.8, -32, 0x3ab8d8, 5, 12);
  b.light(33.5, 1.5, -25, 0x2a9ab8, 4, 9);
  b.light(30, 2.2, -25, 0xffc070, 2.5, 7);
  b.light(26, 6.5, -25, 0x6ad8ff, 3, 12);
  b.holoLog('glass', 22.6, 0, -33.8);
  // Sign over the opening on the dock side.
  neonSign(b, SIGNS.glass, 13.9, 5.4, -25, -Math.PI / 2, 4, 0.8, '#30e0ff', {});
}

/**
 * Souk Hathor: a night market behind the strip's east facades, x 14..44,
 * z -80..-106. Its shutters go up once the first fight on the strip is over.
 */
export function buildSouk(b: LevelBuilder, game: Game): void {
  const m = game.mats;
  const p = game.props;
  // Archway in the facade (the strip build leaves the gap at z -89..-95).
  b.box(13.5, 5.2, -92, 1, 9.8, 6, { mat: m.plasterOchre });
  for (const z of [-89.1, -94.9]) b.box(13.0, 0, z, 0.35, 5.2, 0.35, { mat: m.gold, collide: false });
  b.box(13.0, 5.0, -92, 0.35, 0.3, 6.2, { mat: m.gold, collide: false });
  b.door('soukShutter', 13.5, 0, -92, 6, 5.2, 0.3, Math.PI / 2);
  neonSign(b, SIGNS.souk, 12.4, 6.1, -92, -Math.PI / 2, 5.5, 1.1, '#ffc04a', { groundY: 0.15, glyphs: true, border: true });

  // Floor and walls.
  b.box(29, -0.6, -93, 30, 0.6, 26, { mat: m.tile });
  wallX(b, m, -80, 14, 44, 12, 1, 'teal');
  wallX(b, m, -106, 14, 44, 13, -1, 'ochre');
  b.box(44.5, 0, -93, 1, 14, 27, { mat: m.plasterTeal });
  for (let z = -84; z >= -102; z -= 6) {
    b.box(43.95, 3.8, z, 0.06, 1.5, 1.6, { mat: (z / 6) % 2 ? m.windowWarm : m.windowWarm2, collide: false, shadow: false });
    b.box(43.95, 7.0, z, 0.06, 1.5, 1.6, { mat: m.windowWarm2, collide: false, shadow: false });
  }

  // Fountain in the middle.
  const basin = new THREE.CylinderGeometry(2.3, 2.5, 0.8, 24);
  b.mesh(basin.translate(0, 0.4, 0), m.sandstoneDark, new THREE.Vector3(29, 0, -93), 0, 1, 'cylinder');
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.09, 6, 32).rotateX(Math.PI / 2), m.gold);
  rim.position.set(29, 0.82, -93);
  b.group.add(rim);
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.15, 24).rotateX(-Math.PI / 2), m.water);
  water.position.set(29, 0.72, -93);
  b.group.add(water);
  b.instance(p.lotusColumn, 29, 0.7, -93, 0, 0.45);
  hologram(b, 29, 5.8, -93, 'scarab', '#ffc04a', 2.4);
  b.light(29, 1.4, -93, 0x40d8ff, 3, 6);

  // Stalls around the edges, facing in.
  stall(b, m, 19.5, -82.6, Math.PI, 'awningRed', 'neonGold');
  stall(b, m, 26, -82.6, Math.PI, 'awningTeal', 'neonPink');
  stall(b, m, 19.5, -103.4, 0, 'awningTeal', 'neonCyan');
  stall(b, m, 26.5, -103.4, 0, 'awningRed', 'neonGold');
  stall(b, m, 41.6, -93, -Math.PI / 2, 'awningRed', 'neonViolet');
  // Lantern signs over the general stalls.
  SIGNS.lanterns.slice(0, 4).forEach((t, i) => {
    const [x, z, rot] = [[19.5, -84.6, Math.PI], [26, -84.6, Math.PI], [19.5, -101.4, 0], [26.5, -101.4, 0]][i] as [number, number, number];
    neonSign(b, t, x, 3.1, z, rot, 2.2, 0.45, i % 2 ? '#ff3fa8' : '#30e0ff', {});
  });

  // Auntie Nef's noodle counter (north-east).
  b.box(38, 0, -82.8, 5, 1.1, 1.3, { mat: m.wood, cover: 'low' });
  b.box(38, 1.1, -82.8, 5.1, 0.06, 1.4, { mat: m.gold, collide: false });
  for (const x of [36.5, 39.5]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.4, 14), m.darkMetal);
    pot.position.set(x, 1.33, -82.9);
    b.group.add(pot);
  }
  b.anims.push((_t, dt) => {
    // Steam off the pots.
    if (Math.random() < dt * 6) game.fx.add.emit(36.5 + (Math.random() < 0.5 ? 0 : 3) + (Math.random() - 0.5) * 0.3, 1.6, -82.9, 0, 0.5 + Math.random() * 0.3, 0, 0.9, 0.9, 0.9, 0.2, 2.2, { endSize: 0.5, drag: 0.6 });
  });
  for (const x of [35.8, 37.4, 39, 40.6]) b.instance(p.stool, x, 0, -84.4, x);
  b.box(38, 0, -80.6, 5, 2.6, 0.5, { mat: m.wood, collide: false });
  neonSign(b, SIGNS.nef, 38, 3.6, -81.0, Math.PI, 3, 0.8, '#ff7a30', {});
  b.light(38, 2.6, -83.5, 0xffa050, 4, 7);

  // Kwame's tinker bench (south-east).
  b.box(37, 0, -103.4, 5, 1.0, 1.2, { mat: m.metal, cover: 'low', surface: 'metal' });
  b.box(37, 1.0, -103.4, 5.1, 0.05, 1.3, { mat: m.darkMetal, collide: false });
  for (let i = 0; i < 6; i++) b.box(35.2 + i * 0.7, 1.05, -103.2 + (i % 2) * 0.25, 0.25, 0.08, 0.18, { mat: i % 2 ? m.neonGreen : m.neonCyan, collide: false, shadow: false });
  // Pegboard of tools and parts behind the bench.
  b.box(37, 0, -105.4, 5, 3, 0.4, { mat: m.darkMetal, collide: false });
  for (let i = 0; i < 14; i++) {
    const tx = 35 + (i % 7) * 0.66;
    const ty = 1.5 + Math.floor(i / 7) * 0.7;
    b.box(tx, ty, -105.15, 0.1 + (i % 3) * 0.08, 0.35 + (i % 2) * 0.2, 0.06, { mat: i % 4 === 0 ? m.gold : m.metal, collide: false, shadow: false });
  }
  b.box(37, 2.9, -105.15, 4.6, 0.04, 0.06, { mat: m.neonGreen, collide: false, shadow: false });
  neonSign(b, SIGNS.tinker, 37, 3.6, -105.0, 0, 3, 0.8, '#40ff9a', { glyphs: true });
  b.light(37, 2.6, -102.4, 0xffe6c0, 3, 7);
  b.light(37, 3.2, -104.8, 0x60ffb0, 1.5, 4);

  // Strings of lanterns across the square and cloth canopies.
  for (let i = 0; i < 4; i++) {
    const x = 17 + i * 8;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 9, -80.5), new THREE.Vector3(x + 1, 7.4, -93), new THREE.Vector3(x, 9, -105.5)]);
    b.mesh(new THREE.TubeGeometry(curve, 18, 0.03, 4, false), i % 2 ? m.neonGold : m.neonPink, new THREE.Vector3(), 0, 1, false, false);
    const bulbs: THREE.BufferGeometry[] = [];
    for (let k = 1; k < 9; k++) {
      const pt = curve.getPoint(k / 9);
      bulbs.push(new THREE.SphereGeometry(0.14, 6, 4).translate(pt.x, pt.y - 0.2, pt.z));
    }
    b.mesh(mergeGeometries(bulbs)!, i % 2 ? m.neonGold : m.neonViolet, new THREE.Vector3(), 0, 1, false, false);
  }
  for (const [x, z, w, d, mat] of [[22, -88, 7, 4, m.awningRed], [36, -97, 6, 5, m.awningTeal], [22, -99, 6, 3.5, m.awningTeal]] as const) {
    b.box(x, 8.2, z, w, 0.05, d, { mat, collide: false, shadow: false });
  }
  b.light(22, 6, -93, 0xffb060, 5, 14);
  b.light(30, 8, -93, 0xffc080, 5, 22);
  b.light(36, 6, -93, 0xff70a0, 4, 14);
  for (const [x, z] of [[15.5, -81.5], [15.5, -104.5], [42.5, -81.5], [42.5, -104.5]] as const) b.instance(p.barrel, x, 0, z, x);
  b.pickup('health', 42.6, 0, -86.5);
  b.holoLog('souk', 33.3, 0, -102.6);
}

/**
 * The Shrine of Hathor: a bridge off the west side of the middle terrace to
 * a rooftop garden with a small temple, and Mari's room up three steps.
 */
export function buildShrine(b: LevelBuilder, game: Game, y: number): void {
  const m = game.mats;
  const p = game.props;
  // Bridge x -16.4..-24, z -251..-255.
  b.box(-20, y - 0.4, -253, 8.2, 0.4, 4, { mat: m.sandstoneDark });
  for (const z of [-250.85, -255.15]) {
    b.box(-20.2, y, z, 7.8, 1.0, 0.3, { mat: m.sandstone });
    b.box(-20.2, y + 1.0, z, 7.9, 0.06, 0.36, { mat: m.gold, collide: false });
    b.blocker(-20.2, y, z, 7.8, 10, 0.3);
  }
  b.instance(p.lamp, -17.2, y + 1.0, -250.85, 0, 0.5);
  b.instance(p.lamp, -17.2, y + 1.0, -255.15, 0, 0.5);
  b.light(-20, y + 2.5, -253, 0xffc06a, 3, 7);

  // Rooftop: the building under the garden, x -24..-44, z -240..-266.
  b.box(-34, y - 16, -253, 20, 16, 26, { mat: m.sandstone });
  b.box(-34, y - 0.06, -253, 19.4, 0.07, 25.4, { mat: m.tile, collide: false });
  // Parapets with a gap for the bridge; tall invisible walls so nobody falls off.
  b.box(-34, y, -240.25, 20, 1.0, 0.5, { mat: m.sandstone });
  b.box(-34, y, -265.75, 20, 1.0, 0.5, { mat: m.sandstone });
  b.box(-43.75, y, -253, 0.5, 1.0, 26, { mat: m.sandstone });
  b.box(-24.25, y, -245.5, 0.5, 1.0, 11, { mat: m.sandstone });
  b.box(-24.25, y, -260.5, 0.5, 1.0, 11, { mat: m.sandstone });
  b.blocker(-34, y, -240.25, 20, 10, 0.5);
  b.blocker(-34, y, -265.75, 20, 10, 0.5);
  b.blocker(-43.75, y, -253, 0.5, 10, 26);
  b.blocker(-24.25, y, -245.5, 0.5, 10, 11);
  b.blocker(-24.25, y, -260.5, 0.5, 10, 11);
  for (const [x, z, w, d] of [[-34, -240.25, 20.1, 0.56], [-34, -265.75, 20.1, 0.56], [-43.75, -253, 0.56, 26], [-24.25, -245.5, 0.56, 11], [-24.25, -260.5, 0.56, 11]] as const) {
    b.box(x, y + 1.0, z, w, 0.06, d, { mat: m.gold, collide: false });
  }

  // The temple at the west end: dais, two columns, altar with Hathor's sun
  // disk between cow horns, offering lamps.
  b.box(-41, y, -253, 4.6, 0.5, 10, { mat: m.basalt });
  b.box(-38.4, y, -253, 1.0, 0.25, 6, { mat: m.basalt });
  for (const z of [-249, -257]) {
    b.instance(p.papyrusColumn, -41, y + 0.5, z, 0, 0.75);
    game.physics.addFixedCylinder(-41, y + 0.5 + 2.6, z, 2.6, 0.46);
  }
  b.box(-42, y + 0.5, -253, 1.2, 1.1, 2.6, { mat: m.basalt });
  b.box(-42, y + 1.6, -253, 1.3, 0.06, 2.7, { mat: m.gold, collide: false });
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 28).rotateZ(Math.PI / 2), m.gold);
  disk.position.set(-42.3, y + 3.1, -253);
  b.group.add(disk);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.025, 6, 32).rotateY(Math.PI / 2), m.neonGold);
  halo.position.set(-42.25, y + 3.1, -253);
  b.group.add(halo);
  const horns = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 24, Math.PI).rotateY(Math.PI / 2), m.gold);
  horns.position.set(-42.3, y + 2.9, -253);
  b.group.add(horns);
  b.box(-42.3, y + 1.6, -253, 0.12, 0.8, 0.12, { mat: m.gold, collide: false });
  hologram(b, -41, y + 6, -253, 'sun', '#ffc04a', 2.6);
  for (const z of [-250.5, -255.5]) flame(b, game, -41.6, y + 1.7, z, 0.8);
  flame(b, game, -38.2, y + 0.3, -249, 1);
  flame(b, game, -38.2, y + 0.3, -257, 1);
  b.light(-37.5, y + 3.2, -253, 0xffb060, 3, 9);
  b.light(-30, y + 6, -250, 0xffc890, 4, 18);

  // Garden: palms, planters, a lotus pool, lamps.
  for (const [x, z] of [[-27, -242.5], [-27, -263.5], [-37, -242.5]] as const) {
    b.instance(p.palm, x, y, z, x, 0.85);
    game.physics.addFixedCylinder(x, y + 2.2, z, 2.2, 0.25);
  }
  planter(b, m, p, -31, y, -242.2, 4, 1.1);
  b.box(-31.5, y, -250.5, 4.6, 0.5, 0.3, { mat: m.sandstone });
  b.box(-31.5, y, -246.9, 4.6, 0.5, 0.3, { mat: m.sandstone });
  b.box(-33.65, y, -248.7, 0.3, 0.5, 3.3, { mat: m.sandstone });
  b.box(-29.35, y, -248.7, 0.3, 0.5, 3.3, { mat: m.sandstone });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.3).rotateX(-Math.PI / 2), m.water);
  pool.position.set(-31.5, y + 0.35, -248.7);
  b.group.add(pool);
  b.blocker(-31.5, y, -248.7, 4, 0.4, 3.3);
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.09, 0.08, 8), m.neonPink);
    l.position.set(-33 + i * 1.4, y + 0.4, -248.2 - (i % 2) * 0.8);
    b.group.add(l);
  }
  b.light(-31.5, y + 1, -248.7, 0xff6ab8, 3, 6);
  for (const [x, z] of [[-26, -252], [-37, -262]] as const) {
    b.instance(p.lamp, x, y, z, 0, 0.7);
    b.light(x, y + 2.8, z, 0xffc06a, 3, 7);
  }

  // Mari's room: x -26.5..-35.5, z -258..-265, floor 0.6 up, door facing the garden.
  const fy = y + 0.6;
  b.box(-31, y, -261.5, 9, 0.6, 7, { mat: m.sandstoneDark });
  b.stairs(-31, -256.4, -258, y, fy, 1.8, m.sandstoneDark, 3);
  b.box(-34.1, fy, -258.15, 2.8, 3.2, 0.3, { mat: m.plasterOchre });
  b.box(-27.9, fy, -258.15, 2.8, 3.2, 0.3, { mat: m.plasterOchre });
  b.box(-31, fy + 2.4, -258.15, 3.4, 0.8, 0.3, { mat: m.plasterOchre });
  b.box(-31, fy, -264.85, 9, 3.2, 0.3, { mat: m.plasterOchre });
  b.box(-35.35, fy, -261.5, 0.3, 3.2, 7, { mat: m.plasterOchre });
  b.box(-26.65, fy, -261.5, 0.3, 3.2, 7, { mat: m.plasterOchre });
  b.box(-31, fy + 3.2, -261.5, 9.3, 0.25, 7.3, { mat: m.sandstoneDark });
  b.box(-31, fy + 2.3, -257.98, 1.2, 0.05, 0.06, { mat: m.neonGold, collide: false, shadow: false });
  // Bed, desk, shelf, a photo, a lamp left on.
  b.box(-33.6, fy, -263.4, 2.2, 0.45, 1.5, { mat: m.wood });
  b.box(-33.6, fy + 0.45, -263.4, 2.1, 0.15, 1.4, { mat: m.awningTeal, collide: false });
  b.box(-28.4, fy, -263.9, 2.2, 0.8, 0.8, { mat: m.wood });
  b.box(-28.4, fy + 0.8, -263.9, 2.3, 0.05, 0.9, { mat: m.gold, collide: false });
  b.box(-26.9, fy + 1.2, -261.5, 0.3, 0.05, 3, { mat: m.wood, collide: false });
  b.box(-26.95, fy + 1.27, -261.0, 0.2, 0.25, 0.18, { mat: m.lapis, collide: false });
  b.box(-26.95, fy + 1.27, -262.2, 0.2, 0.3, 0.14, { mat: m.neonGold, collide: false, shadow: false });
  b.box(-31, fy + 1.4, -264.65, 1.1, 0.8, 0.05, { mat: m.windowWarm, collide: false, shadow: false });
  b.box(-31, fy + 1.35, -264.7, 1.25, 0.95, 0.04, { mat: m.gold, collide: false });
  b.light(-30, fy + 1.6, -262.5, 0xffb070, 1.2, 6);
  b.holoLog('room', -28.4, fy + 0.85, -263.7);
  neonSign(b, SIGNS.shrine, -24.6, y + 3.4, -253, Math.PI / 2, 3.2, 0.8, '#ffc04a', { glyphs: true });
}
