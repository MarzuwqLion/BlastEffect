import * as THREE from 'three';
import { NAMES, OBJECTIVES } from '../../strings';
import { hologram, obelisk, pylon } from '../kit';
import type { SectionDef } from './types';

/**
 * The lake coming back in the ending: dark water that takes the sky's teal
 * at grazing angles, slow ripples, warm and cold glints, a glow where the
 * old pool is.
 */
function floodMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uAlpha: { value: 0 }, uCenter: { value: new THREE.Vector2(0, -306) } },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uAlpha;
      uniform vec2 uCenter;
      varying vec3 vWorld;
      float ripple(vec2 p) {
        float a = sin(p.x * 1.7 + uTime * 0.9) * sin(p.y * 2.1 - uTime * 0.7);
        float b = sin((p.x + p.y) * 3.3 - uTime * 1.3) * sin((p.x - p.y) * 2.7 + uTime * 1.1);
        float c = sin(length(p - uCenter) * 2.4 - uTime * 1.6);
        return a * 0.5 + b * 0.3 + c * 0.2;
      }
      void main() {
        vec2 p = vWorld.xz;
        float h = ripple(p);
        float e = 0.06;
        vec3 n = normalize(vec3((h - ripple(p + vec2(e, 0.0))) * 1.1, 1.0, (h - ripple(p + vec2(0.0, e))) * 1.1));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.0);
        vec3 col = mix(vec3(0.008, 0.05, 0.075), vec3(0.05, 0.27, 0.34), fres);
        vec3 r = reflect(-v, n);
        // The sconces' fire and the dome's light, caught on the ripples.
        col += vec3(1.0, 0.72, 0.38) * pow(max(dot(r, normalize(vec3(0.35, 0.5, -0.8))), 0.0), 320.0) * 0.6;
        col += vec3(1.0, 0.72, 0.38) * pow(max(dot(r, normalize(vec3(-0.6, 0.45, 0.65))), 0.0), 320.0) * 0.5;
        col += vec3(0.45, 0.92, 1.0) * pow(max(dot(r, normalize(vec3(0.0, 0.9, 0.1))), 0.0), 26.0) * 0.5;
        // Light from under the old pool.
        float d = length(p - uCenter);
        col += vec3(0.08, 0.5, 0.6) * (0.6 + 0.4 * h) * (1.0 - smoothstep(1.0, 10.0, d)) * 0.4;
        gl_FragColor = vec4(col, uAlpha * (0.74 + fres * 0.24));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

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
  music: 'heist',
  dome: 0.55,
  ambient: [0x5f8088, 0x2a1408, 1.65],
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
    const eye = hologram(b, 0, Y + 7, -306, 'eye', '#40ff9a', 5);
    const eyeLight = b.lights[b.lights.length - 1];
    b.light(0, Y + 3, -306, 0x40ff9a, 5, 14);
    const lakeLight = b.lights[b.lights.length - 1];

    // The ending: the Crocodile's eye goes out and the lake comes back, a
    // sheet of water over the whole floor with lotus lamps drifting on it.
    const floodMat = floodMaterial();
    const flood = new THREE.Mesh(new THREE.PlaneGeometry(49.6, 49.6).rotateX(-Math.PI / 2), floodMat);
    flood.position.set(0, Y - 0.05, -306);
    flood.renderOrder = 2;
    flood.visible = false;
    b.group.add(flood);
    const lamps: THREE.Mesh[] = [];
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996;
      const r = 5 + ((i * 7) % 11) * 1.55;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.09, 8), i % 3 === 0 ? m.neonGold : m.neonPink);
      lamp.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      lamp.scale.setScalar(0.001);
      flood.add(lamp);
      lamps.push(lamp);
    }
    const green = new THREE.Color(0x40ff9a);
    const cyan = new THREE.Color(0x58d8ff);
    let level = 0;
    b.anims.push((t) => {
      if (level <= 0) return;
      floodMat.uniforms.uTime.value = t;
      // Lamps bob and drift a little once they are afloat.
      lamps.forEach((l, i) => {
        l.position.y = 0.04 + Math.sin(t * 1.3 + i * 1.7) * 0.02;
        l.rotation.y = t * 0.2 + i;
      });
    });
    game.setPieces.basin = {
      begin: () => {
        glyphRing.visible = false;
      },
      setEye: (k) => {
        // Flickers down to nothing; the lake's light turns from his green to water.
        const flick = k > 0 && k < 1 ? 0.75 + 0.25 * Math.sin(k * 60) : 1;
        eye.visible = k > 0.02;
        eye.scale.setScalar(Math.max(0.001, k * flick));
        eyeLight.intensity = 4 * k;
        lakeLight.color.copy(cyan).lerp(green, k);
        lakeLight.intensity = 3.5 + 1.5 * k;
      },
      setFlood: (k) => {
        level = k;
        flood.visible = k > 0;
        flood.position.y = Y - 0.05 + k * 0.42;
        floodMat.uniforms.uAlpha.value = Math.min(1, k * 4);
        water.visible = k < 0.2;
        const s = Math.min(1, Math.max(0, (k - 0.25) / 0.4));
        for (const l of lamps) l.scale.setScalar(Math.max(0.001, s));
      },
    };

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
    // Ka cells from the harvest, stacked around the lake: lure him past one.
    b.kaCell(-12.5, Y, -299.5);
    b.kaCell(12.5, Y, -312.5);
    b.kaCell(-5.5, Y, -318.8);
    b.kaCell(5.5, Y, -293.4);

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
