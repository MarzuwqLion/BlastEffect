import * as THREE from 'three';
import { CONFIG, DEG } from '../config';
import { settings } from '../core/settings';
import type { Game } from '../game/Game';
import type { Enemy } from '../enemies/Enemy';

const A = CONFIG.input.aimAssist;
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Mild gamepad aim assist: the stick slows down while the crosshair is over
 * an enemy, and while aiming the view follows a tracked target slightly.
 * Never snaps. Disabled for mouse and when turned off in settings.
 */
export class AimAssist {
  private target: Enemy | null = null;
  private readonly lastTargetPos = new THREE.Vector3();
  enabled = A.enabled;

  constructor(private readonly game: Game) {}

  apply(dt: number): void {
    const input = this.game.input;
    const rig = this.game.rig;
    if (input.device !== 'gamepad' || !settings.value.aimAssist) {
      this.target = null;
      return;
    }
    const e = this.game.enemies.findTargetInCone(rig.aimOrigin, rig.aimDir, A.slowdownConeDeg, A.maxRange, _p);
    if (!e) {
      this.target = null;
      return;
    }
    // Slowdown: undo part of this frame's stick look.
    const s = A.slowdownScale;
    const stickActive = input.stick.x !== 0 || input.stick.y !== 0;
    if (stickActive) rig.look(-input.look.yaw * (1 - s), -input.look.pitch * (1 - s));
    // Magnetism: follow the target's motion while aiming or firing.
    const engaged = input.isHeld('aim') || input.isHeld('fire');
    if (engaged && this.target === e) {
      _d.copy(_p).sub(rig.aimOrigin).normalize();
      const wantYaw = Math.atan2(-_d.x, -_d.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1));
      let dy = wantYaw - rig.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const dp = wantPitch - rig.pitch;
      const k = Math.min(1, A.magnetism * dt);
      // Only pull a little, and only within the cone.
      if (Math.abs(dy) < A.slowdownConeDeg * DEG * 2) rig.yaw += dy * k;
      if (Math.abs(dp) < A.slowdownConeDeg * DEG * 2) rig.pitch += dp * k;
    }
    this.target = e;
    this.lastTargetPos.copy(_p);
  }
}
