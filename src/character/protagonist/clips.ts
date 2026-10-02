import * as THREE from 'three';
import { BONES, LOWER } from './skeleton';

/**
 * Imani's keyframe clips, authored in code as poses (Euler XYZ radians per
 * bone) at normalized times. Conventions (model faces +Z, her left is +X):
 *  thigh x<0 swings the leg forward; shin x>0 bends the knee;
 *  foot x<0 lifts the toes; spine/chest/head x>0 bends forward/down;
 *  upperArm x<0 raises the arm forward; foreArm x<0 bends the elbow;
 *  upperArmL z>0 / upperArmR z<0 lifts the arm out to the side;
 *  y>0 turns toward her left.
 * Each clip becomes an AnimationClip; the Protagonist splits them into a
 * lower-body and an upper-body layer and blends them with AnimationMixer.
 */

export type Rot = [number, number, number];
export type Pose = { [bone: string]: Rot | number | undefined } & { hipsY?: number; hipsZ?: number };

export interface ClipDef {
  name: string;
  duration: number;
  keys: { t: number; pose: Pose }[];
}

const BIND = new Map(BONES.map(([n, , x, y, z]) => [n, new THREE.Vector3(x, y, z)]));

/** Mirror a pose left↔right (negating yaw and roll). */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'hipsY' || k === 'hipsZ') {
      out[k] = v as number;
      continue;
    }
    const r = v as Rot;
    const m = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
    out[m] = [r[0], -r[1], -r[2]];
  }
  return out;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'hipsY' || k === 'hipsZ') {
      out[k] = ((a[k] as number) ?? 0) * (1 - t) + ((b[k] as number) ?? 0) * t;
      continue;
    }
    const ra = (a[k] as Rot) ?? [0, 0, 0];
    const rb = (b[k] as Rot) ?? [0, 0, 0];
    out[k] = [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t];
  }
  return out;
}

export function buildClip(def: ClipDef): THREE.AnimationClip {
  const bones = new Set<string>();
  let hasHips = false;
  for (const k of def.keys) {
    for (const b of Object.keys(k.pose)) {
      if (b === 'hipsY' || b === 'hipsZ') hasHips = true;
      else bones.add(b);
    }
  }
  const times = def.keys.map((k) => k.t * def.duration);
  const tracks: THREE.KeyframeTrack[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const b of bones) {
    const values: number[] = [];
    for (const k of def.keys) {
      const r = (k.pose[b] as Rot) ?? [0, 0, 0];
      q.setFromEuler(e.set(r[0], r[1], r[2], 'XYZ'));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, values));
  }
  if (hasHips) {
    const bind = BIND.get('hips')!;
    const values: number[] = [];
    for (const k of def.keys) values.push(bind.x, bind.y + ((k.pose.hipsY as number) ?? 0), bind.z + ((k.pose.hipsZ as number) ?? 0));
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, values));
  }
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}

/** Split a clip into the lower-body and upper-body layers. */
export function splitClip(clip: THREE.AnimationClip): { lower: THREE.AnimationClip; upper: THREE.AnimationClip } {
  const lower = clip.tracks.filter((t) => LOWER.has(t.name.split('.')[0]));
  const upper = clip.tracks.filter((t) => !LOWER.has(t.name.split('.')[0]));
  return {
    lower: new THREE.AnimationClip(`${clip.name}:lower`, clip.duration, lower),
    upper: new THREE.AnimationClip(`${clip.name}:upper`, clip.duration, upper),
  };
}

/** Cyclic gait from a half-cycle (the second half is the mirror). */
function gait(name: string, half: Pose[]): ClipDef {
  const n = half.length;
  const keys: { t: number; pose: Pose }[] = [];
  half.forEach((p, i) => keys.push({ t: (i / n) * 0.5, pose: p }));
  half.forEach((p, i) => keys.push({ t: 0.5 + (i / n) * 0.5, pose: mirror(p) }));
  keys.push({ t: 1, pose: half[0] });
  return { name, duration: 1, keys };
}

// ---- Lower body ----

