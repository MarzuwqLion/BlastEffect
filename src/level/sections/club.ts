import * as THREE from 'three';
import { NAMES, OBJECTIVES } from '../../strings';
import { globalUniforms } from '../../render/materials';
import { hologram, neonSign } from '../kit';
import type { LevelBuilder } from '../LevelBuilder';
import type { SectionDef } from './types';

const WING_Y = 4.2;

/** Animated dance floor: tiles pulse in waves to the beat. */
function danceFloor(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number): void {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW;
      void main(){
        vec2 cell = floor(vW.xz / 1.5);
        vec2 f = fract(vW.xz / 1.5);
        float edge = step(0.06, f.x) * step(0.06, f.y) * step(f.x, 0.94) * step(f.y, 0.94);
        float beat = fract(uTime * 1.87);
        float wave = sin(length(cell - vec2(0.0, -118.0)) * 0.9 - uTime * 4.0) * 0.5 + 0.5;
        float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float on = step(0.55, wave * 0.7 + rnd * 0.5 * (1.0 - beat));
        vec3 a = vec3(1.0, 0.25, 0.65);
        vec3 bcol = vec3(0.2, 0.85, 1.0);
        vec3 c = mix(a, bcol, step(0.5, fract(rnd * 3.0 + floor(uTime * 0.5) * 0.37)));
        vec3 col = c * on * edge * (1.2 + (1.0 - beat) * 1.2) + vec3(0.02, 0.02, 0.03);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const w = x1 - x0;
  const d = z0 - z1;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
  mesh.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
  mesh.receiveShadow = false;
  b.group.add(mesh);
}

/** Sweeping light cones from the ceiling rig. */
function lightBeams(b: LevelBuilder, positions: [number, number, number, string][]): void {
  const geo = new THREE.ConeGeometry(1.4, 9, 16, 1, true).translate(0, -4.5, 0);
  for (const [x, y, z, color] of positions) {
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: /* glsl */ `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float f = abs(dot(vN, vV)); float a = (1.0 + vY / 9.0) * 0.18 * f; gl_FragColor = vec4(uColor * a, 1.0); }`,
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.position.set(x, y, z);
    cone.renderOrder = 4;
    b.group.add(cone);
    const phase = Math.random() * 10;
    b.anims.push((t) => {
      cone.rotation.x = Math.sin(t * 0.7 + phase) * 0.5;
      cone.rotation.z = Math.cos(t * 0.53 + phase) * 0.5;
    });
  }
}

function railing(b: LevelBuilder, x: number, z: number, len: number, alongX: boolean, section: number): void {
  const m = b.game.mats;
  const w = alongX ? len : 0.1;
  const d = alongX ? 0.1 : len;
  b.box(x, WING_Y, z, w, 1.05, d, { mat: m.glass, surface: 'glass', shadow: false });
  b.box(x, WING_Y + 1.05, z, alongX ? len : 0.16, 0.08, alongX ? 0.16 : len, { mat: m.gold, collide: false });
  b.box(x, WING_Y + 0.02, z, alongX ? len : 0.14, 0.05, alongX ? 0.14 : len, { mat: m.neonPink, collide: false, shadow: false });
  // Cover for enemies on the mezzanine (and the player up there).
  b.game.cover.add(x, z, w / 2 + 0.05, d / 2 + 0.05, 0, WING_Y, WING_Y + 1.1, section, 'low');
}

/**
 * Section 3: the Sistrum. Dance floor under a U-shaped mezzanine; the first
 * Hippo; the bartender (optional); a service corridor with supplies that
 * the intel opens.
 */
export const club: SectionDef = {
  index: 3,
  name: NAMES.club,
  checkpoint: { x: 0, y: 0, z: -155, yaw: 0 },
  enter: [-22, -1, -152, 30, 9, -200],
  nav: { minX: -22, maxX: 29, minZ: -201, maxZ: -151, minY: -1, maxY: 9 },
  music: 'combat',
  objective: OBJECTIVES.club,
  markers: { floor: [0, 1.5, -175], yaw: [-16.5, 2, -181], exit: [0, 6, -200], route: [22.5, 1.5, -180] },
  npcs: [{ id: 'yaw', x: -16.6, y: 0, z: -181, yaw: -Math.PI / 2, dialogue: 'bartender', available: (d) => d.isCleared('club') }],
  encounters: [
    {
      id: 'club',
      trigger: [-22, -1, -159, 22, 3, -199],
      waves: [
        {
          spawns: [
            { kind: 'grunt', x: 19.5, y: WING_Y, z: -181 },
            { kind: 'grunt', x: -19.5, y: WING_Y, z: -189, delay: 0.3 },
            { kind: 'trooper', x: 6, y: 0, z: -181 },
            { kind: 'grunt', x: -7, y: 0, z: -186, delay: 0.5 },
          ],
        },
        {
          whenAliveAtMost: 2,
          delay: 1.5,
          hint: 'heavy',
          spawns: [
            { kind: 'heavy', x: 7, y: 0, z: -197 },
            { kind: 'grunt', x: -11, y: WING_Y, z: -197, delay: 0.6 },
            { kind: 'grunt', x: 12, y: WING_Y, z: -197, delay: 1 },
          ],
        },
      ],
      onStart: (d) => d.hint('mezzanine', 'hover'),
      onClear: (d) => {
        d.openDoor('clubExit');
        d.setObjective(OBJECTIVES.clubExit, 'exit');
        d.setSecondaryObjective(OBJECTIVES.clubYaw);
      },
    },
  ],
  onEnter: (d) => {
    d.setObjective(OBJECTIVES.club, 'floor');
    if (d.flags.has('intel_route')) d.openDoor('serviceDoor');
  },
  build(b, game) {
    const m = game.mats;
    const p = game.props;
    // Shell.
    b.box(0, -0.6, -176, 45, 0.6, 50, { mat: m.tile });
    b.box(0, 10, -176, 46, 0.6, 50, { mat: m.trim });
    b.box(-13.25, 0, -152.5, 18.5, 10, 1, { mat: m.blackGlass });
    b.box(13.25, 0, -152.5, 18.5, 10, 1, { mat: m.blackGlass });
    b.box(0, 8, -152.5, 8, 2, 1, { mat: m.blackGlass });
    b.box(-22.75, 0, -176, 1.5, 10, 50, { mat: m.lapis });
    // East wall with the service door gap at z -178..-182.
    b.box(22.75, 0, -165, 1.5, 10, 26, { mat: m.lapis });
    b.box(22.75, 0, -191, 1.5, 10, 18, { mat: m.lapis });
    b.box(22.75, 3.5, -180, 1.5, 6.5, 4, { mat: m.lapis });
    // North wall with the exit opening on the mezzanine.
    b.box(0, 0, -200.75, 46, WING_Y, 1.5, { mat: m.lapis });
    b.box(-12.25, WING_Y, -200.75, 20.5, 10 - WING_Y, 1.5, { mat: m.lapis });
    b.box(12.25, WING_Y, -200.75, 20.5, 10 - WING_Y, 1.5, { mat: m.lapis });
    b.box(0, WING_Y + 4, -200.75, 4, 10 - WING_Y - 4, 1.5, { mat: m.lapis });
    b.door('clubExit', 0, WING_Y, -200.5, 4, 4, 0.5);
    // Neon bands on the walls.
    for (const y of [1.0, 9.2]) {
      b.box(-21.95, y, -176, 0.08, 0.08, 48, { mat: m.neonPink, collide: false, shadow: false });
      b.box(21.95, y, -176, 0.08, 0.08, 48, { mat: m.neonCyan, collide: false, shadow: false });
    }

    // Mezzanine (U-shape) and stairs.
    b.box(-19.5, WING_Y - 0.4, -184.5, 5, 0.4, 31, { mat: m.blackGlass });
    b.box(19.5, WING_Y - 0.4, -184.5, 5, 0.4, 31, { mat: m.blackGlass });
    b.box(0, WING_Y - 0.4, -197, 34, 0.4, 6, { mat: m.blackGlass });
    b.box(-17, WING_Y - 0.45, -184.5, 0.12, 0.12, 31, { mat: m.neonGold, collide: false, shadow: false });
    b.box(17, WING_Y - 0.45, -184.5, 0.12, 0.12, 31, { mat: m.neonGold, collide: false, shadow: false });
    b.box(0, WING_Y - 0.45, -194, 34, 0.12, 0.12, { mat: m.neonGold, collide: false, shadow: false });
    b.stairs(-19.5, -155, -169, 0, WING_Y, 4, m.sandstoneDark, 14);
    b.stairs(19.5, -155, -169, 0, WING_Y, 4, m.sandstoneDark, 14);
    // Stair side walls (so nobody falls off the open side).
    b.box(-17.4, 0, -162, 0.2, 1.0 + WING_Y * 0.5, 14, { mat: m.gold, collide: true, shadow: false });
    b.box(17.4, 0, -162, 0.2, 1.0 + WING_Y * 0.5, 14, { mat: m.gold, collide: true, shadow: false });
    // Railings with gaps above the speaker stacks.
    railing(b, -17, -181.5, 25, false, 3);
    railing(b, 17, -181.5, 25, false, 3);
    railing(b, -12.6, -194, 6.8, true, 3);
    railing(b, 0, -194, 11.6, true, 3);
    railing(b, 12.6, -194, 6.8, true, 3);
    railing(b, -17.25, -169, 0.5, true, 3);
    railing(b, 17.25, -169, 0.5, true, 3);

    // Columns under the wings (high cover on the floor).
    for (const z of [-172, -180, -188]) {
      for (const x of [-16.4, 16.4]) {
        b.instance(p.lotusColumn, x, 0, z, 0, 0.95);
        game.physics.addFixedCylinder(x, 1.9, z, 1.9, 0.38);
        game.cover.add(x, z, 0.38, 0.38, 0, 0, 3.8, 3, 'high');
      }
    }

    // Bar along the west side.
    b.box(-14.6, 0, -181, 1.2, 1.15, 17, { mat: m.blackGlass, cover: 'low' });
    b.box(-14.6, 1.15, -181, 1.5, 0.08, 17.2, { mat: m.gold, collide: false });
    b.box(-14.0, 0.25, -181, 0.05, 0.08, 17, { mat: m.neonCyan, collide: false, shadow: false });
    b.box(-21.6, 0, -181, 0.8, 3.4, 17, { mat: m.wood });
    for (let i = 0; i < 3; i++) {
      b.box(-21.15, 0.9 + i * 0.9, -181, 0.12, 0.05, 16.5, { mat: m.neonGold, collide: false, shadow: false });
      for (let k = 0; k < 14; k++) {
        b.box(-21.1, 0.95 + i * 0.9, -188.5 + k * 1.15, 0.12, 0.3, 0.12, { mat: k % 3 ? m.neonViolet : m.neonGreen, collide: false, shadow: false });
      }
    }
    for (let i = 0; i < 6; i++) b.instance(p.stool, -13.4, 0, -174 - i * 2.8, i);
    neonSign(b, 'BAR', -21.1, 3.6, -181, Math.PI / 2, 3, 0.8, '#40ff9a', {});

    // Booths on the east side.
    for (const z of [-172, -186]) {
      b.box(19.6, 0, z, 3, 1.1, 0.9, { mat: m.awningRed, cover: 'low' });
      b.box(19.6, 0, z - 3.4, 3, 1.1, 0.9, { mat: m.awningRed, cover: 'low' });
      b.instance(p.table, 19.6, 0, z - 1.7, 0);
    }

    // Dance floor, DJ stage, speakers.
    danceFloor(b, -9, -158, 9, -184);
    b.box(0, 0, -189.5, 18, 0.8, 7, { mat: m.blackGlass });
    b.box(0, 0.8, -186.1, 18, 0.06, 0.12, { mat: m.neonPink, collide: false, shadow: false });
    b.stairs(0, -184.5, -186, 0, 0.8, 4, m.blackGlass, 3);
    b.box(0, 0.8, -188, 4, 1.1, 1.2, { mat: m.metal, cover: 'low', surface: 'metal' });
    b.box(0, 1.9, -188, 4.1, 0.05, 1.3, { mat: m.neonCyan, collide: false, shadow: false });
    for (const x of [-7.5, 7.5]) {
      b.box(x, 0.8, -191, 1.4, 2.4, 1.0, { mat: m.trim, visible: false, cover: 'high' });
      b.instance(p.speaker, x, 0.8, -191, 0);
      b.instance(p.speaker, x + (x < 0 ? -1.6 : 1.6), 0, -186.5, 0, 0.9);
      b.box(x + (x < 0 ? -1.6 : 1.6), 0, -186.5, 1.3, 2.2, 0.9, { mat: m.trim, visible: false, cover: 'high' });
    }
    hologram(b, 0, 6.5, -190, 'sun', '#ff3fa8', 4);
    neonSign(b, NAMES.club.toUpperCase(), 0, 8.3, -199.9, 0, 9, 1.6, '#ff3fa8', { glyphs: true });
    // Disco ball.
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1, flatShading: true }));
    ball.position.set(0, 8.4, -172);
    b.group.add(ball);
    b.anims.push((t) => (ball.rotation.y = t * 0.5));
    lightBeams(b, [
      [-6, 9.8, -164, '#ff3fa8'], [6, 9.8, -164, '#30e0ff'], [-6, 9.8, -178, '#30e0ff'],
      [6, 9.8, -178, '#ff3fa8'], [0, 9.8, -170, '#ffc04a'],
    ]);
    // Lights.
    b.light(0, 6, -170, 0xff3fa8, 14, 20);
    b.light(0, 6, -182, 0x30e0ff, 12, 18);
    b.light(-15, 3, -181, 0x40ff9a, 6, 10);
    b.light(19.5, 3, -180, 0xff5050, 5, 10);
    b.light(-19.5, 7.5, -186, 0xa060ff, 6, 12);
    b.light(19.5, 7.5, -186, 0x30e0ff, 6, 12);
    b.light(0, 7.5, -197, 0xffc04a, 7, 12);
    b.light(0, 3, -155, 0xff3fa8, 6, 10);

    // Pickups on the floor and the mezzanine.
    b.pickup('ammo', -20.5, WING_Y, -175);
    b.pickup('ammo', 9, 0, -160);
    b.pickup('health', 20.5, WING_Y, -196);

    // Service corridor (opened by intel) with a supply cage.
    b.box(26, -0.6, -180, 7, 0.6, 9, { mat: m.concrete });
    b.box(26, 3.5, -180, 7, 0.4, 9, { mat: m.concrete });
    b.box(26, 0, -175.3, 7, 3.5, 0.6, { mat: m.concrete });
    b.box(26, 0, -184.7, 7, 3.5, 0.6, { mat: m.concrete });
    b.box(29.8, 0, -180, 0.6, 3.5, 9, { mat: m.concrete });
    b.door('serviceDoor', 22.75, 0, -180, 3.6, 3.5, 0.5, Math.PI / 2);
    b.pickup('ammo', 28.5, 0, -178, 'intel_route');
    b.pickup('health', 28.5, 0, -182, 'intel_route');
    b.pickup('health', 26, 0, -183.6, 'intel_route');
    b.light(27, 3, -180, 0xffc04a, 4, 8);
  },
};
