import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _end = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _k = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/**
 * Analytic two-bone IK for limbs that extend along the bone's local -Y in
 * bind pose (arms and legs). Sets the upper and lower bones' local
 * quaternions so the end joint reaches `target`, bending toward `pole`.
 * `bendSign` is -1 for arms (elbow flexes about -X) and +1 for legs (knee
 * flexes about +X). Returns how far short of the target the chain ended.
 */
export function solveTwoBone(
  upper: THREE.Bone,
  lower: THREE.Bone,
  end: THREE.Bone,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  bendSign: 1 | -1,
): number {
  upper.updateWorldMatrix(true, true);
  _a.setFromMatrixPosition(upper.matrixWorld);
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _dir.copy(target).sub(_a);
  const rawD = _dir.length();
  const d = THREE.MathUtils.clamp(rawD, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _dir.divideScalar(rawD || 1);
  // Bend plane: toward the pole, perpendicular to the reach direction.
  _n.copy(pole).sub(_a);
  _n.addScaledVector(_dir, -_n.dot(_dir));
  if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _n.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _elbow.copy(_a).addScaledVector(_dir, l1 * cosA).addScaledVector(_n, l1 * sinA);
  _end.copy(_a).addScaledVector(_dir, d);
  _u.copy(_elbow).sub(_a).normalize();
  _f.copy(_end).sub(_elbow).normalize();
  _k.crossVectors(_u, _f);
  if (_k.lengthSq() < 1e-10) _k.crossVectors(_u, _n);
  _k.normalize().multiplyScalar(bendSign);
  orient(upper, _u, _k);
  upper.updateWorldMatrix(false, true);
  orient(lower, _f, _k);
  lower.updateWorldMatrix(false, true);
  return Math.max(0, rawD - (l1 + l2));
}

/** Point the bone's local -Y along `down`, with local X along `xAxis`. */
function orient(bone: THREE.Object3D, down: THREE.Vector3, xAxis: THREE.Vector3): void {
  _y.copy(down).negate();
  _x.copy(xAxis).addScaledVector(_y, -xAxis.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  setWorldQuaternion(bone, _q);
}

/** Set a bone's world rotation (converted to local). */
export function setWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(q));
}