const idle: ClipDef = {
  name: 'idle',
  duration: 4,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2);
    return {
      t,
      pose: {
        hipsY: -0.015 + s * 0.004,
        hips: [0, -0.08, 0.035 + s * 0.012],
        thighL: [-0.1, 0.12, 0.06],
        shinL: [0.16, 0, 0],
        footL: [-0.06, 0.05, -0.04],
        thighR: [0.02, -0.06, -0.03],
        shinR: [0.05, 0, 0],
        footR: [-0.02, 0, 0.03],
      },
    };
  }),
};

// Run: contact, down, passing, up (left leg leads), mirrored for the right.
const run = gait('run', [
  { hipsY: -0.02, hips: [0.05, 0.12, 0], thighL: [-0.62, 0, 0], shinL: [0.22, 0, 0], footL: [-0.15, 0, 0], thighR: [0.48, 0, 0], shinR: [0.8, 0, 0], footR: [0.45, 0, 0] },
  { hipsY: -0.07, hips: [0.06, 0.08, -0.03], thighL: [-0.32, 0, 0], shinL: [0.55, 0, 0], footL: [0.05, 0, 0], thighR: [0.1, 0, 0], shinR: [1.65, 0, 0], footR: [0.3, 0, 0] },
  { hipsY: -0.01, hips: [0.06, 0, -0.04], thighL: [0.08, 0, 0], shinL: [0.32, 0, 0], footL: [-0.05, 0, 0], thighR: [-0.62, 0, 0], shinR: [1.9, 0, 0], footR: [-0.1, 0, 0] },
  { hipsY: 0.04, hips: [0.05, -0.06, -0.02], thighL: [0.38, 0, 0], shinL: [0.28, 0, 0], footL: [0.55, 0, 0], thighR: [-0.95, 0, 0], shinR: [1.05, 0, 0], footR: [-0.2, 0, 0] },
]);

const sprint = gait('sprint', [
  { hipsY: -0.03, hips: [0.12, 0.16, 0], thighL: [-0.85, 0, 0], shinL: [0.3, 0, 0], footL: [-0.2, 0, 0], thighR: [0.62, 0, 0], shinR: [1.0, 0, 0], footR: [0.55, 0, 0] },
  { hipsY: -0.09, hips: [0.13, 0.1, -0.03], thighL: [-0.45, 0, 0], shinL: [0.6, 0, 0], footL: [0.05, 0, 0], thighR: [0.15, 0, 0], shinR: [2.0, 0, 0], footR: [0.35, 0, 0] },
  { hipsY: -0.01, hips: [0.12, 0, -0.04], thighL: [0.1, 0, 0], shinL: [0.35, 0, 0], footL: [-0.05, 0, 0], thighR: [-0.85, 0, 0], shinR: [2.1, 0, 0], footR: [-0.15, 0, 0] },
  { hipsY: 0.06, hips: [0.12, -0.08, -0.02], thighL: [0.55, 0, 0], shinL: [0.35, 0, 0], footL: [0.7, 0, 0], thighR: [-1.2, 0, 0], shinR: [1.2, 0, 0], footR: [-0.25, 0, 0] },
]);

const crouch: ClipDef = {
  name: 'crouch',
  duration: 3,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2) * 0.01;
    return {
      t,
      pose: {
        hipsY: -0.44 + s,
        hipsZ: -0.04,
        hips: [0.2, 0, 0],
        thighL: [-1.75, 0.15, 0.12],
        shinL: [2.2, 0, 0],
        footL: [-0.55, 0, 0],
        thighR: [-0.75, -0.1, -0.08],
        shinR: [2.3, 0, 0],
        footR: [0.55, 0, 0],
        toeR: [-0.6, 0, 0],
      },
    };
  }),
};

const crouchWalk = gait('crouchWalk', [
  { hipsY: -0.4, hips: [0.25, 0.08, 0], thighL: [-1.4, 0, 0.1], shinL: [1.7, 0, 0], footL: [-0.3, 0, 0], thighR: [-0.6, 0, -0.1], shinR: [1.9, 0, 0], footR: [0.2, 0, 0] },
  { hipsY: -0.42, hips: [0.25, 0, 0], thighL: [-0.9, 0, 0.1], shinL: [1.9, 0, 0], footL: [-0.2, 0, 0], thighR: [-1.2, 0, -0.1], shinR: [2.2, 0, 0], footR: [-0.2, 0, 0] },
]);

