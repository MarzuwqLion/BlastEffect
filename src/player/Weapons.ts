import * as THREE from 'three';
import { CONFIG, DEG, type WeaponConfig } from '../config';
import { MASK, makeRayHit } from '../core/Physics';
import type { Game } from '../game/Game';
import type { Player } from './Player';
import type { WeaponId } from '../character/types';
import type { Enemy } from '../enemies/Enemy';

export interface WeaponState {
  cfg: WeaponConfig;
  mag: number;
  reserve: number;
}

const M = CONFIG.player.melee;

/**
 * SMG and rifle: hitscan from the camera through the crosshair (validated
 * from the muzzle), magazines and reserves, reloads, swapping, recoil,
 * spread bloom, plus melee.
 */
export class Weapons {
  readonly smg: WeaponState;
  readonly rifle: WeaponState;
  current: WeaponId = 'smg';
  private cooldown = 0;
  private reloadT = 0;
  private reloadTotal = 0;
  private swapT = 0;
  private bloom = 0;
  private sinceShot = 99;
  private meleeCooldown = 0;
  private meleeWindup = -1;
  private meleeTarget: Enemy | null = null;
  private triggerHeldPrev = false;
  /** Shots fired (for tests/debug). */
  shotsFired = 0;

  private readonly hit = makeRayHit();
  private readonly muzzleHit = makeRayHit();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(private readonly game: Game, private readonly player: Player) {
    const { smg, rifle } = CONFIG.weapons;
    this.smg = { cfg: smg, mag: smg.magSize, reserve: smg.reserveStart };
    this.rifle = { cfg: rifle, mag: rifle.magSize, reserve: rifle.reserveStart };
  }

  get state(): WeaponState {
    return this.current === 'smg' ? this.smg : this.rifle;
  }

  get isReloading(): boolean {
    return this.reloadT > 0;
  }

  get reloadProgress(): number {
    return this.reloadTotal > 0 ? 1 - this.reloadT / this.reloadTotal : 0;
  }

  get isSwapping(): boolean {
    return this.swapT > 0;
  }

  get isFiring(): boolean {
    return this.sinceShot < 0.18;
  }

  get firingRecently(): boolean {
    return this.sinceShot < 0.45;
  }

  /** Current spread cone half-angle in degrees, for the crosshair. */
  get spreadDeg(): number {
    const c = this.state.cfg;
    const base = THREE.MathUtils.lerp(c.spreadHip, c.spreadAim, this.game.rig.aimAmount);
    return base + this.bloom;
  }

  resetForSpawn(): void {
    this.cooldown = 0;
    this.reloadT = 0;
    this.swapT = 0;
    this.bloom = 0;
    this.meleeWindup = -1;
    this.meleeCooldown = 0;
  }

  /** Snapshot/restore for checkpoints. */
  snapshot(): { smg: [number, number]; rifle: [number, number]; current: WeaponId } {
    return { smg: [this.smg.mag, this.smg.reserve], rifle: [this.rifle.mag, this.rifle.reserve], current: this.current };
  }

  restore(s: { smg: [number, number]; rifle: [number, number]; current: WeaponId }): void {
    [this.smg.mag, this.smg.reserve] = s.smg;
    [this.rifle.mag, this.rifle.reserve] = s.rifle;
    this.current = s.current;
  }

  /** Ammo crate: top up reserves. Returns true if anything was added. */
  refill(): boolean {
    let added = false;
    for (const w of [this.smg, this.rifle]) {
      if (w.reserve < w.cfg.reserveMax) {
        w.reserve = w.cfg.reserveMax;
        added = true;
      }
    }
    return added;
  }

  needsAmmo(): boolean {
    return this.smg.reserve < this.smg.cfg.reserveMax * 0.95 || this.rifle.reserve < this.rifle.cfg.reserveMax * 0.95;
  }

