import * as THREE from 'three';
import { MASK } from '../core/Physics';
import { ARENA_CENTER, ARENA_Y } from '../level/sections/basin';
import { CINE } from '../strings';
import type { CineShot } from './Cinematic';
import type { Game } from './Game';

type V3 = [number, number, number];

/** Where the train waits at the platform, and where it comes in from. */
const TRAIN_REST_Z = -16;
const TRAIN_FAR_Z = 58;

/**
 * The opening: the last train slides into Reach Station, and Imani says in
 * four lines why she is on it. Ends on her back, where play begins.
 */
export function openingShots(game: Game): CineShot[] {
  const train = game.setPieces.train;
  const p = game.player.position;
  const head: V3 = [p.x, p.y + 1.56, p.z];
  return [
    {
      dur: 7.5,
      fadeIn: 1.6,
      ease: 'out',
      pos: [[3.2, 8.6, 3.4], [1.2, 6.1, -3]],
      look: [[-8, 1.2, -28], [-9.5, 1.5, -21]],
      fov: [50, 46],
      title: { head: CINE.openTitle, sub: CINE.openSub },
      onStart: (skipped) => {
        if (train) train.position.z = TRAIN_FAR_Z;
        if (!skipped) game.audio.play('trainArrive');
      },
      onUpdate: (k) => {
        // Braking in: fast at first, settling at the platform.
        if (train) train.position.z = TRAIN_FAR_Z + (TRAIN_REST_Z - TRAIN_FAR_Z) * (1 - Math.pow(1 - Math.min(1, k / 0.9), 3));
      },
    },
    {
      dur: 5.2,
      pos: [[-8.3, 1.25, -30.5], [-8.1, 1.5, -27.5]],
      look: [[-12.6, 1.5, -15], [-12.2, 1.6, -10]],
      fov: [40, 38],
      lines: [{ at: 0.5, who: 'imani', text: CINE.open[0] }],
      onStart: () => {
        if (train) train.position.z = TRAIN_REST_Z;
      },
    },
    {
      dur: 7,
      pos: [[p.x + 0.95, p.y + 1.6, p.z - 2.5], [p.x + 0.7, p.y + 1.6, p.z - 1.85]],
      look: [head, head],
      fov: [34, 31],
      lines: [
        { at: 0.4, who: 'imani', text: CINE.open[1] },
        { at: 3.8, who: 'imani', text: CINE.open[2] },
      ],
    },
    {
      dur: 4.6,
      fadeOut: 0.5,
      pos: [[p.x - 0.9, p.y + 1.95, p.z + 2.6], [p.x - 0.6, p.y + 1.85, p.z + 2.1]],
      look: [[p.x + 5, p.y + 1.4, p.z - 11], [p.x + 6, p.y + 1.4, p.z - 13]],
      fov: [46, 44],
      lines: [{ at: 0.5, who: 'imani', text: CINE.open[3] }],
    },
  ];
}

/**
 * The ending: the eye over the Basin goes out, the lake comes back, and
 * Imani stands in it. Leaves the arena flooded for the screens that follow.
 */
export function endingShots(game: Game): CineShot[] {
  const set = game.setPieces.basin;
  const Y = ARENA_Y;
  const c = ARENA_CENTER;
  const p = game.player.position.clone();
  // From Imani toward the lake (or straight up the arena if she is standing in it).
  const dir = new THREE.Vector3(c.x - p.x, 0, c.z - p.z);
  if (dir.length() < 3) dir.set(0, 0, -1);
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const eye = new THREE.Vector3(p.x, p.y + 1.55, p.z);
  // Keep a camera point out of walls and columns: pull it toward her if something is in the way.
  const clear = (v: THREE.Vector3): V3 => {
    const to = v.clone().sub(eye);
    const len = to.length();
    to.divideScalar(len);
    const free = game.physics.sphereCast(eye, to, 0.25, len, MASK.world);
    if (free < len) v.copy(eye).addScaledVector(to, Math.max(0.6, free - 0.15));
    return [v.x, v.y, v.z];
  };
  let flood = 0;
  const rise = (dt: number, rate: number): void => {
    flood = Math.min(1, flood + dt * rate);
    set?.setFlood(flood);
  };
  return [
    {
      dur: 6.5,
      fadeIn: 0.8,
      pos: [[-5.2, Y + 1.5, -299.2], [-4.4, Y + 1.9, -300.2]],
      look: [[0, Y + 7, -306], [0, Y + 6, -306]],
      fov: [46, 42],
      lines: [{ at: 0.8, text: CINE.end[0] }],
      onStart: (skipped) => {
        set?.begin();
        if (!skipped) game.leviathan.pass(new THREE.Vector3(-64, Y + 34, -352), new THREE.Vector3(66, Y + 30, -262), 24);
      },
      onUpdate: (k) => set?.setEye(1 - Math.min(1, k / 0.6)),
    },
    {
      dur: 8.5,
      pos: [[0.6, Y + 0.75, -285.6], [0.2, Y + 4.4, -287.5]],
      look: [[0, Y + 0.6, -306], [0, Y + 0.2, -309]],
      fov: [44, 48],
      lines: [
        { at: 0.6, text: CINE.end[1] },
        { at: 4.8, text: CINE.end[2] },
      ],
      onStart: () => set?.setEye(0),
      onUpdate: (_k, _t, dt) => rise(dt, 1 / 13),
    },
    {
      dur: 9,
      fadeOut: 1.4,
      pos: [
        clear(eye.clone().addScaledVector(dir, -2.4).addScaledVector(side, 0.9).add(new THREE.Vector3(0, 0.25, 0))),
        clear(eye.clone().addScaledVector(dir, -4.6).addScaledVector(side, 1.3).add(new THREE.Vector3(0, 1.9, 0))),
      ],
      look: [
        [p.x + dir.x * 3, p.y + 1.35, p.z + dir.z * 3],
        [c.x, Y + 0.6, c.z],
      ],
      fov: [38, 42],
      lines: [{ at: 0.8, text: CINE.end[3] }],
      onUpdate: (k, _t, dt) => {
        rise(dt, 1 / 13);
        // Skipped: the lake is simply full.
        if (dt === 0 && k >= 1) set?.setFlood(1);
      },
    },
  ];
}