const air: ClipDef = {
  name: 'air',
  duration: 1,
  keys: [
    { t: 0, pose: { hipsY: 0, thighL: [-0.95, 0.05, 0.05], shinL: [1.3, 0, 0], footL: [0.35, 0, 0], thighR: [-0.25, 0, -0.05], shinR: [0.7, 0, 0], footR: [0.4, 0, 0] } },
    { t: 1, pose: { hipsY: 0, thighL: [-0.4, 0.05, 0.08], shinL: [0.45, 0, 0], footL: [0.25, 0, 0], thighR: [0.15, 0, -0.08], shinR: [0.4, 0, 0], footR: [0.3, 0, 0] } },
  ],
};

const hover: ClipDef = {
  name: 'hover',
  duration: 2,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2);
    return {
      t,
      pose: {
        hipsY: 0,
        hips: [0.05, 0, 0],
        thighL: [-0.85 + s * 0.06, 0.08, 0.06],
        shinL: [1.15, 0, 0],
        footL: [0.45, 0, 0],
        thighR: [0.05 - s * 0.05, -0.05, -0.06],
        shinR: [0.35, 0, 0],
        footR: [0.55, 0, 0],
      },
    };
  }),
};

const dash: ClipDef = {
  name: 'dash',
  duration: 1,
  keys: [
    { t: 0, pose: { hipsY: -0.12, hips: [0.3, 0, 0], thighL: [-1.0, 0, 0.1], shinL: [1.2, 0, 0], footL: [0.2, 0, 0], thighR: [0.35, 0, -0.1], shinR: [0.9, 0, 0], footR: [0.5, 0, 0] } },
    { t: 1, pose: { hipsY: -0.12, hips: [0.3, 0, 0], thighL: [-1.0, 0, 0.1], shinL: [1.2, 0, 0], footL: [0.2, 0, 0], thighR: [0.35, 0, -0.1], shinR: [0.9, 0, 0], footR: [0.5, 0, 0] } },
  ],
};

const death: ClipDef = {
  name: 'death',
  duration: 1.4,
  keys: [
    { t: 0, pose: { hipsY: 0, hips: [0, 0, 0] } },
    { t: 0.3, pose: { hipsY: -0.38, hips: [0.25, 0, 0.1], thighL: [-0.7, 0, 0.1], shinL: [1.6, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [1.9, 0, 0], spine: [0.2, 0, 0] } },
    { t: 0.65, pose: { hipsY: -0.62, hips: [-0.6, 0.2, 0.3], thighL: [-0.9, 0, 0.2], shinL: [1.4, 0, 0], thighR: [-0.5, 0, -0.1], shinR: [1.5, 0, 0] } },
    { t: 1, pose: { hipsY: -0.82, hips: [-1.45, 0.25, 0.25], thighL: [-0.55, 0, 0.25], shinL: [0.9, 0, 0], footL: [0.4, 0, 0], thighR: [-0.25, 0, -0.15], shinR: [0.5, 0, 0], footR: [0.5, 0, 0] } },
  ],
};

// ---- Upper body ----

const upIdle: ClipDef = {
  name: 'upIdle',
  duration: 4,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2);
    return { t, pose: { spine: [0.02, 0.04, -0.02], chest: [0.0, 0.05, 0], neck: [0, -0.04, 0], head: [-0.02 + s * 0.01, -0.1, -0.09] } };
  }),
};

const upRun = gait('upRun', [
  { spine: [0.12, -0.1, 0], chest: [0.06, -0.1, 0], neck: [-0.08, 0.1, 0], head: [-0.06, 0.1, 0] },
  { spine: [0.13, -0.06, 0.02], chest: [0.07, -0.06, 0], neck: [-0.09, 0.06, 0], head: [-0.07, 0.06, 0] },
  { spine: [0.12, 0, 0.02], chest: [0.06, 0, 0], neck: [-0.08, 0, 0], head: [-0.06, 0, 0] },
  { spine: [0.11, 0.06, 0.01], chest: [0.05, 0.06, 0], neck: [-0.07, -0.06, 0], head: [-0.05, -0.06, 0] },
]);

