import * as THREE from 'three';
import { NAMES, OBJECTIVES } from '../../strings';
import { hologram, obelisk, pylon } from '../kit';
import type { SectionDef } from './types';

export const ARENA_Y = 9;
export const ARENA_CENTER = new THREE.Vector3(0, ARENA_Y, -306);

/**
 * Section 5: the Basin, the Crocodile's drained sacred lake. Purpose-built
 * boss arena: ring wall around the old pool (low cover), four raised
 * platforms with ramps (vertical routes, ammo), columns (high cover), and
 * side doors for reinforcements.
 */
export const basin: SectionDef = {
  index: 5,
  name: NAMES.lair,
  checkpoint: { x: 0, y: ARENA_Y, z: -285.5, yaw: 0 },
  enter: [-25, ARENA_Y - 1, -283, 25, 30, -331],
  nav: { minX: -25, maxX: 25, minZ: -331, maxZ: -282, minY: 8, maxY: 16 },
  music: 'boss',
  ambient: [0x5f8088, 0x2a1408, 1.05],
  objective: OBJECTIVES.boss,
  markers: { boss: [0, ARENA_Y + 3, -322], ledger: [0, ARENA_Y + 2, -328.5] },
  encounters: [],
  build(b, game) {
    const m = game.mats;
    const p = game.props;
    const Y = ARENA_Y;
    b.box(0, Y - 1.2, -306, 50, 1.2, 50, { mat: m.sandstoneDark });
    // Lapis inlay rings around the lake.
    for (const r of [9.5, 12]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 64).rotateX(-Math.PI / 2), m.lapis);
      ring.position.set(0, Y + 0.012, -306);
      b.group.add(ring);
    }
    // Wall sconces: gold bowls with flames all around the walls.
    const sconces: [number, number][] = [[-24.8, -290], [-24.8, -322], [24.8, -290], [24.8, -322], [-14, -330.8], [14, -330.8], [-8, -330.8], [8, -330.8]];
    for (const [sx, sz] of sconces) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.4, 10), m.gold);
      const inX = sx > 20 ? -0.5 : sx < -20 ? 0.5 : 0;
      const inZ = sz < -330 ? 0.5 : 0;
      bowl.position.set(sx + inX, Y + 4.2, sz + inZ);
      b.group.add(bowl);
      const fp = bowl.position.clone().add(new THREE.Vector3(0, 0.25, 0));
      b.anims.push((_t, dt) => {
        if (Math.random() < dt * 30) game.fx.add.emit(fp.x + (Math.random() - 0.5) * 0.35, fp.y, fp.z + (Math.random() - 0.5) * 0.35, 0, 1.2 + Math.random(), 0, 3, 1.3, 0.35, 0.28, 0.5, { endSize: 0.04, drag: 1 });
      });
      b.light(fp.x + inX, fp.y + 0.5, fp.z + inZ, 0xff8a3a, 6, 11, 1);
    }
    // Walls.
    b.box(-25.5, Y, -306, 1, 14, 50, { mat: m.relief });
    b.box(25.5, Y, -306, 1, 14, 50, { mat: m.relief });
    b.box(0, Y, -331.5, 52, 14, 1, { mat: m.relief });
    b.box(-20, Y, -281.5, 11, 14, 1, { mat: m.relief });
    b.box(20, Y, -281.5, 11, 14, 1, { mat: m.relief });
    for (const x of [-25, 25]) b.box(x, Y + 14, -306, 2, 0.6, 52, { mat: m.gold, collide: false });
    b.box(0, Y + 14, -331, 52, 0.6, 2, { mat: m.gold, collide: false });
    // Corner pylons.
    pylon(b, m, -22, Y, -328, 5, 16, 5, Math.PI / 4);
    pylon(b, m, 22, Y, -328, 5, 16, 5, -Math.PI / 4);

    // The drained lake: ring wall with four gaps, a shallow glowing pool.
    const ringR = 7;
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      if (i % 4 === 0) continue;
      const a = ((i + 0.5) / segs) * Math.PI * 2;
      const x = Math.cos(a) * ringR;
      const z = -306 + Math.sin(a) * ringR;
      const len = 2 * ringR * Math.sin(Math.PI / segs) + 0.15;
      b.box(x, Y, z, len, 1.0, 0.6, { mat: m.sandstone, rotY: -a + Math.PI / 2, cover: 'low' });
      b.box(x, Y + 1.0, z, len, 0.08, 0.7, { mat: m.gold, rotY: -a + Math.PI / 2, collide: false });
    }
    const water = new THREE.Mesh(new THREE.CircleGeometry(ringR - 0.3, 40).rotateX(-Math.PI / 2), m.water);
    water.position.set(0, Y + 0.04, -306);
    b.group.add(water);
    const glyphRing = new THREE.Mesh(new THREE.RingGeometry(ringR - 1.6, ringR - 1.3, 48).rotateX(-Math.PI / 2), m.neonGreen);
    glyphRing.position.set(0, Y + 0.06, -306);
    b.group.add(glyphRing);
    b.anims.push((t) => (glyphRing.rotation.y = t * 0.1));
    hologram(b, 0, Y + 7, -306, 'eye', '#40ff9a', 5);
    b.light(0, Y + 3, -306, 0x40ff9a, 5, 14);

    // Raised platforms with ramps.
    for (const sx of [-1, 1]) {
      for (const [pz, rz0, rz1] of [[-292, -303.5, -295.5], [-320, -308.5, -316.5]] as const) {
        const px = sx * 15.5;
        b.box(px, Y, pz, 7, 3, 7, { mat: m.sandstoneDark, cover: 'high' });
        b.box(px, Y + 3, pz, 7.2, 0.12, 7.2, { mat: m.gold, collide: false });
        b.stairs(px, rz0, rz1, Y, Y + 3, 3, m.sandstoneDark, 10);
        // Parapet on the outer edges of each platform.
        b.box(px + sx * 3.3, Y + 3, pz, 0.4, 1.0, 7, { mat: m.sandstone, cover: 'low' });
        // Fire bowl.
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.3, 0.5, 12), m.gold);
        bowl.position.set(px + sx * 2.5, Y + 3.6, pz + (pz > -306 ? -2.5 : 2.5));
        b.group.add(bowl);
        const flamePos = bowl.position.clone().add(new THREE.Vector3(0, 0.3, 0));
        b.anims.push((_t, dt) => {
          if (Math.random() < dt * 40) {
            game.fx.add.emit(flamePos.x + (Math.random() - 0.5) * 0.5, flamePos.y, flamePos.z + (Math.random() - 0.5) * 0.5, 0, 1.5 + Math.random(), 0, 3, 1.4, 0.4, 0.35, 0.6, { endSize: 0.05, drag: 1 });
          }
        });
        b.light(flamePos.x, flamePos.y + 0.6, flamePos.z, 0xff8a3a, 7, 12, 1);
      }
    }
    b.pickup('ammo', -16.5, Y + 3, -290);
    b.pickup('ammo', 16.5, Y + 3, -322);
    b.pickup('health', 16.5, Y + 3, -290);
    b.pickup('health', -16.5, Y + 3, -322);
    b.pickup('ammo', 0, Y, -296.5);

    // Columns (high cover).
    for (const [x, z] of [[-9, -289.5], [9, -289.5], [-20, -306], [20, -306], [-9, -322.5], [9, -322.5]] as const) {
      b.instance(p.papyrusColumn, x, Y, z, 0, 1.2);
      game.physics.addFixedCylinder(x, Y + 4, z, 4, 0.72);
      game.cover.add(x, z, 0.7, 0.7, 0, Y, Y + 8, 5, 'high');
    }
    obelisk(b, m, -12, Y, -330, 10, 1.4);
    obelisk(b, m, 12, Y, -330, 10, 1.4);

    // Throne dais.
    b.box(0, Y, -327, 12, 1, 6, { mat: m.basalt });
    b.box(0, Y + 1, -327, 12.2, 0.08, 6.2, { mat: m.gold, collide: false });
    b.stairs(0, -322.2, -324, Y, Y + 1, 6, m.basalt, 4);
    b.box(0, Y + 1, -328.5, 2.6, 1.0, 1.6, { mat: m.basalt });
    b.box(0, Y + 1, -329.4, 2.8, 4.5, 0.5, { mat: m.gold });
    b.box(0, Y + 5.5, -329.4, 1.6, 1.4, 0.6, { mat: m.basalt, collide: false });
    for (const sx of [-1, 1]) b.box(sx * 1.5, Y + 1, -328.6, 0.4, 1.6, 1.8, { mat: m.gold });
    // The ledger lectern behind the throne.
    b.box(3.5, Y + 1, -329.5, 0.8, 1.2, 0.6, { mat: m.wood });
    const ledger = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.45), m.neonGold);
    ledger.position.set(3.5, Y + 2.25, -329.5);
    ledger.rotation.x = 0.3;
    b.group.add(ledger);
    b.light(3.5, Y + 3, -329, 0xffc04a, 3, 5);
    b.light(0, Y + 8, -324, 0x40ff9a, 4, 14);

    // Reinforcement doors.
    b.door('basinEast', 25, Y, -306, 4, 5, 0.6, Math.PI / 2);
    b.door('basinWest', -25, Y, -306, 4, 5, 0.6, Math.PI / 2);
    // Gate closes behind the player once the fight starts.
    b.door('basinSeal', 0, Y, -283.5, 11, 10, 0.5);
    b.light(0, Y + 8, -290, 0xffa060, 6, 20);
    void OBJECTIVES;
  },
};
