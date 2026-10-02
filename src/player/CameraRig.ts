import * as THREE from 'three';
import { CONFIG, DEG } from '../config';
import { MASK, makeRayHit, type Physics } from '../core/Physics';

const C = CONFIG.camera;

/**
 * Over-the-shoulder camera. Two sphere sweeps keep it out of walls: pivot →
 * shoulder, then shoulder → back along the view. Aiming tightens distance
 * and FOV; the shoulder side can be swapped. Trauma-based shake and FOV
 * kicks are layered on top. A dialogue mode frames a scripted shot.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.08;
  side = 1;
  private sideT = 1;
  private aimT = 0;
  private scopeT = 0;
  private sprintT = 0;
  private pivotY = 0;
  private dist = C.distance;
  private crouchT = 0;
  private trauma = 0;
  private fovKick = 0;
  private shakeTime = 0;
  /** Recoil offsets that recover over time (radians). */
  recoilPitch = 0;
  recoilYaw = 0;
  private recoilRecovery = 8;

  mode: 'gameplay' | 'dialogue' | 'free' = 'gameplay';
  private readonly dialoguePos = new THREE.Vector3();
  private readonly dialogueLook = new THREE.Vector3();
  private readonly curLook = new THREE.Vector3();
  private dialogueBlend = 0;

  readonly pivot = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  /** Camera position before shake, used for aiming rays. */
  readonly aimOrigin = new THREE.Vector3();
  readonly aimDir = new THREE.Vector3(0, 0, -1);

  private readonly hit = makeRayHit();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly baseQuat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private readonly physics: Physics) {
    this.camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.05, 170);
  }

  setRecoilRecovery(r: number): void {
    this.recoilRecovery = r;
  }

  addRecoil(pitchDeg: number, yawDeg: number): void {
    this.recoilPitch += pitchDeg * DEG;
    this.recoilYaw += yawDeg * DEG;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kickFov(deg: number): void {
    this.fovKick = Math.max(this.fovKick, deg);
  }

  swapShoulder(): void {
    this.side = -this.side;
  }

  look(dyaw: number, dpitch: number): void {
    this.yaw -= dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, C.pitchMinDeg * DEG, C.pitchMaxDeg * DEG);
  }

  /** Snap behind the player instantly (respawn, teleports). */
  snap(feet: THREE.Vector3, yaw: number, pitch = -0.08): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.pivotY = feet.y + C.pivotHeight;
    this.dist = C.distance;
    this.aimT = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.trauma = 0;
  }

  /** Point the dialogue camera at `look` from `pos`. */
  frame(pos: THREE.Vector3, look: THREE.Vector3, instant = false): void {
    this.dialoguePos.copy(pos);
    this.dialogueLook.copy(look);
    if (this.mode !== 'dialogue') {
      this.mode = 'dialogue';
      this.curLook.copy(this.camera.position).addScaledVector(this.aimDir, 5);
      if (instant) this.dialogueBlend = 1;
    }
    if (instant) {
      this.camera.position.copy(pos);
      this.curLook.copy(look);
    }
  }

  endDialogue(): void {
    this.mode = 'gameplay';
  }

  update(
    dt: number,
    feet: THREE.Vector3,
    opts: { aiming: boolean; scoped: boolean; sprinting: boolean; crouched: boolean; },
  ): void {
    const aimTarget = opts.aiming ? 1 : 0;
    this.aimT += (aimTarget - this.aimT) * Math.min(1, dt * C.aimLerp);
    this.scopeT += ((opts.scoped ? 1 : 0) - this.scopeT) * Math.min(1, dt * C.aimLerp);
    this.sprintT += ((opts.sprinting ? 1 : 0) - this.sprintT) * Math.min(1, dt * 4);
    this.sideT += (this.side - this.sideT) * Math.min(1, dt * C.shoulderLerp);
    this.crouchT += ((opts.crouched && !opts.aiming ? 1 : 0) - this.crouchT) * Math.min(1, dt * 8);

    // Recoil recovers toward zero; the visible offset is added to pitch/yaw.
    const rec = Math.min(1, dt * this.recoilRecovery);
    this.recoilPitch -= this.recoilPitch * rec;
    this.recoilYaw -= this.recoilYaw * rec;

    const pitch = THREE.MathUtils.clamp(this.pitch + this.recoilPitch, C.pitchMinDeg * DEG, C.pitchMaxDeg * DEG);
    const yaw = this.yaw + this.recoilYaw;

    const pivotH = THREE.MathUtils.lerp(C.pivotHeight, C.crouchPivotHeight, this.crouchT);
    const targetY = feet.y + pivotH;
    this.pivotY += (targetY - this.pivotY) * Math.min(1, dt * C.pivotYFollow);
    if (Math.abs(targetY - this.pivotY) > 2.5) this.pivotY = targetY;
    this.pivot.set(feet.x, this.pivotY, feet.z);

    const cp = Math.cos(pitch);
    this.forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const shoulderX = THREE.MathUtils.lerp(C.shoulder, C.aimShoulder, this.aimT) * this.sideT;
    const distance = THREE.MathUtils.lerp(C.distance, C.aimDistance, this.aimT) * (1 - this.scopeT * 0.25);

    // Sweep 1: pivot → shoulder.
    this.tmp.copy(this.right).multiplyScalar(shoulderX);
    this.tmp.y = THREE.MathUtils.lerp(C.verticalOffset, C.aimVerticalOffset, this.aimT);
    const sLen = this.tmp.length();
    this.tmp.divideScalar(sLen);
    const sHit = this.physics.sphereCast(this.pivot, this.tmp, C.collisionRadius, sLen, MASK.world);
    this.shoulder.copy(this.pivot).addScaledVector(this.tmp, Math.max(0, sHit - 0.02));

    // Sweep 2: shoulder → back along the view direction.
    this.tmp2.copy(this.forward).negate();
    const bHit = this.physics.sphereCast(this.shoulder, this.tmp2, C.collisionRadius, distance, MASK.world, this.hit);
    const allowed = Math.max(0.15, bHit - 0.03);
    if (allowed < this.dist) this.dist = allowed;
    else this.dist += (Math.min(allowed, distance) - this.dist) * Math.min(1, dt * C.distanceRecover);
    if (this.dist > distance) this.dist = distance;

    const gameplayPos = this.tmp.copy(this.shoulder).addScaledVector(this.forward, -this.dist);
    this.aimOrigin.copy(gameplayPos);
    this.aimDir.copy(this.forward);

    // FOV.
    let fov = THREE.MathUtils.lerp(C.fov, C.aimFov, this.aimT);
    fov = THREE.MathUtils.lerp(fov, C.scopeFov, this.scopeT);
    fov += (C.sprintFov - C.fov) * this.sprintT * (1 - this.aimT);
    this.fovKick = Math.max(0, this.fovKick - this.fovKick * Math.min(1, dt * C.fovKickDecay) - dt);
    fov += this.fovKick;

    this.euler.set(pitch, yaw, 0, 'YXZ');
    this.baseQuat.setFromEuler(this.euler);

    if (this.mode === 'dialogue') {
      this.dialogueBlend = Math.min(1, this.dialogueBlend + dt * 1.6);
      const k = Math.min(1, dt * C.dialogueLerp);
      this.camera.position.lerp(this.dialoguePos, this.dialogueBlend >= 1 ? k : k * 0.7);
      this.curLook.lerp(this.dialogueLook, k);
      this.camera.lookAt(this.curLook);
      this.camera.fov += (40 - this.camera.fov) * k;
    } else {
      if (this.dialogueBlend > 0) {
        this.dialogueBlend = Math.max(0, this.dialogueBlend - dt * 2.5);
      }
      this.camera.position.copy(gameplayPos);
      if (this.dialogueBlend > 0) {
        // Ease back from the dialogue framing.
        this.camera.position.lerp(this.dialoguePos, this.dialogueBlend * this.dialogueBlend);
      }
      this.camera.quaternion.copy(this.baseQuat);
      this.camera.fov = fov;
    }

    // Shake (trauma²), applied as small rotations and offsets.
    this.trauma = Math.max(0, this.trauma - dt * C.shakeDecay);
    if (this.trauma > 0) {
      this.shakeTime += dt * 28;
      const s = this.trauma * this.trauma;
      const t = this.shakeTime;
      const ax = (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7) * 0.5) * 0.66;
      const ay = (Math.sin(t * 1.3 + 4.1) + Math.sin(t * 2.9 + 0.3) * 0.5) * 0.66;
      const az = Math.sin(t * 0.9 + 2.2);
      this.euler.set(ax * s * C.shakeMaxAngleDeg * DEG, ay * s * C.shakeMaxAngleDeg * DEG, az * s * C.shakeMaxAngleDeg * DEG * 0.6, 'YXZ');
      _q.setFromEuler(this.euler);
      this.camera.quaternion.multiply(_q);
      this.camera.position.addScaledVector(this.right, ay * s * C.shakeMaxOffset);
      this.camera.position.y += ax * s * C.shakeMaxOffset;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** 0..1 how far into aim the camera is. */
  get aimAmount(): number {
    return this.aimT;
  }

  get distanceNow(): number {
    return this.dist;
  }
}

const _q = new THREE.Quaternion();