  update(dt: number, locked: boolean): void {
    const input = this.game.input;
    const w = this.state;
    const c = w.cfg;
    this.sinceShot += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.bloom = Math.max(0, this.bloom - c.bloomRecovery * dt);
    this.game.rig.setRecoilRecovery(c.recoilRecovery);

    if (this.swapT > 0) {
      this.swapT -= dt;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    if (this.meleeWindup >= 0) {
      this.meleeWindup -= dt;
      if (this.meleeWindup < 0) this.resolveMelee();
    }

    const p = this.player;
    if (locked || !p.alive || p.charging) {
      this.triggerHeldPrev = false;
      return;
    }

    if (input.pressed('swapWeapon') && this.swapT <= 0) this.swap();

    // X on the gamepad doubles as interact; the director consumes it first.
    if (input.pressed('reload')) this.startReload();

    if (input.pressed('melee') && this.meleeCooldown <= 0) this.startMelee();

    const held = input.isHeld('fire');
    const pressed = input.pressed('fire') || (held && !this.triggerHeldPrev);
    this.triggerHeldPrev = held;
    const wants = c.automatic ? held : pressed;
    if (wants && this.cooldown <= 0 && this.swapT <= 0 && this.meleeWindup < 0 && !p.sprinting) {
      if (w.mag > 0) {
        if (this.reloadT > 0 && w.mag > 0) {
          // Firing cancels a reload if there are rounds left.
          this.reloadT = 0;
        }
        if (this.reloadT <= 0) this.fire();
      } else if (pressed || (c.automatic && held && this.cooldown <= 0)) {
        if (w.reserve > 0) this.startReload();
        else if (pressed) this.game.audio.play('dryFire', { volume: 0.6 });
        this.cooldown = 0.25;
      }
    }
    if (held && p.sprinting) p.sprinting = false;
  }

  swap(): void {
    this.current = this.current === 'smg' ? 'rifle' : 'smg';
    this.swapT = CONFIG.weapons.swapTime;
    this.reloadT = 0;
    this.bloom = 0;
    this.player.markWeaponOut();
    this.game.audio.play('swap', { volume: 0.7 });
    this.game.avatar.trigger({ type: 'swap', to: this.current });
    this.game.events.emit('weaponSwap');
  }

  startReload(): void {
    const w = this.state;
    if (this.reloadT > 0 || this.swapT > 0) return;
    if (w.mag >= w.cfg.magSize || w.reserve <= 0) return;
    this.reloadT = w.cfg.reloadTime;
    this.reloadTotal = w.cfg.reloadTime;
    this.game.audio.play(this.current === 'smg' ? 'reloadSmg' : 'reloadRifle', { volume: 0.8 });
    this.game.avatar.trigger({ type: 'reload', weapon: this.current, duration: w.cfg.reloadTime });
  }

  private finishReload(): void {
    const w = this.state;
    const need = w.cfg.magSize - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
    this.reloadT = 0;
  }

  private fire(): void {
    const w = this.state;
    const c = w.cfg;
    const rig = this.game.rig;
    w.mag--;
    this.shotsFired++;
    this.cooldown = c.fireInterval;
    this.sinceShot = 0;
    this.player.markWeaponOut();

    // Spread cone around the crosshair.
    const spread = this.spreadDeg * DEG;
    this.dir.copy(rig.aimDir);
    if (spread > 0) {
      this.right.crossVectors(this.dir, THREE.Object3D.DEFAULT_UP).normalize();
      this.up.crossVectors(this.right, this.dir).normalize();
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * Math.tan(spread);
      this.dir.addScaledVector(this.right, Math.cos(a) * r).addScaledVector(this.up, Math.sin(a) * r).normalize();
    }
    this.bloom = Math.min(c.bloomMax, this.bloom + c.bloomPerShot);

    // Start the ray level with the player so nothing behind her is hit.
    this.player.aimPoint(this.tmp);
    const t0 = Math.max(0, this.tmp.sub(rig.aimOrigin).dot(this.dir));
    this.origin.copy(rig.aimOrigin).addScaledVector(this.dir, t0);
    const hasHit = this.game.physics.raycast(this.origin, this.dir, c.range, MASK.playerShot, this.hit, this.player.collider);
    if (hasHit) this.end.copy(this.hit.point);
    else this.end.copy(this.origin).addScaledVector(this.dir, c.range);

    // The gun must also see the point; otherwise the shot hits the obstacle at the muzzle.
    this.game.avatar.muzzleWorld(this.muzzle);
    let hitData = hasHit ? this.hit : null;
    this.tmp.copy(this.end).sub(this.muzzle);
    const md = this.tmp.length();
    if (md > 0.5) {
      this.tmp.divideScalar(md);
      if (this.game.physics.raycast(this.muzzle, this.tmp, md - 0.3, MASK.playerShot, this.muzzleHit, this.player.collider)) {
        hitData = this.muzzleHit;
        this.end.copy(this.muzzleHit.point);
      }
    }

    if (hitData) {
      const tag = hitData.tag;
      if (tag && (tag.kind === 'enemy' || tag.kind === 'boss') && tag.owner) {
        this.game.combat.weaponHit(tag.owner as Enemy, c, tag.zone ?? 'body', hitData.point, this.dir, hitData.normal);
      } else {
        this.game.fx.impact(hitData.point, hitData.normal, tag?.surface ?? 'stone', c.id === 'rifle' ? 1.6 : 1);
        this.game.audio.play(c.id === 'rifle' ? 'impactHeavy' : 'impact', { at: hitData.point, volume: 0.5 });
      }
    }

    // Feedback.
    rig.addRecoil(c.recoilPitch * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 2 * c.recoilYaw);
    rig.addShake(c.shake);
    this.game.fx.muzzleFlash(this.muzzle, this.dir, c.id);
    this.game.fx.tracer(this.muzzle, this.end, c.id === 'rifle' ? 0xfff0b0 : 0xffe080, c.id === 'rifle' ? 0.05 : 0.025);
    this.game.audio.play(c.id === 'smg' ? 'smgShot' : 'rifleShot', { volume: c.id === 'smg' ? 0.55 : 0.9 });
    this.game.avatar.trigger({ type: 'fire', weapon: c.id });
    this.game.input.rumble(c.id === 'rifle' ? 0.5 : 0.12, c.id === 'rifle' ? 0.12 : 0.04);
    this.game.events.emit('weaponFired');
    if (w.mag === 0 && w.reserve > 0) {
      // Auto-reload shortly after running dry.
      this.cooldown = Math.max(this.cooldown, 0.15);
    }
  }

  private startMelee(): void {
    const p = this.player;
    this.meleeCooldown = M.cooldown;
    this.reloadT = 0;
    p.markWeaponOut();
    // Pick the nearest enemy in front of the camera.
    const rig = this.game.rig;
    let best: Enemy | null = null;
    let bestD = M.range + 1.5;
    const cos = Math.cos(M.coneDeg * DEG);
    for (const e of this.game.enemies.active) {
      if (!e.alive) continue;
      this.tmp.copy(e.position).sub(p.position);
      this.tmp.y = 0;
      const d = this.tmp.length();
      if (d > bestD || d < 1e-3) continue;
      this.tmp.divideScalar(d);
      const fx = -Math.sin(rig.yaw);
      const fz = -Math.cos(rig.yaw);
      if (this.tmp.x * fx + this.tmp.z * fz < cos) continue;
      best = e;
      bestD = d;
    }
    this.meleeTarget = best;
    if (best) {
      this.tmp.copy(best.position).sub(p.position);
      p.lunge(this.tmp);
    } else {
      this.tmp.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
      p.lunge(this.tmp);
    }
    p.yaw = rig.yaw;
    this.meleeWindup = M.windup;
    this.game.avatar.trigger({ type: 'melee' });
    this.game.audio.play('meleeSwing', { volume: 0.8 });
  }

  private resolveMelee(): void {
    const e = this.meleeTarget;
    this.meleeTarget = null;
    if (!e || !e.alive) return;
    const d = e.position.distanceTo(this.player.position);
    if (d > M.range + e.radius) return;
    this.tmp.copy(e.position).sub(this.player.position).setY(0).normalize();
    this.game.combat.meleeHit(e, this.tmp);
  }
}
