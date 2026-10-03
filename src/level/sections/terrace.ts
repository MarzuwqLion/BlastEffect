import * as THREE from 'three';
import { NAMES, OBJECTIVES, SIGNS } from '../../strings';
import { crateCover, hologram, neonSign, obelisk, planter, pylon } from '../kit';
import type { LevelBuilder } from '../LevelBuilder';
import type { SectionDef } from './types';
import { buildShrine } from './zones';

const T1 = 4.2;
const T2 = 6.6;
const T3 = 9.0;

/** Lotus pool: low wall (cover) around glowing water. */
function pool(b: LevelBuilder, x: number, y: number, z: number, w: number, d: number): void {
  const m = b.game.mats;
  b.box(x, y, z - d / 2, w, 0.95, 0.4, { mat: m.sandstone, cover: 'low' });
  b.box(x, y, z + d / 2, w, 0.95, 0.4, { mat: m.sandstone, cover: 'low' });
  b.box(x - w / 2, y, z, 0.4, 0.95, d - 0.4, { mat: m.sandstone, cover: 'low' });
  b.box(x + w / 2, y, z, 0.4, 0.95, d - 0.4, { mat: m.sandstone, cover: 'low' });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4).rotateX(-Math.PI / 2), m.water);
  water.position.set(x, y + 0.6, z);
  b.group.add(water);
  b.blocker(x, y, z, w - 0.4, 0.6, d - 0.4);
  // Floating lotus lights.
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.1, 0.1, 8), m.neonPink);
    l.position.set(x + (Math.random() - 0.5) * (w - 1.5), y + 0.65, z + (Math.random() - 0.5) * (d - 1.5));
    b.group.add(l);
  }
  b.light(x, y + 1.2, z, 0xff6ab8, 4, 7);
}

/**
 * Section 4: the terraces. Stepped garden terraces climbing to the Basin.
 * Long sightlines reward the rifle; enemies hold the upper tiers.
 */