const upSprint = gait('upSprint', [
  { spine: [0.3, -0.18, 0], chest: [0.12, -0.15, 0], neck: [-0.25, 0.18, 0], head: [-0.15, 0.12, 0], upperArmL: [0.75, 0, 0.18], foreArmL: [-1.4, 0, 0], handL: [0, 0, 0.2], fingersL: [0, 0, -1.2] },
  { spine: [0.31, -0.08, 0], chest: [0.12, -0.08, 0], neck: [-0.26, 0.1, 0], head: [-0.15, 0.06, 0], upperArmL: [0.2, 0, 0.18], foreArmL: [-1.5, 0, 0], handL: [0, 0, 0.2], fingersL: [0, 0, -1.2] },
  { spine: [0.3, 0.02, 0], chest: [0.12, 0.04, 0], neck: [-0.25, -0.02, 0], head: [-0.15, 0, 0], upperArmL: [-0.7, 0, 0.12], foreArmL: [-1.7, 0, 0], handL: [0, 0, 0.2], fingersL: [0, 0, -1.2] },
  { spine: [0.29, 0.1, 0], chest: [0.11, 0.1, 0], neck: [-0.24, -0.1, 0], head: [-0.14, -0.06, 0], upperArmL: [-0.2, 0, 0.15], foreArmL: [-1.6, 0, 0], handL: [0, 0, 0.2], fingersL: [0, 0, -1.2] },
]);

const upAim: ClipDef = {
  name: 'upAim',
  duration: 1,
  keys: [0, 1].map((t) => ({ t, pose: { spine: [0.04, 0.1, 0], chest: [0.02, 0.12, 0], neck: [0, -0.12, 0], head: [0.04, -0.08, -0.14] } })),
};

const upCrouch: ClipDef = {
  name: 'upCrouch',
  duration: 3,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2) * 0.01;
    return { t, pose: { spine: [0.32 + s, 0.05, 0], chest: [0.18, 0.05, 0], neck: [-0.25, 0, 0], head: [-0.15, -0.1, -0.05] } };
  }),
};

const upCoverHigh: ClipDef = {
  name: 'upCoverHigh',
  duration: 3,
  keys: [0, 0.5, 1].map((t) => {
    const s = Math.sin(t * Math.PI * 2) * 0.01;
    return { t, pose: { spine: [0.08 + s, 0.15, 0.04], chest: [0.06, 0.12, 0], neck: [0, -0.2, 0], head: [0, -0.25, 0] } };
  }),
};

/** Left arm off the gun, palm opening as the ka lifts. */
const castPull: ClipDef = {
  name: 'castPull',
  duration: 0.75,
  keys: [
    { t: 0, pose: { chest: [0, 0, 0] } },
    { t: 0.22, pose: { spine: [0.05, 0.12, 0], chest: [0, 0.22, 0], upperArmL: [-1.45, -0.1, 0.15], foreArmL: [-0.25, 0, 0], handL: [-0.4, -0.2, 0], fingersL: [0, 0, 0.25], thumbL: [0, 0, 0.3] } },
    { t: 0.5, pose: { spine: [-0.02, 0.15, 0], chest: [-0.05, 0.25, 0], upperArmL: [-1.95, -0.1, 0.2], foreArmL: [-0.45, 0, 0], handL: [-0.7, -0.2, 0], fingersL: [0, 0, 0.35], thumbL: [0, 0, 0.4] } },
    { t: 1, pose: { chest: [0, 0, 0] } },
  ],
};

