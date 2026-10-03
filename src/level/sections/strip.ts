import * as THREE from 'three';
import { NAMES, OBJECTIVES, SIGNS } from '../../strings';
import { crateCover, facade, hologram, neonSign, obelisk, planter, pylon, stall } from '../kit';
import type { SectionDef } from './types';
import { buildSouk } from './zones';

/**
 * Section 2: the strip. Street fights between clubs and stalls. Encounter A
 * teaches cover and the first combo on grunts; encounter B adds a shield
 * trooper and teaches weapon swapping.
 */
export const strip: SectionDef = {
  index: 2,
  name: 'The Strip',
  checkpoint: { x: 1, y: 0, z: -45, yaw: 0 },
  enter: [-13, -1, -42, 44, 12, -150],
  nav: { minX: -13, maxX: 45, minZ: -152, maxZ: -40, minY: -1, maxY: 6 },
  music: 'explore',
  dome: 0.5,
  ambient: [0x3a7a9a, 0x24121c, 0.8],
  objective: OBJECTIVES.strip1,
  npcs: [
    { id: 'nef', x: 38, y: 0, z: -81.5, yaw: 0, dialogue: 'cook' },
    { id: 'kwame', x: 37, y: 0, z: -104.6, yaw: -Math.PI, dialogue: 'tinker' },
  ],
  zones: [{ id: 'souk', name: NAMES.souk, box: [14, -1, -80, 44, 10, -106], music: 'market', dome: 0.4 }],
  soundscape: [{ loop: 'crowdMarket', at: [29, 1, -93], inner: 8, radius: 22, level: 0.75, quietInCombat: true }],
  crowds: [
    // Out on the street when Ka arrives; they bolt for the station at the first shot.
    { area: [-8, -43, 8, -49], y: 0, count: 5, seed: 11, flee: [1, 0, -34] },
    { area: [-9.6, -60, -8.6, -64], y: 0.15, count: 2, seed: 13, mood: 'chat', flee: [-2, 0, -34] },
    // The market: they duck behind the stalls when the street fights start.
    { area: [17, -86, 41, -100], y: 0, count: 8, seed: 21 },
    { area: [16, -85.2, 23, -86.4], y: 0, count: 3, seed: 23, mood: 'chat' },
    { area: [35.5, -84.4, 40.5, -84.4], spots: [[37.4, -84.4], [40.6, -84.4]], y: 0.32, count: 2, seed: 29, mood: 'sit', face: 0 },
  ],
  markers: { a: [0, 1.5, -80], b: [0, 1.5, -125], door: [0, 2, -150] },
  encounters: [
    {
      id: 'stripA',
      trigger: [-13, -1, -50, 13, 6, -58],
      waves: [
        {
          spawns: [
            { kind: 'grunt', x: -4, y: 0, z: -86 },
            { kind: 'grunt', x: 3.5, y: 0, z: -91 },
            { kind: 'grunt', x: 6.5, y: 0, z: -80, delay: 0.4 },
          ],
        },
        {
          whenAliveAtMost: 1,
          delay: 1,
          spawns: [
            { kind: 'grunt', x: -6, y: 0, z: -96 },
            { kind: 'grunt', x: 5, y: 0, z: -97, delay: 0.5 },
          ],
        },
      ],
      onStart: (d) => d.hint('cover', 'fire'),
      onClear: (d) => {
        d.setObjective(OBJECTIVES.strip2, 'b');
        d.openDoor('soukShutter');
        d.note(OBJECTIVES.optSouk);
      },
    },
    {
      id: 'stripB',
      trigger: [-13, -1, -100, 13, 6, -106],
      waves: [
        {
          spawns: [
            { kind: 'trooper', x: 0, y: 0, z: -137 },
            { kind: 'grunt', x: -6, y: 0, z: -133 },
            { kind: 'grunt', x: 6.5, y: 0, z: -131, delay: 0.3 },
          ],
        },
        {
          whenAliveAtMost: 1,
          delay: 1.2,
          spawns: [
            { kind: 'grunt', x: -3, y: 0, z: -144 },
            { kind: 'trooper', x: 3, y: 0, z: -145, delay: 0.6 },
          ],
        },
      ],
      onStart: (d) => d.hint('swap', 'comboShield'),
      onClear: (d) => {
        d.openDoor('clubDoor');
        d.setObjective(OBJECTIVES.stripDoor, 'door');
      },
    },
  ],
  onEnter: (d) => d.setObjective(OBJECTIVES.strip1, 'a'),
  build(b, game) {
    const m = game.mats;
    const p = game.props;
    // Street and sidewalks.
    b.box(0, -0.6, -96, 26, 0.6, 112, { mat: m.street });
    b.box(-11, 0, -96, 4, 0.15, 108, { mat: m.sandstoneDark });
    b.box(11, 0, -96, 4, 0.15, 108, { mat: m.sandstoneDark });
    b.box(-9.05, 0.15, -96, 0.1, 0.02, 108, { mat: m.gold, collide: false, shadow: false });
    b.box(9.05, 0.15, -96, 0.1, 0.02, 108, { mat: m.gold, collide: false, shadow: false });

    // Building fronts. West side is x = -13, east x = 13.
    const blocks: [number, number, 'teal' | 'ochre' | 'stone'][] = [
      [-42, -62, 'stone'], [-62, -84, 'teal'], [-84, -104, 'ochre'], [-104, -126, 'stone'], [-126, -150, 'teal'],
    ];
    blocks.forEach(([z0, z1, style], i) => {
      facade(b, m, -13, z0, z1, 12 + (i % 2) * 3, -1, style);
      const h = 13 + ((i + 1) % 2) * 2;
      const east = i % 2 ? 'stone' : 'ochre';
      if (z0 === -84) {
        // The archway into Souk Hathor at z -89..-95.
        facade(b, m, 13, z0, -89, h, 1, east);
        facade(b, m, 13, -95, z1, h, 1, east);
      } else {
        facade(b, m, 13, z0, z1, h, 1, east);
      }
    });
    buildSouk(b, game);

    // Signs: clubs and stalls.
    neonSign(b, SIGNS.lotus, -12.4, 5.2, -70, Math.PI / 2, 6, 1.2, '#30a0ff', { groundY: 0.15, glyphs: true });
    neonSign(b, SIGNS.hathors, 12.4, 6.2, -78, -Math.PI / 2, 7, 1.3, '#ff3fa8', { groundY: 0.15, border: true });
    neonSign(b, SIGNS.noodles, -12.4, 3.4, -94, Math.PI / 2, 4.5, 0.9, '#ffc04a', { groundY: 0.15 });
    neonSign(b, SIGNS.repairs, 12.4, 3.6, -114, -Math.PI / 2, 5, 0.8, '#40ff9a', { groundY: 0.15 });
    neonSign(b, SIGNS.menat, -12.4, 6, -118, Math.PI / 2, 4, 1.1, '#a060ff', { groundY: 0.15, border: true });
    // Vertical blade signs.
    neonSign(b, 'BAR', 11.2, 4.5, -58, -Math.PI / 2, 1.2, 3, '#ff5040', { groundY: 0.15 });
    neonSign(b, 'KA', -11.2, 5, -134, Math.PI / 2, 1.2, 2.2, '#30e0ff', { groundY: 0.15 });

    // Overhead neon lines strung across the street.
    for (let z = -50; z > -146; z -= 12) {
      const sag = new THREE.CatmullRomCurve3([new THREE.Vector3(-12.5, 8.4, z), new THREE.Vector3(0, 7.2, z - 2), new THREE.Vector3(12.5, 8.4, z - 4)]);
      const tube = new THREE.TubeGeometry(sag, 20, 0.035, 5, false);
      b.mesh(tube, (z / 12) % 2 ? m.neonPink : m.neonCyan, new THREE.Vector3(0, 0, 0), 0, 1, false, false);
    }

    // Lamps along the sidewalks.
    for (let z = -48; z > -148; z -= 11) {
      for (const x of [-9.6, 9.6]) {
        b.instance(p.lamp, x, 0.15, z, 0, 1);
        b.light(x, 4, z, 0xffc06a, 5, 9);
      }
    }

    // Encounter A: stalls, planters, crates.
    stall(b, m, -5.2, -63, 0.08, 'awningTeal', 'neonCyan');
    stall(b, m, 4.8, -67, -0.12, 'awningRed', 'neonPink');
    planter(b, m, p, 0, 0, -57.5, 4.5, 1.2);
    planter(b, m, p, -7.4, 0.15, -74, 1.3, 4, 0);
    planter(b, m, p, 7.6, 0.15, -75, 1.3, 4, 0);
    crateCover(b, p, 1.8, 0, -73);
    crateCover(b, p, -1.0, 0, -88.5, 0.3, 2);
    stall(b, m, -3.5, -80, 0, 'awningRed', 'neonGold');
    stall(b, m, 4.6, -85, Math.PI, 'awningTeal', 'neonCyan');
    crateCover(b, p, 8.2, 0.15, -91, 0.6);
    b.pickup('ammo', -10.4, 0.15, -66);
    // Ka cells stacked by the crew's positions.
    b.kaCell(-1.6, 0, -82.4);
    b.kaCell(6.9, 0, -88.4);
    b.kaCell(-5.6, 0, -94.6);

    // Plaza with an obelisk and holograms.
    obelisk(b, m, 0, 0, -97, 9, 1.8);
    planter(b, m, p, -4.2, 0, -97, 1.2, 3.2);
    planter(b, m, p, 4.2, 0, -97, 1.2, 3.2);
    hologram(b, -6, 5.5, -100, 'eye', '#30e0ff', 3);
    hologram(b, 6, 5.5, -94, 'scarab', '#ffc04a', 2.6);
    b.pickup('ammo', -10.4, 0.15, -98);
    b.pickup('health', 10.4, 0.15, -100);

    // Encounter B.
    for (const z of [-108, -128]) {
      for (const x of [-6.2, 6.2]) {
        b.instance(p.lotusColumn, x, 0, z, 0, 1.15);
        game.physics.addFixedCylinder(x, 2.3, z, 2.3, 0.42);
        game.cover.add(x, z, 0.42, 0.42, 0, 0, 4.6, 2, 'high');
      }
    }
    // Parked hover cart.
    b.box(-3.8, 0.35, -113, 2.2, 1.05, 4.4, { mat: m.blackGlass, cover: 'low', surface: 'metal' });
    b.box(-3.8, 0, -113, 1.8, 0.35, 3.8, { mat: m.trim, collide: false });
    b.box(-3.8, 0.1, -113, 2.3, 0.06, 4.5, { mat: m.neonCyan, collide: false, shadow: false });
    b.light(-3.8, 0.4, -113, 0x30e0ff, 3, 5);
    stall(b, m, 3.4, -109, Math.PI - 0.1, 'awningRed', 'neonPink');
    planter(b, m, p, 0, 0, -119, 5, 1.2);
    crateCover(b, p, 5.2, 0, -130, 0.2);
    crateCover(b, p, -6.4, 0, -132, -0.2, 2);
    stall(b, m, -7, -123, 0.05, 'awningTeal', 'neonGold');
    crateCover(b, p, 1.5, 0, -138, 0.5);
    b.pickup('ammo', 10.4, 0.15, -122);
    b.kaCell(-1.4, 0, -111.6);
    b.kaCell(4.4, 0, -132.4);
    b.kaCell(3.6, 0, -133.3);
    b.kaCell(-8.2, 0, -126.2);

    // The Sistrum's frontage: pylon gateway with the club door.
    b.box(-10.5, 0, -151, 5, 14, 2, { mat: m.lapis });
    b.box(10.5, 0, -151, 5, 14, 2, { mat: m.lapis });
    pylon(b, m, -6, 0, -150.5, 4.4, 13, 3, 0, false);
    pylon(b, m, 6, 0, -150.5, 4.4, 13, 3, 0, false);
    b.box(0, 8, -150.5, 8, 6, 2.5, { mat: m.relief });
    b.box(0, 14, -150.5, 26, 0.5, 3, { mat: m.gold, collide: false });
    neonSign(b, SIGNS.sistrum, 0, 9.6, -148.8, 0, 7.4, 1.6, '#ff3fa8', { groundY: 0, glyphs: true, border: true });
    b.door('clubDoor', 0, 0, -150.5, 7.6, 8, 0.6);
    b.light(0, 6, -147, 0xff3fa8, 10, 14);
  },
};