export const terrace: SectionDef = {
  index: 4,
  name: 'The Terraces',
  checkpoint: { x: 0, y: T1, z: -203.5, yaw: 0 },
  enter: [-16, T1 - 1, -201.5, 16, 20, -281],
  nav: { minX: -45, maxX: 16, minZ: -283, maxZ: -200, minY: 3, maxY: 14 },
  music: 'heist',
  dome: 0.75,
  ambient: [0x3a8aa0, 0x2a1c10, 0.9],
  objective: OBJECTIVES.terrace,
  npcs: [{ id: 'merit', x: -40, y: T2 + 0.5, z: -253, yaw: -Math.PI / 2, dialogue: 'priestess' }],
  zones: [
    {
      id: 'shrine',
      name: NAMES.shrine,
      box: [-16.6, T2 - 1, -239, -45, T2 + 9, -267],
      music: 'shrine',
      dome: 0.9,
      nudge: { box: [-16, T2 - 1, -244, -6, T2 + 4, -258], text: OBJECTIVES.optShrine },
    },
  ],
  crowds: [
    // Kneeling at Hathor's altar; two more talking by the lotus pool.
    { area: [-36.6, -251.2, -35.4, -254.8], y: T2, count: 3, seed: 51, mood: 'kneel', face: -Math.PI / 2 },
    { area: [-28, -244, -26, -246], y: T2, count: 2, seed: 53, mood: 'chat' },
  ],
  markers: { top: [0, T3 + 1.5, -262], gate: [0, T3 + 2, -282] },
  encounters: [
    {
      id: 'terrace',
      trigger: [-16, T1 - 1, -205, 16, T1 + 4, -212],
      waves: [
        {
          spawns: [
            { kind: 'grunt', x: -6, y: T2, z: -236 },
            { kind: 'grunt', x: 7, y: T2, z: -238, delay: 0.3 },
            { kind: 'grunt', x: 0, y: T3, z: -266, delay: 0.5 },
            { kind: 'trooper', x: 12, y: T1, z: -224, delay: 0.8 },
          ],
        },
        {
          whenAliveAtMost: 1,
          delay: 1.5,
          spawns: [
            { kind: 'heavy', x: 0, y: T3, z: -274 },
            { kind: 'grunt', x: -9, y: T3, z: -268, delay: 0.4 },
            { kind: 'grunt', x: 9, y: T3, z: -268, delay: 0.8 },
          ],
          // Nef's tip: hit them during the shift change and one is still on his way.
          fewerWith: { flag: 'intel_shifts', drop: 1 },
        },
      ],
      onStart: (d) => d.hint('rifleRange'),
      onClear: (d) => {
        d.openDoor('basinGate');
        d.setObjective(OBJECTIVES.terraceGate, 'gate');
      },
    },
  ],
  onEnter: (d) => d.setObjective(OBJECTIVES.terrace, 'top'),
  build(b, game) {
    const m = game.mats;
    const p = game.props;
    // Exit corridor from the club.
    b.box(0, T1 - 0.6, -201.5, 6, 0.6, 3, { mat: m.sandstone });
    // Tier floors.
    b.box(0, T1 - 1.2, -216.5, 32, 1.2, 31, { mat: m.sandstone });
    b.box(0, T1 - 1.2, -245.5, 32, T2 - T1 + 1.2, 27, { mat: m.sandstone });
    b.box(0, T1 - 1.2, -271, 32, T3 - T1 + 1.2, 24, { mat: m.sandstone });
    // Paving inlays (visual only).
    for (const [y, z0, z1] of [[T1, -203, -226], [T2, -233, -253], [T3, -259, -281]] as const) {
      b.box(0, y, (z0 + z1) / 2, 4, 0.02, Math.abs(z1 - z0), { mat: m.lapis, collide: false, shadow: false });
      b.box(-2.1, y, (z0 + z1) / 2, 0.12, 0.03, Math.abs(z1 - z0), { mat: m.gold, collide: false, shadow: false });
      b.box(2.1, y, (z0 + z1) / 2, 0.12, 0.03, Math.abs(z1 - z0), { mat: m.gold, collide: false, shadow: false });
    }
    // Stairs between tiers: central and two side flights.
    for (const x of [0, -12.5, 12.5]) {
      b.stairs(x, -226.5, -232, T1, T2, x === 0 ? 5 : 3, m.sandstoneDark, 8);
      b.stairs(x, -253.5, -259, T2, T3, x === 0 ? 5 : 3, m.sandstoneDark, 8);
    }
    // Parapets on the tier edges (cover when shooting down), with gaps at stairs.
    for (const [y, z] of [[T2, -232.6], [T3, -259.6]] as const) {
      for (const [x0, x1] of [[-15.6, -14.2], [-10.8, -2.7], [2.7, 10.8], [14.2, 15.6]]) {
        const w = x1 - x0;
        b.box((x0 + x1) / 2, y, z, w, 1.0, 0.5, { mat: m.sandstone, cover: 'low' });
        b.box((x0 + x1) / 2, y + 1.0, z, w + 0.1, 0.08, 0.6, { mat: m.gold, collide: false });
      }
    }
    // Side balustrades and the drop beyond. The west one opens at z -251..-255
    // onto the bridge to the Shrine of Hathor.
    for (const x of [-16.2, 16.2]) {
      b.box(x, T1, -216.5, 0.5, 1.1, 31, { mat: m.sandstone });
      if (x < 0) {
        b.box(x, T2, -241.5, 0.5, 1.1, 19, { mat: m.sandstone });
        b.box(x, T2, -257, 0.5, 1.1, 4, { mat: m.sandstone });
        b.blocker(x, T1, -225.5, 0.6, 12, 51);
        b.blocker(x, T1, -268.5, 0.6, 12, 27);
        b.blocker(x, T1, -253, 0.6, T2 - T1, 4);
      } else {
        b.box(x, T2, -245.5, 0.5, 1.1, 27, { mat: m.sandstone });
        b.blocker(x, T1, -241, 0.6, 12, 82);
      }
      b.box(x, T3, -271, 0.5, 1.1, 24, { mat: m.sandstone });
    }
    buildShrine(b, game, T2);
    // Gardens: palms, planters, pools, obelisks, columns.
    for (const [x, y, z] of [[-13.5, T1, -208], [13.5, T1, -208], [-13.5, T1, -220], [13.5, T1, -220], [-14, T2, -240], [14, T2, -240], [-14, T3, -264], [14, T3, -276]] as const) {
      b.instance(p.palm, x, y, z, x * 0.3, 1);
      game.physics.addFixedCylinder(x, y + 2.5, z, 2.5, 0.25);
    }
    planter(b, m, p, -6, T1, -210, 3.5, 1.2);
    planter(b, m, p, 6.5, T1, -214, 3.5, 1.2);
    pool(b, 0, T1, -219, 7, 4);
    crateCover(b, p, -9, T1, -222, 0.4);
    crateCover(b, p, 9.5, T1, -205.5, -0.2, 2);
    obelisk(b, m, -9, T2, -246, 6, 1.1);
    obelisk(b, m, 9, T2, -246, 6, 1.1);
    pool(b, 0, T2, -244, 6, 5);
    planter(b, m, p, -5, T2, -238, 3, 1.2);
    planter(b, m, p, 5, T2, -250, 3, 1.2);
    crateCover(b, p, 12, T2, -237, 0.2);
    for (const [x, z] of [[-6, -265], [6, -265], [-6, -275], [6, -275]]) {
      b.instance(p.papyrusColumn, x, T3, z, 0, 0.75);
      game.physics.addFixedCylinder(x, T3 + 2.6, z, 2.6, 0.46);
      game.cover.add(x, z, 0.45, 0.45, 0, T3, T3 + 5, 4, 'high');
    }
    planter(b, m, p, 0, T3, -270, 3, 1.2);
    crateCover(b, p, -11, T3, -271, 0.3, 2);
    crateCover(b, p, 11, T3, -262, -0.3);
    for (let z = -206; z > -280; z -= 9) {
      const y = z > -229 ? T1 : z > -256 ? T2 : T3;
      for (const x of [-15.5, 15.5]) {
        if (x < 0 && z === -251) continue;
        b.instance(p.lamp, x, y + 1.1, z, 0, 0.6);
        b.light(x, y + 3.6, z, 0xffc06a, 4, 8);
      }
    }
    hologram(b, 0, T3 + 6, -262, 'ankh', '#ffc04a', 3.4);
    hologram(b, -11, T2 + 4, -250, 'feather', '#30e0ff', 2);
    b.pickup('ammo', -12, T1, -204.5);
    b.pickup('ammo', 12, T2, -250.5);
    b.pickup('health', -12, T2, -251);
    b.pickup('ammo', 13.5, T3, -279);
    b.holoLog('gate', -13.6, T3, -277.2);
    b.kaCell(-7.4, T2, -236.6);
    b.kaCell(7.4, T2, -251.2);
    b.kaCell(-9.0, T3, -272.6);
    b.kaCell(-8.2, T3, -273.5);
    b.kaCell(12.8, T3, -263.4);

    // City backdrop: silhouettes of towers and pyramids beyond the balustrades.
    const back = new THREE.Group();
    const towerMat = m.blackGlass;
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      let x = side * (40 + Math.random() * 80);
      const z = -150 - Math.random() * 220;
      // Keep clear of the Shrine's rooftop.
      if (side < 0 && x > -64 && z < -226 && z > -280) x -= 30;
      const h = 15 + Math.random() * 50;
      const w = 6 + Math.random() * 12;
      const tower = new THREE.Mesh(i % 5 === 0 ? new THREE.ConeGeometry(w, h, 4) : new THREE.BoxGeometry(w, h, w), towerMat);
      tower.position.set(x, h / 2 - 8, z);
      back.add(tower);
      if (i % 3 === 0) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.3, w * 1.02), i % 2 ? m.neonCyan : m.neonGold);
        strip.position.set(x, h * 0.6 - 8, z);
        back.add(strip);
      }
    }
    back.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    b.group.add(back);

    // Gate into the Basin.
    pylon(b, m, -10, T3, -282, 9, 14, 4);
    pylon(b, m, 10, T3, -282, 9, 14, 4);
    b.box(0, T3 + 10, -282, 11, 2, 3.5, { mat: m.relief });
    neonSign(b, SIGNS.basin, 0, T3 + 11, -280.1, 0, 7, 1.3, '#40ff9a', { glyphs: true });
    b.door('basinGate', 0, T3, -282, 11, 10, 0.6);
    b.light(0, T3 + 6, -278, 0x40ff9a, 8, 12);
    void NAMES;
  },
};