/** Overhand throw with the left arm. */
const castThrow: ClipDef = {
  name: 'castThrow',
  duration: 0.65,
  keys: [
    { t: 0, pose: {} },
    { t: 0.2, pose: { spine: [-0.05, -0.25, 0], chest: [-0.05, -0.3, 0], upperArmL: [0.4, 0, 1.15], foreArmL: [-1.7, 0, 0], handL: [0.2, 0, 0], fingersL: [0, 0, -0.6] } },
    { t: 0.42, pose: { spine: [0.15, 0.3, 0], chest: [0.08, 0.35, 0], upperArmL: [-1.55, 0, 0.25], foreArmL: [-0.15, 0, 0], handL: [-0.3, 0, 0], fingersL: [0, 0, 0.2] } },
    { t: 1, pose: {} },
  ],
};

/** Ka-charged fist forward, leaning into the rush. */
const castCharge: ClipDef = {
  name: 'castCharge',
  duration: 0.55,
  keys: [
    { t: 0, pose: {} },
    { t: 0.25, pose: { spine: [0.32, 0.35, 0], chest: [0.15, 0.3, 0], neck: [-0.3, -0.3, 0], upperArmL: [-1.5, 0.1, 0.1], foreArmL: [-0.2, 0, 0], fingersL: [0, 0, -1.4], thumbL: [0, 0, -0.8] } },
    { t: 0.7, pose: { spine: [0.32, 0.35, 0], chest: [0.15, 0.3, 0], neck: [-0.3, -0.3, 0], upperArmL: [-1.5, 0.1, 0.1], foreArmL: [-0.2, 0, 0], fingersL: [0, 0, -1.4], thumbL: [0, 0, -0.8] } },
    { t: 1, pose: {} },
  ],
};

const hitReact: ClipDef = {
  name: 'hit',
  duration: 0.4,
  keys: [
    { t: 0, pose: {} },
    { t: 0.2, pose: { spine: [-0.18, 0.1, 0.08], chest: [-0.15, 0.12, 0.05], neck: [-0.1, 0, 0], head: [-0.2, 0.15, 0] } },
    { t: 1, pose: {} },
  ],
};

/** Rifle-butt / SMG-stock strike: twist, then whip across. */
const melee: ClipDef = {
  name: 'melee',
  duration: 0.5,
  keys: [
    { t: 0, pose: {} },
    { t: 0.2, pose: { spine: [0.05, 0.45, 0], chest: [0.05, 0.4, 0], head: [0, -0.4, 0] } },
    { t: 0.45, pose: { spine: [0.2, -0.45, 0], chest: [0.12, -0.45, 0], head: [0.05, 0.35, 0] } },
    { t: 1, pose: {} },
  ],
};

const upDeath: ClipDef = {
  name: 'upDeath',
  duration: 1.4,
  keys: [
    { t: 0, pose: {} },
    { t: 0.3, pose: { spine: [0.25, 0, 0], chest: [0.15, 0, 0], head: [0.3, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.8, 0, 0] } },
    { t: 1, pose: { spine: [-0.1, 0, 0.1], chest: [-0.1, 0, 0], neck: [-0.2, 0.3, 0], head: [-0.1, 0.5, 0], upperArmL: [0.2, 0, 1.3], upperArmR: [0.1, 0, -1.1], foreArmL: [-0.3, 0, 0], foreArmR: [-0.5, 0, 0], fingersL: [0, 0, -0.5], fingersR: [0, 0, 0.5] } },
  ],
};

/** Talking in dialogue close-ups: small head moves and a hand gesture. */
const upTalk: ClipDef = {
  name: 'upTalk',
  duration: 3,
  keys: [0, 0.33, 0.66, 1].map((t, i) => ({ t, pose: { spine: [0.02, 0.04, 0], chest: [0, 0.05, 0], neck: [0, [0, 0.06, -0.04, 0][i], 0], head: [[0, 0.04, -0.02, 0][i], [-0.06, 0, -0.08, -0.06][i], -0.08] } })),
};

export const LOWER_CLIPS = { idle, run, sprint, crouch, crouchWalk, air, hover, dash, death };
export const UPPER_CLIPS = { upIdle, upRun, upSprint, upAim, upCrouch, upCoverHigh, castPull, castThrow, castCharge, hitReact, melee, upDeath, upTalk };

export { lerpPose };
