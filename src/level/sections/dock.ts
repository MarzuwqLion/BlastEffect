import * as THREE from 'three';
import { SIGNS, OBJECTIVES, NAMES } from '../../strings';
import { hologram, neonSign, obelisk, pylon, reflectionCard } from '../kit';
import type { SectionDef } from './types';

/**
 * Section 1: Reach Station, the transit dock. Safe area: the contact,
 * control prompts, a ledge to practise jump-jets and hover.
 */
export const dock: SectionDef = {
  index: 1,
  name: NAMES.station,
  checkpoint: { x: -5, y: 0, z: -3, yaw: 0 },
  enter: [-14, -2, 6, 14, 12, -38],
  nav: { minX: -12, maxX: 14, minZ: -44, maxZ: 4, minY: -2, maxY: 8 },
  music: 'dock',
  objective: OBJECTIVES.dockTalk,
  encounters: [],
  npcs: [{ id: 'odette', x: 4.6, y: 0, z: -11.2, yaw: Math.PI * 0.62, dialogue: 'dock' }],
  markers: { odette: [4.6, 2.2, -11.2], gate: [1, 2, -40] },
  build(b, game) {
    const m = game.mats;
    const p = game.props;
    // Platform floor and track bed.
    b.box(2, -0.6, -18, 24, 0.6, 46, { mat: m.basalt });
    b.box(-14, -2.2, -18, 8, 0.6, 46, { mat: m.concrete });
    b.box(-10.2, -1.6, -18, 0.4, 1.6, 46, { mat: m.sandstoneDark });
    // Platform edge safety strip and the invisible barrier.
    b.box(-9.6, 0, -18, 0.25, 0.02, 44, { mat: m.neonGold, collide: false, shadow: false });
    b.blocker(-10.3, 0, -18, 0.4, 6, 46);
    // Maglev rail and train.
    b.box(-14, -1.6, -18, 0.5, 0.35, 46, { mat: m.gold });
    const train = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(1.6, 26, 6, 16).rotateX(Math.PI / 2);
    bodyGeo.scale(1, 1.05, 1);
    const body = new THREE.Mesh(bodyGeo, m.blackGlass);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 27), m.neonCyan);
    stripe.position.y = -0.4;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 26), m.gold);
    roof.position.y = 1.62;
    train.add(body, stripe, roof);
    for (let i = 0; i < 9; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.7, 1.6), m.windowCool);
      win.position.set(0, 0.4, -12 + i * 3);
      train.add(win);
    }
    train.position.set(-14, 0.2, -16);
    b.group.add(train);
    b.blocker(-14, -1.6, -16, 3.4, 4, 30);
    // Glass tube over the tracks.
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 48, 24, 1, true, Math.PI, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), m.glass);
    tube.position.set(-14, -0.5, -18);
    b.group.add(tube);
    for (let z = 2; z > -42; z -= 6) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.08, 6, 24, Math.PI), m.gold);
      rib.position.set(-14, -0.5, z);
      b.group.add(rib);
    }

    // Back wall and east wall.
    b.box(2, 0, 5, 26, 10, 1, { mat: m.lapis });
    b.box(2, 10, 5, 27, 0.6, 1.6, { mat: m.gold, collide: false });
    b.box(14.5, 0, -18, 1, 10, 46, { mat: m.relief });
    b.box(14, 10, -18, 1.8, 0.5, 46, { mat: m.gold, collide: false });
    // Lapis panels with glyph glow on the east wall.
    for (let z = -4; z > -38; z -= 8) {
      b.box(13.95, 1.5, z, 0.1, 5, 3, { mat: m.lapis, collide: false });
      b.box(13.9, 1.2, z, 0.12, 0.08, 3.2, { mat: m.neonCyan, collide: false, shadow: false });
      b.box(13.9, 6.6, z, 0.12, 0.08, 3.2, { mat: m.neonCyan, collide: false, shadow: false });
    }

    // Colonnade of papyrus columns.
    for (const z of [-6, -14, -22, -30]) {
      b.instance(p.papyrusColumn, 8.5, 0, z, 0, 1.05);
      game.physics.addFixedCylinder(8.5, 3.6, z, 3.6, 0.6);
      game.cover.add(8.5, z, 0.55, 0.55, 0, 0, 7, 1, 'high');
    }
    // Roof beams over the colonnade.
    b.box(11.3, 7.3, -18, 6.5, 0.6, 46, { mat: m.sandstone, collide: false });
    b.box(8.1, 7.0, -18, 0.3, 0.3, 46, { mat: m.neonGold, collide: false, shadow: false });

    // Odette's kiosk.
    b.box(6.2, 0, -11.5, 2.6, 1.15, 2.2, { mat: m.lapis, cover: 'low' });
    b.box(6.2, 1.15, -11.5, 2.8, 0.08, 2.4, { mat: m.gold, collide: false });
    b.box(7.3, 0, -11.5, 0.3, 3.2, 2.4, { mat: m.trim });
    b.box(6.2, 3.2, -11.5, 3.0, 0.2, 2.8, { mat: m.sandstone, collide: false });
    b.box(5.0, 1.25, -11.6, 0.05, 0.6, 1.0, { mat: m.screen, collide: false, shadow: false, rotY: 0.2 });
    neonSign(b, 'DOCK OFFICE', 6.2, 3.7, -11.5, -Math.PI / 2, 2.8, 0.6, '#ffc04a', {});
    b.light(5, 2.6, -11.5, 0xffd090, 5, 8);

    // Benches and planters to practise movement; a cargo stack ledge for jump-jets.
    b.instance(p.bench, 2, 0, -5, Math.PI / 2);
    b.instance(p.bench, 2, 0, -19, Math.PI / 2);
    b.box(2, 0, -5, 0.6, 0.5, 2, { mat: m.trim, visible: false });
    b.box(2, 0, -19, 0.6, 0.5, 2, { mat: m.trim, visible: false });
    b.box(-4.5, 0, -24, 5, 2.3, 4, { mat: m.metal, surface: 'metal' });
    b.box(-4.5, 2.3, -24, 5.2, 0.1, 4.2, { mat: m.neonGold, collide: false, shadow: false });
    b.box(-2.0, 0, -29.5, 3, 1.1, 2.4, { mat: m.metal, surface: 'metal' });
    b.instance(p.crate, -7.2, 2.3, -23.2, 0.2);
    b.pickup('health', -4.5, 2.4, -25.2);

    // Arrivals board hologram and station sign.
    neonSign(b, SIGNS.station, 2, 8.2, 4.4, Math.PI, 9, 1.4, '#30e0ff', { glyphs: true, border: true });
    neonSign(b, SIGNS.arrivals, 13.85, 4.2, -18, -Math.PI / 2, 4, 0.8, '#ffc04a', { groundY: 0 });
    neonSign(b, SIGNS.closed, 13.85, 3.4, -18, -Math.PI / 2, 4, 0.5, '#ff5040', {});
    hologram(b, -6, 3.2, -12, 'bird', '#30e0ff', 2.2);
    obelisk(b, m, 1, 0, -32, 7, 1.2);
    reflectionCard(b, 1, 0, -32, 0, 1.2, '#30e0ff', 6);

    // Lamps.
    for (const z of [-2, -12, -22, -34]) {
      b.instance(p.lamp, -8.8, 0, z, 0, 1);
      b.light(-8.8, 3.9, z, 0xffc06a, 6, 10);
    }

    // Pylon gate to the strip.
    pylon(b, m, -7.8, 0, -40.5, 6.5, 12, 4.5);
    pylon(b, m, 9.8, 0, -40.5, 6.5, 12, 4.5);
    b.box(1, 11, -40.5, 11, 1.2, 3, { mat: m.sandstone });
    b.box(1, 12.2, -40.5, 11.2, 0.3, 3.2, { mat: m.gold, collide: false });
    // Winged sun disk over the gate.
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 24).rotateX(Math.PI / 2), m.neonGold);
    disk.position.set(1, 11.6, -38.9);
    b.group.add(disk);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.1), m.gold);
      wing.position.set(1 + s * 2.4, 11.6, -38.95);
      wing.rotation.z = s * -0.08;
      b.group.add(wing);
    }
    b.door('dockGate', 1, 0, -40.5, 10.6, 11, 0.6);
    // Walls closing the gap between the pylons and the side walls.
    b.box(-11.5, 0, -40.5, 1.4, 12, 4, { mat: m.sandstoneDark });
    b.box(13.4, 0, -40.5, 1.6, 12, 4, { mat: m.sandstoneDark });
    // Bounds.
    b.blocker(2, 0, 6.5, 30, 14, 1);
    b.blocker(15.4, 0, -18, 1, 14, 50);
    b.light(1, 9, -36, 0x30e0ff, 8, 14);
    b.light(-2, 6, -18, 0xff9a50, 3, 18);
  },
};
