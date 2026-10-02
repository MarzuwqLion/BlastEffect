import type { RigBuilder } from '../rigKit';

/**
 * Imani's skeleton in bind pose: standing, arms hanging, facing +Z.
 * Her left side is +X, right side is -X. Positions are relative to the
 * parent bone (metres). Height ~1.72 m before hair.
 */
export const BONES: [name: string, parent: string, x: number, y: number, z: number][] = [
  ['hips', 'root', 0, 0.97, 0],
  ['spine', 'hips', 0, 0.1, -0.01],
  ['chest', 'spine', 0, 0.18, 0],
  ['neck', 'chest', 0, 0.2, -0.005],
  ['head', 'neck', 0, 0.085, 0.01],
  ['jaw', 'head', 0, 0.01, 0.025],
  ['lidL', 'head', 0.032, 0.088, 0.0735],
  ['lidR', 'head', -0.032, 0.088, 0.0735],
  ['shoulderL', 'chest', 0.065, 0.15, 0],
  ['upperArmL', 'shoulderL', 0.115, 0, 0],
  ['foreArmL', 'upperArmL', 0, -0.275, 0],
  ['handL', 'foreArmL', 0, -0.245, 0],
  ['fingersL', 'handL', 0, -0.085, 0.005],
  ['thumbL', 'handL', -0.012, -0.03, 0.03],
  ['shoulderR', 'chest', -0.065, 0.15, 0],
  ['upperArmR', 'shoulderR', -0.115, 0, 0],
  ['foreArmR', 'upperArmR', 0, -0.275, 0],
  ['handR', 'foreArmR', 0, -0.245, 0],
  ['fingersR', 'handR', 0, -0.085, 0.005],
  ['thumbR', 'handR', 0.012, -0.03, 0.03],
  ['thighL', 'hips', 0.093, -0.06, 0],
  ['shinL', 'thighL', 0, -0.43, 0],
  ['footL', 'shinL', 0, -0.42, 0],
  ['toeL', 'footL', 0, -0.045, 0.125],
  ['thighR', 'hips', -0.093, -0.06, 0],
  ['shinR', 'thighR', 0, -0.43, 0],
  ['footR', 'shinR', 0, -0.42, 0],
  ['toeR', 'footR', 0, -0.045, 0.125],
];

/** Bones the lower-body animation layer owns. */
export const LOWER = new Set(['hips', 'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR']);

export function addBones(rig: RigBuilder): void {
  for (const [name, parent, x, y, z] of BONES) rig.bone(name, parent, x, y, z);
}

/** Height of the ankle joint above the sole in bind pose. */
export const ANKLE_HEIGHT = 0.06;
