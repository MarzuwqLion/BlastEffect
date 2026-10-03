import * as THREE from 'three';
import { CONFIG, DEG } from '../config';
import { G, groups, MASK, RAPIER } from '../core/Physics';
import { makeContact, type CoverContact } from '../level/cover';
import { makeAvatarState, type AvatarState } from '../character/types';
import type { Game } from '../game/Game';
import { Weapons } from './Weapons';
import { Powers } from './Powers';

const P = CONFIG.player;
const CV = CONFIG.cover;

type CoverMode = 'none' | 'in';

/**
 * The player: Rapier kinematic character controller, movement (run, sprint,
 * jump-jet, hover, dash), automatic cover, defenses, and the hooks weapons
 * and powers drive (charge, melee lunge).
 */
export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  private wasGrounded = true;
  airTime = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  hoverFuel = P.hoverDuration;
  hovering = false;
  private jumpHeldSinceJump = false;

  dashT = 0;
  dashCooldown = 0;
  private readonly dashDir = new THREE.Vector3();
  private dashGraceT = 0;

  sprinting = false;
  private sprintToggle = false;
  aiming = false;
  scoped = false;

  health = P.healthMax;
  shield = P.shieldMax;
  private shieldDelay = 0;
  alive = true;
  god = false;
  /** Seconds since last damage, for HUD feedback. */
  lastHitAgo = 99;

  /** Set by the director while enemies are engaged. */
  combatActive = false;
  private weaponOutT = 0;

  coverMode: CoverMode = 'none';
  readonly cover: CoverContact = makeContact();
  private readonly probeContact: CoverContact = makeContact();
  private coverEnterT = 0;
  coverOut = 0;
  private coverPeekSign = 0;
  private coverHomeAlong = 0;
  crouched = false;

  /** Charge (Powers) drives movement while active. */
  charging = false;
  private readonly chargeTarget = new THREE.Vector3();
  private chargeT = 0;
  private chargeDone: ((arrived: boolean) => void) | null = null;

  private lungeT = 0;
  private readonly lungeDir = new THREE.Vector3();
  private readonly knock = new THREE.Vector3();

  /** Seconds to keep facing the aim direction after firing or casting. */
  private faceAimT = 0;
  inputLocked = false;

  readonly weapons: Weapons;
  readonly powers: Powers;
  readonly anim: AvatarState = makeAvatarState();

  private readonly wish = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly desired = { x: 0, y: 0, z: 0 };

  constructor(private readonly game: Game) {
    const world = game.physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, P.halfHeight + P.radius, 0));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(P.halfHeight, P.radius).setCollisionGroups(groups(G.PLAYER, G.WORLD | G.ENEMY | G.QUERY)),
      this.body,
    );
    game.physics.tag(this.collider, { kind: 'player' });
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle(P.maxSlopeDeg * DEG);
    this.controller.setMinSlopeSlideAngle(60 * DEG);
    this.controller.enableAutostep(P.stepHeight, 0.2, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setSlideEnabled(true);
    this.weapons = new Weapons(game, this);
    this.powers = new Powers(game, this);
  }

  get weaponOut(): boolean {
    return this.combatActive || this.weaponOutT > 0;
  }

  /** Height of the hurt capsule (crouched behind low cover is shorter). */
  get hurtHeight(): number {
    return this.crouched ? P.crouchHeight : P.standHeight;
  }

  get inCover(): boolean {
    return this.coverMode === 'in';
  }

  spawn(pos: THREE.Vector3, yaw: number): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.health = P.healthMax;
    this.shield = P.shieldMax;
    this.shieldDelay = 0;
    this.alive = true;
    this.coverMode = 'none';
    this.crouched = false;
    this.charging = false;
    this.chargeDone = null;
    this.dashT = 0;
    this.dashCooldown = 0;
    this.hovering = false;
    this.hoverFuel = P.hoverDuration;
    this.lungeT = 0;
    this.knock.set(0, 0, 0);
    this.weaponOutT = 0;
    this.body.setTranslation({ x: pos.x, y: pos.y + P.halfHeight + P.radius, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + P.halfHeight + P.radius, z: pos.z });
    this.weapons.resetForSpawn();
    this.powers.reset();
    this.game.avatar.trigger({ type: 'revive' });
  }

  /** Teleport without resetting state (debug). */
  teleport(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.body.setTranslation({ x: pos.x, y: pos.y + P.halfHeight + P.radius, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + P.halfHeight + P.radius, z: pos.z });
  }

  /** Chest-height point for enemies to aim at. */
  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.hurtHeight * 0.72, this.position.z);
  }

  update(dt: number): void {
    const input = this.game.input;
    const rig = this.game.rig;
    const locked = this.inputLocked || !this.alive;

    this.lastHitAgo += dt;
    this.faceAimT = Math.max(0, this.faceAimT - dt);
    this.weaponOutT = Math.max(0, this.weaponOutT - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashGraceT = Math.max(0, this.dashGraceT - dt);

    // Defenses: shield regenerates after a delay without damage.
    if (this.alive) {
      if (this.shieldDelay > 0) this.shieldDelay -= dt;
      else if (this.shield < P.shieldMax) this.shield = Math.min(P.shieldMax, this.shield + P.shieldRegenRate * dt);
    }

    // Camera look.
    if (!locked) {
      input.aimingScale = this.aiming ? (this.scoped ? 0.45 : 0.7) : 1;
      rig.look(input.look.yaw, input.look.pitch);
      this.game.aimAssist.apply(dt);
    }

    // Wish direction from input, relative to the camera.
    const mx = locked ? 0 : input.move.x;
    const my = locked ? 0 : input.move.y;
    const cy = Math.cos(rig.yaw);
    const sy = Math.sin(rig.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    this.wish.set(cy * mx - sy * my, 0, -sy * mx - cy * my);
    const wishLen = Math.min(1, this.wish.length());
    if (wishLen > 1e-3) this.wish.divideScalar(Math.max(1, this.wish.length()));

    // Aim / sprint.
    const wantAim = !locked && input.isHeld('aim');
    this.aiming = wantAim && !this.charging;
    this.scoped = this.aiming && this.weapons.current === 'rifle';
    if (this.aiming) this.weaponOutT = Math.max(this.weaponOutT, P.weaponOutTime);

    if (!locked && input.pressed('sprint') && input.device === 'gamepad') this.sprintToggle = !this.sprintToggle;
    if (wishLen < 0.2) this.sprintToggle = false;
    const sprintHeld = !locked && (input.device === 'gamepad' ? this.sprintToggle : input.isHeld('sprint'));
    this.sprinting = sprintHeld && wishLen > 0.2 && !this.aiming && !this.weapons.firingRecently && this.coverMode === 'none' && !this.charging;

    // Weapons and powers read input inside their own updates.
    if (!locked) {
      if (input.pressed('swapShoulder')) rig.swapShoulder();
    }

    if (this.charging) {
      this.updateCharge(dt);
    } else {
      this.updateMovement(dt, locked, wishLen);
    }

    this.weapons.update(dt, locked);
    this.powers.update(dt, locked);

    if (this.weapons.firingRecently || this.powers.castingRecently) {
      this.faceAimT = 0.5;
      this.weaponOutT = Math.max(this.weaponOutT, P.weaponOutTime);
      if (this.sprinting) this.sprinting = false;
    }

    this.updateFacing(dt, wishLen);
    this.updateAnimState();
  }

  private updateMovement(dt: number, locked: boolean, wishLen: number): void {
    const input = this.game.input;
    const g = CONFIG.physics.gravity;

    // Cover first: it can override the wish direction.
    this.updateCover(dt, locked, wishLen);

    // Jump buffer / coyote time.
    if (!locked && input.pressed('jump')) {
      this.jumpBuffer = P.jumpBuffer;
      if (!this.grounded && this.coyote <= 0) this.jumpHeldSinceJump = true;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt);

    // Dash.
    if (!locked && input.pressed('dash') && this.dashCooldown <= 0 && this.dashT <= 0) {
      if (wishLen > 0.2) this.dashDir.copy(this.wish).normalize();
      else this.dashDir.set(-Math.sin(this.game.rig.yaw), 0, -Math.cos(this.game.rig.yaw));
      this.dashT = P.dashDuration;
      this.dashCooldown = P.dashCooldown;
      this.dashGraceT = P.dashGrace;
      this.exitCover();
      this.game.rig.kickFov(CONFIG.camera.dashFovKick);
      this.game.fx.dash(this.position, this.dashDir);
      this.game.audio.play('dash', { at: this.position });
      this.game.input.rumble(0.25, 0.12);
    }

    let speed = P.runSpeed;
    if (this.aiming) speed = P.aimSpeed;
    else if (this.sprinting) speed = P.sprintSpeed;
    if (this.coverMode === 'in') speed = P.coverSpeed;

    const v = this.velocity;
    if (this.dashT > 0) {
      this.dashT -= dt;
      const dashSpeed = P.dashDistance / P.dashDuration;
      v.x = this.dashDir.x * dashSpeed;
      v.z = this.dashDir.z * dashSpeed;
      v.y = Math.max(v.y, 0);
      if (this.dashT <= 0) {
        // Bleed out of the dash into run speed.
        const h = Math.hypot(v.x, v.z);
        if (h > P.runSpeed) {
          v.x *= P.runSpeed / h;
          v.z *= P.runSpeed / h;
        }
      }
    } else {
      const tx = this.wish.x * speed;
      const tz = this.wish.z * speed;
      const accel = this.grounded ? (wishLen > 0.05 ? P.groundAccel : P.groundDecel) : P.airAccel;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const dl = Math.hypot(dx, dz);
      const maxDv = accel * dt;
      if (dl <= maxDv) {
        v.x = tx;
        v.z = tz;
      } else {
        v.x += (dx / dl) * maxDv;
        v.z += (dz / dl) * maxDv;
      }

      // Jump-jet jump.
      if (this.jumpBuffer > 0 && this.coyote > 0 && !locked) {
        v.y = Math.sqrt(2 * g * P.jumpHeight);
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpHeldSinceJump = true;
        this.exitCover();
        this.game.fx.jumpJet(this, 1);
        this.game.audio.play('jump', { at: this.position });
        this.game.avatar.trigger({ type: 'jump' });
      }

      // Gravity and hover.
      const jumpHeld = !locked && this.game.input.isHeld('jump');
      if (!jumpHeld) this.jumpHeldSinceJump = false;
      const wantsHover = !this.grounded && !locked && (this.aiming || (jumpHeld && this.jumpHeldSinceJump && v.y < 1.5));
      this.hovering = wantsHover && this.hoverFuel > 0;
      if (this.hovering) {
        this.hoverFuel -= dt;
        // Damp toward a slow drift down.
        const target = -P.hoverFallSpeed;
        if (v.y > target) v.y = Math.max(target, v.y - g * 0.35 * dt - v.y * P.hoverRiseDamp * dt);
        else v.y += (target - v.y) * Math.min(1, dt * 10);
      } else {
        v.y -= g * dt;
      }
      if (v.y < -P.terminalVelocity) v.y = -P.terminalVelocity;
    }

    // Knockback from hits, and melee lunge.
    if (this.knock.lengthSq() > 0.01) {
      v.x += this.knock.x;
      v.z += this.knock.z;
      v.y += this.knock.y;
      this.knock.set(0, 0, 0);
    }
    if (this.lungeT > 0) {
      this.lungeT -= dt;
      v.x = this.lungeDir.x * P.melee.lungeSpeed;
      v.z = this.lungeDir.z * P.melee.lungeSpeed;
    }

    this.move(dt);

    if (this.grounded && !this.wasGrounded) {
      this.hoverFuel = P.hoverDuration;
      const impact = Math.min(1, Math.max(0, (-this.lastVy - 4) / 14));
      this.game.avatar.trigger({ type: 'land', impact });
      if (impact > 0.15) {
        this.game.audio.play('land', { at: this.position, volume: 0.4 + impact * 0.6 });
        this.game.rig.addShake(impact * 0.18);
      }
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // Footsteps: one per stride, longer strides when sprinting.
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && this.alive && sp > 0.8 && this.dashT <= 0) {
      this.stepAcc += sp * dt;
      const stride = sp > 7 ? 1.75 : sp > 4.8 ? 1.4 : 1.0;
      if (this.stepAcc >= stride) {
        this.stepAcc -= stride;
        this.game.audio.play('footstep', { volume: Math.min(1, 0.35 + sp / 10), rate: sp > 7 ? 1.05 : 1 });
      }
    } else if (this.grounded) {
      this.stepAcc = 0.6;
    }
  }

  private lastVy = 0;
  private stepAcc = 0;

  /** Runs the character controller with the current velocity. */
  private move(dt: number): void {
    const v = this.velocity;
    this.lastVy = v.y;
    this.desired.x = v.x * dt;
    this.desired.y = v.y * dt;
    this.desired.z = v.z * dt;
    this.controller.computeColliderMovement(this.collider, this.desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, MASK.playerMove);
    const m = this.controller.computedMovement();
    this.wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    if (dt > 0) {
      // Blocked vertically: kill velocity into the obstacle.
      if (this.grounded && v.y < 0) v.y = -1;
      if (!this.grounded && v.y > 0 && m.y < this.desired.y * 0.5) v.y = 0;
      // Blocked horizontally: keep the slide result as velocity (prevents wall
      // sticking). Not while climbing a slope or step: there the controller
      // trades some horizontal distance for height, which is not a wall.
      const climbing = this.grounded && m.y > 0.002;
      if (this.dashT <= 0 && !this.charging && !climbing) {
        const ax = m.x / dt;
        const az = m.z / dt;
        if (Math.abs(ax) < Math.abs(v.x) - 0.5) v.x = ax;
        if (Math.abs(az) < Math.abs(v.z) - 0.5) v.z = az;
      }
    }
    // Safety net: fell out of the world.
    if (this.position.y < -30) this.game.director.respawnFromCheckpoint();
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + P.halfHeight + P.radius,
      z: this.position.z,
    });
  }

  private updateCover(dt: number, locked: boolean, wishLen: number): void {
    const cover = this.game.cover;
    const canCover = this.weaponOut && this.grounded && this.dashT <= 0 && !locked && this.alive && !this.charging;

    if (this.coverMode === 'none') {
      this.crouched = false;
      this.coverOut += (0 - this.coverOut) * Math.min(1, dt * 10);
      if (!canCover) {
        this.coverEnterT = 0;
        return;
      }
      const c = cover.probe(this.position, P.radius, CV.snapDistance, this.probeContact);
      if (!c) {
        this.coverEnterT = 0;
        return;
      }
      const into = -(this.wish.x * c.normal.x + this.wish.z * c.normal.z);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const facing = -(fx * c.normal.x + fz * c.normal.z);
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const pushing = wishLen > 0.3 && into > 0.55;
      const settled = wishLen < 0.1 && speed < 0.8 && facing > 0.6 && !this.aiming && c.gap < 0.35;
      if (pushing || settled) {
        this.coverEnterT += dt;
        if (this.coverEnterT >= CV.enterDelay) this.enterCover(c);
      } else {
        this.coverEnterT = 0;
      }
      return;
    }

    // In cover.
    if (!canCover && this.dashT <= 0 && (!this.weaponOut || !this.grounded)) {
      this.exitCover();
      return;
    }
    const c = cover.probe(this.position, P.radius, CV.snapDistance + 0.6 + this.coverOut * 1.2, this.probeContact);
    if (!c || c.box !== this.cover.box) {
      if (this.coverOut < 0.2) {
        this.exitCover();
        return;
      }
    } else {
      copyContact(c, this.cover);
    }
    const n = this.cover.normal;
    const t = this.cover.tangent;
    const away = this.wish.x * n.x + this.wish.z * n.z;
    if (wishLen > 0.3 && away > CV.releaseDot && !this.aiming) {
      this.exitCover();
      return;
    }

    const low = this.cover.kind === 'low';
    let wantOut = this.aiming ? 1 : 0;
    // High cover can only be shot from at a corner.
    const edgeRoom = this.cover.halfLength - Math.abs(this.cover.along);
    if (!low && this.aiming && this.coverPeekSign === 0) {
      if (edgeRoom < CV.edgePeekDistance) {
        this.coverPeekSign = Math.sign(this.cover.along) || 1;
        this.coverHomeAlong = this.cover.along;
      } else {
        wantOut = 0.4; // step back from the wall a little
      }
    }
    if (!this.aiming && this.coverPeekSign !== 0 && this.coverOut < 0.05) this.coverPeekSign = 0;
    this.coverOut += (wantOut - this.coverOut) * Math.min(1, dt * 9);
    this.crouched = low && this.coverOut < 0.5;

    // Movement along the face, pressed lightly into it.
    const along = this.wish.x * t.x + this.wish.z * t.z;
    let vx = t.x * along * P.coverSpeed;
    let vz = t.z * along * P.coverSpeed;
    if (this.aiming) {
      vx *= 0.6;
      vz *= 0.6;
    }
    let targetGap: number = CV.gap + (low ? 0 : this.coverOut * 0.25);
    if (this.coverPeekSign !== 0) {
      // Step out past the corner while aiming, back home when released.
      const targetAlong = this.aiming
        ? this.coverPeekSign * (this.cover.halfLength + P.radius * 0.5 + CV.peekStepOut * 0.5)
        : this.coverHomeAlong;
      const err = targetAlong - this.cover.along;
      const corr = THREE.MathUtils.clamp(err * 8, -6, 6);
      vx += t.x * corr;
      vz += t.z * corr;
      targetGap = CV.gap + 0.25 + this.coverOut * 0.2;
    } else if (Math.abs(this.cover.along) > this.cover.halfLength + P.radius * 0.4) {
      // Slid off the end of the cover.
      this.exitCover();
      return;
    }
    const gapErr = this.cover.gap - targetGap;
    vx -= n.x * THREE.MathUtils.clamp(gapErr * 10, -3, 3);
    vz -= n.z * THREE.MathUtils.clamp(gapErr * 10, -3, 3);
    // Overwrite the wish so the movement code steers to the cover velocity.
    const len = Math.hypot(vx, vz);
    const sp = P.coverSpeed;
    this.wish.set(vx / sp, 0, vz / sp);
    if (len > sp) this.wish.multiplyScalar(sp / len);
  }

  private enterCover(c: CoverContact): void {
    copyContact(c, this.cover);
    this.coverMode = 'in';
    this.coverEnterT = 0;
    this.coverOut = 0;
    this.coverPeekSign = 0;
    this.velocity.x *= 0.2;
    this.velocity.z *= 0.2;
    this.game.audio.play('coverIn', { at: this.position, volume: 0.6 });
    this.game.events.emit('coverEnter');
  }

  exitCover(): void {
    if (this.coverMode === 'none') return;
    this.coverMode = 'none';
    this.crouched = false;
    this.coverPeekSign = 0;
  }

  private updateFacing(dt: number, wishLen: number): void {
    const rig = this.game.rig;
    let target = this.yaw;
    let rate = P.turnSpeed;
    if (this.aiming || this.faceAimT > 0 || (this.weaponOut && this.weapons.isFiring)) {
      target = rig.yaw;
      rate = 30;
    } else if (this.coverMode === 'in') {
      target = Math.atan2(this.cover.normal.x, this.cover.normal.z);
      rate = 12;
    } else if (this.dashT > 0) {
      if (!this.weaponOut) target = Math.atan2(-this.dashDir.x, -this.dashDir.z);
    } else if (wishLen > 0.1) {
      const h = Math.hypot(this.velocity.x, this.velocity.z);
      if (h > 0.5) target = Math.atan2(-this.velocity.x, -this.velocity.z);
      if (this.weaponOut && !this.sprinting) {
        // In combat, keep the body roughly toward the camera and strafe.
        target = rig.yaw;
        rate = 10;
      }
    } else if (this.weaponOut) {
      const diff = angleDiff(rig.yaw, this.yaw);
      if (Math.abs(diff) > 75 * DEG) {
        target = rig.yaw;
        rate = 6;
      }
    }
    const d = angleDiff(target, this.yaw);
    this.yaw += d * Math.min(1, dt * rate);
  }

  private updateAnimState(): void {
    const a = this.anim;
    const v = this.velocity;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // Body forward = (-s, 0, -c), right = (c, 0, -s).
    a.localVelZ = -v.x * s - v.z * c;
    a.localVelX = v.x * c - v.z * s;
    a.speed = Math.hypot(v.x, v.z);
    a.vy = v.y;
    a.grounded = this.grounded;
    a.sprinting = this.sprinting;
    a.aiming = this.aiming;
    a.scoped = this.scoped;
    a.hovering = this.hovering;
    a.dashing = this.dashT > 0;
    a.dashLocalZ = -this.dashDir.x * s - this.dashDir.z * c;
    a.dashLocalX = this.dashDir.x * c - this.dashDir.z * s;
    a.charging = this.charging;
    a.cover = this.coverMode === 'in' ? this.cover.kind : 'none';
    a.coverOut = this.coverOut;
    a.weapon = this.weapons.current;
    a.weaponOut = this.weaponOut;
    a.aimPitch = this.game.rig.pitch;
    a.aimYawOffset = angleDiff(this.game.rig.yaw, this.yaw);
    a.reloading = this.weapons.isReloading;
    a.reloadT = this.weapons.reloadProgress;
    a.swapping = this.weapons.isSwapping;
    a.firing = this.weapons.isFiring;
    a.alive = this.alive;
    a.hurt = 1 - (this.health + this.shield) / (P.healthMax + P.shieldMax);
    a.airTime = this.airTime;
    a.ammo = this.weapons.state.mag;
    a.yaw = this.yaw;
  }

  // ---- Charge (driven by Powers) ----

  startCharge(target: THREE.Vector3, done: (arrived: boolean) => void): void {
    this.exitCover();
    this.charging = true;
    this.chargeT = 0;
    this.chargeTarget.copy(target);
    this.chargeDone = done;
    this.dashT = 0;
    this.hovering = false;
  }

  updateChargeTarget(target: THREE.Vector3): void {
    this.chargeTarget.copy(target);
  }

  private updateCharge(dt: number): void {
    const cfg = CONFIG.powers.charge;
    this.chargeT += dt;
    this.tmp.copy(this.chargeTarget).sub(this.position);
    const dist = this.tmp.length();
    const stopDist = 1.3;
    let arrived = false;
    if (dist <= stopDist + 0.05) {
      arrived = true;
    } else {
      this.tmp.divideScalar(dist);
      const step = Math.min(cfg.speed * dt, dist - stopDist);
      this.velocity.copy(this.tmp).multiplyScalar(step / Math.max(dt, 1e-4));
      const before = this.tmp2.copy(this.position);
      this.move(dt);
      const moved = before.distanceTo(this.position);
      if (moved < step * 0.2 && this.chargeT > 0.12) arrived = true; // blocked
    }
    this.yaw = Math.atan2(-(this.chargeTarget.x - this.position.x), -(this.chargeTarget.z - this.position.z));
    if (arrived || this.chargeT > cfg.maxTravelTime) {
      this.charging = false;
      this.velocity.multiplyScalar(0.15);
      this.velocity.y = 2;
      const cb = this.chargeDone;
      this.chargeDone = null;
      cb?.(arrived || dist < 3);
    }
  }

  lunge(dir: THREE.Vector3): void {
    this.lungeDir.copy(dir).setY(0).normalize();
    this.lungeT = P.melee.lungeTime;
  }

  /** Push the player (enemy stomps, boss attacks). */
  addKnockback(x: number, y: number, z: number): void {
    this.knock.x += x;
    this.knock.y += y;
    this.knock.z += z;
    if (y > 0) this.grounded = false;
  }

  /** Drag toward a point (boss power). */
  pullToward(target: THREE.Vector3, speed: number, dt: number): void {
    this.exitCover();
    this.tmp.copy(target).sub(this.position).setY(0);
    const d = this.tmp.length();
    if (d < 2) return;
    this.tmp.multiplyScalar((speed * dt) / d);
    this.knock.add(this.tmp.multiplyScalar(1 / Math.max(dt, 1e-3) * 0.12));
  }

  markWeaponOut(): void {
    this.weaponOutT = P.weaponOutTime;
  }

  // ---- Damage ----

  takeDamage(amount: number, from: THREE.Vector3 | null): void {
    if (!this.alive || amount <= 0) return;
    if (this.god) amount = 0;
    if (this.charging) amount *= 0.25;
    if (this.dashGraceT > 0) amount *= P.dashGraceDamageScale;
    this.shieldDelay = P.shieldRegenDelay;
    this.lastHitAgo = 0;
    const hadShield = this.shield > 0;
    let rest = amount;
    if (this.shield > 0) {
      const s = Math.min(this.shield, rest);
      this.shield -= s;
      rest -= s;
    }
    if (rest > 0) this.health = Math.max(0, this.health - rest);
    const strength = Math.min(1, amount / 25);
    this.game.rig.addShake(CONFIG.feel.shakeHitTaken * (0.4 + strength));
    this.game.hud.playerHit(from, this.shield > 0 ? 'shield' : 'health', amount);
    this.game.input.rumble(0.3 + strength * 0.5, 0.12);
    if (hadShield && this.shield <= 0) {
      this.game.audio.play('shieldBreakPlayer', { volume: 0.9 });
      this.game.rig.addShake(CONFIG.feel.shakeShieldBreak);
      this.game.hud.flash('shield');
    }
    this.game.audio.play(this.shield > 0 ? 'playerHitShield' : 'playerHitHealth', { volume: 0.5 + strength * 0.5 });
    if (from) this.game.avatar.trigger({ type: 'hit', fromX: from.x, fromZ: from.z, strength });
    if (this.health <= 0) this.die();
  }

  heal(amount: number): void {
    this.health = Math.min(P.healthMax, this.health + amount);
  }

  restoreShield(fraction: number): void {
    this.shield = Math.min(P.shieldMax, this.shield + P.shieldMax * fraction);
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.exitCover();
    this.charging = false;
    this.aiming = false;
    this.game.avatar.trigger({ type: 'death' });
    this.game.audio.play('playerDeath');
    this.game.events.emit('playerDied');
  }
}

function copyContact(src: CoverContact, dst: CoverContact): void {
  dst.box = src.box;
  dst.kind = src.kind;
  dst.surface.copy(src.surface);
  dst.normal.copy(src.normal);
  dst.tangent.copy(src.tangent);
  dst.gap = src.gap;
  dst.along = src.along;
  dst.halfLength = src.halfLength;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
