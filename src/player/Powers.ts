import * as THREE from 'three';
import { CONFIG } from '../config';
import { MASK, makeRayHit } from '../core/Physics';
import type { Game } from '../game/Game';
import type { Player } from './Player';
import type { Enemy } from '../enemies/Enemy';
import type { PowerId } from '../character/types';
import type { KaCell } from '../combat/Explosives';

const PW = CONFIG.powers;
export const POWER_ORDER: readonly PowerId[] = ['pull', 'throw', 'charge'];

interface Projectile {
  active: boolean;
  kind: 'pull' | 'throw';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: Enemy | null;
  life: number;
  mesh: THREE.Mesh;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = makeRayHit();

/**
 * Ka powers. Pull (primer) lifts an unprotected enemy; Throw and Charge are
 * detonators. A detonator landing on a primed enemy sets off the combo.
 * Each power has its own cooldown.
 */
export class Powers {
  readonly cooldown: Record<PowerId, number> = { pull: 0, throw: 0, charge: 0 };
  /** Kwame's tuning shortens every cooldown. */
  cooldownScale = 1;
  private sinceCast = 99;
  private readonly projectiles: Projectile[] = [];
  private pending: { id: PowerId; t: number; target: Enemy | null; aim: THREE.Vector3 } | null = null;
  private chargeTargetEnemy: Enemy | null = null;
  casts = 0;

  constructor(private readonly game: Game, private readonly player: Player) {
    const pullMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40e0ff).multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const throwMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(0.22, 1);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(geo, i % 2 === 0 ? pullMat : throwMat);
      mesh.visible = false;
      game.scene.add(mesh);
      this.projectiles.push({ active: false, kind: 'pull', pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, life: 0, mesh });
    }
    this.projectiles.forEach((p, i) => (p.mesh.userData.kind = i % 2 === 0 ? 'pull' : 'throw'));
  }

  get castingRecently(): boolean {
    return this.sinceCast < 0.6 || this.pending !== null;
  }

  /** 0..1 remaining cooldown fraction, for the HUD. */
  cooldownFraction(id: PowerId): number {
    return this.cooldown[id] / (PW[id].cooldown * this.cooldownScale);
  }

  reset(): void {
    this.cooldown.pull = 0;
    this.cooldown.throw = 0;
    this.cooldown.charge = 0;
    this.pending = null;
    for (const p of this.projectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
  }

  update(dt: number, locked: boolean): void {
    const input = this.game.input;
    this.sinceCast += dt;
    for (const id of POWER_ORDER) this.cooldown[id] = Math.max(0, this.cooldown[id] - dt);
    if (!locked && this.player.alive && !this.player.charging) {
      if (input.pressed('power1')) this.tryCast('pull');
      else if (input.pressed('power2')) this.tryCast('throw');
      else if (input.pressed('power3')) this.tryCast('charge');
    }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const p = this.pending;
        this.pending = null;
        this.release(p.id, p.target, p.aim);
      }
    }
    if (this.player.charging && this.chargeTargetEnemy) {
      this.chargeTargetEnemy.chestPoint(_v);
      _v.y -= this.chargeTargetEnemy.height * 0.62;
      this.player.updateChargeTarget(_v);
      this.game.fx.chargeTrail(this.player);
    }
    this.updateProjectiles(dt);
  }

  tryCast(id: PowerId): boolean {
    if (this.cooldown[id] > 0) {
      this.game.audio.play('uiDeny', { volume: 0.5 });
      this.game.hud.powerDenied(id);
      return false;
    }
    if (this.pending) return false;
    const rig = this.game.rig;
    const cfg = PW[id];
    const aim = new THREE.Vector3();
    const target = this.game.enemies.findTargetInCone(rig.aimOrigin, rig.aimDir, PW.lockConeDeg, cfg.range, aim);
    if (id === 'charge' && !target) {
      this.game.audio.play('uiDeny', { volume: 0.5 });
      this.game.hud.powerDenied(id, 'noTarget');
      return false;
    }
    if (!target) {
      // Fire straight at the crosshair point.
      const hit = this.game.physics.raycast(rig.aimOrigin, rig.aimDir, cfg.range, MASK.playerShot, _hit, this.player.collider);
      aim.copy(hit ? _hit.point : _v.copy(rig.aimOrigin).addScaledVector(rig.aimDir, cfg.range));
    }
    this.cooldown[id] = cfg.cooldown * this.cooldownScale;
    this.sinceCast = 0;
    this.casts++;
    this.player.markWeaponOut();
    this.player.exitCover();
    this.pending = { id, t: cfg.castTime, target, aim };
    this.game.avatar.trigger({ type: 'cast', power: id });
    this.game.audio.play(id === 'pull' ? 'castPull' : id === 'throw' ? 'castThrow' : 'castCharge', { volume: 0.8 });
    this.game.events.emit('powerCast', id);
    return true;
  }

  private release(id: PowerId, target: Enemy | null, aim: THREE.Vector3): void {
    if (id === 'charge') {
      if (!target || !target.alive) return;
      this.chargeTargetEnemy = target;
      target.chestPoint(_v);
      _v.y -= target.height * 0.62;
      this.game.rig.kickFov(CONFIG.camera.chargeFovKick);
      this.game.rig.addShake(0.15);
      this.player.startCharge(_v, (arrived) => this.chargeImpact(target, arrived));
      return;
    }
    const p = this.projectiles.find((x) => !x.active && x.mesh.userData.kind === id);
    if (!p) return;
    p.active = true;
    p.kind = id;
    p.target = target;
    p.life = PW[id].range / PW[id].projectileSpeed + 0.5;
    this.game.avatar.handWorld(p.pos, -1);
    if (target) target.chestPoint(_v);
    else _v.copy(aim);
    p.vel.copy(_v).sub(p.pos).normalize().multiplyScalar(PW[id].projectileSpeed);
    p.mesh.position.copy(p.pos);
    p.mesh.visible = true;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      const cfg = PW[p.kind];
      if (p.target && p.target.alive) {
        p.target.chestPoint(_v).sub(p.pos).normalize();
        const speed = cfg.projectileSpeed;
        _dir.copy(p.vel).normalize().lerp(_v, Math.min(1, cfg.homing * dt)).normalize();
        p.vel.copy(_dir).multiplyScalar(speed);
      }
      const speed = p.vel.length();
      const dist = speed * dt;
      _dir.copy(p.vel).divideScalar(speed);
      let done = p.life <= 0;
      let hitEnemy: Enemy | null = null;
      // Sweep a small sphere against enemies and the world.
      const travelled = this.game.physics.sphereCast(p.pos, _dir, 0.25, dist, MASK.playerShot, _hit, this.player.collider);
      if (travelled < dist) {
        const tag = _hit.tag;
        if (tag && (tag.kind === 'enemy' || tag.kind === 'boss') && tag.owner) hitEnemy = tag.owner as Enemy;
        // A Lance into a ka cell sets it off.
        if (tag && tag.kind === 'prop' && tag.owner && p.kind === 'throw') (tag.owner as KaCell).ignite(CONFIG.explosives.cell.chainFuse);
        done = true;
        p.pos.addScaledVector(_dir, travelled);
      } else {
        p.pos.addScaledVector(_dir, dist);
      }
      // Homing target proximity (in case the sweep misses a fast mover).
      if (!done && p.target && p.target.alive && p.target.chestPoint(_v2).distanceTo(p.pos) < 0.7) {
        hitEnemy = p.target;
        done = true;
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;
      this.game.fx.powerTrail(p.pos, p.kind === 'pull' ? 0x40e0ff : 0xffd27a);
      if (done) {
        p.active = false;
        p.mesh.visible = false;
        if (hitEnemy && hitEnemy.alive) {
          if (p.kind === 'pull') this.pullHit(hitEnemy);
          else this.throwHit(hitEnemy, _dir);
        } else {
          this.game.fx.powerFizzle(p.pos, p.kind === 'pull' ? 0x40e0ff : 0xffd27a);
          this.game.audio.play('powerFizzle', { at: p.pos, volume: 0.6 });
        }
      }
    }
  }

  private pullHit(e: Enemy): void {
    const cfg = PW.pull;
    if (e.canBePrimed && e.canBeLifted) {
      e.lift(cfg.liftDuration, cfg.primeGrace);
      this.game.fx.pullHit(e.chestPoint(_v));
      this.game.audio.play('pullHit', { at: _v });
      this.game.hud.callout('primed', 'primed');
      this.game.events.emit('primed');
    } else if (e.canBePrimed) {
      // Too big to lift (the boss): primed in place.
      e.primedT = cfg.liftDuration + cfg.primeGrace;
      e.stagger(0.4);
      this.game.fx.pullHit(e.chestPoint(_v));
      this.game.audio.play('pullHit', { at: _v });
      this.game.hud.callout('primed', 'primed');
    } else {
      e.chestPoint(_v);
      this.game.combat.damage(e, cfg.blockedDamage, { shield: 1, armor: 1, health: 1 }, 'body', _v, null, { source: 'pull' });
      this.game.fx.powerFizzle(_v, 0x40e0ff);
      this.game.audio.play('powerBlocked', { at: _v });
      this.game.hud.blocked(e, e.defenses.shield > 0 ? 'shield' : 'armor');
      this.game.events.emit('pullBlocked');
    }
  }

  private throwHit(e: Enemy, dir: THREE.Vector3): void {
    const cfg = PW.throw;
    this.game.fx.throwHit(e.chestPoint(_v), dir);
    this.game.audio.play('throwHit', { at: _v });
    this.game.combat.detonatorHit(e, 'throw', cfg.damage, cfg.layers, dir, { speed: cfg.flingSpeed, up: cfg.flingUp });
  }

  private chargeImpact(target: Enemy, arrived: boolean): void {
    const cfg = PW.charge;
    this.chargeTargetEnemy = null;
    this.player.restoreShield(cfg.shieldRestore);
    this.game.fx.chargeImpact(this.player.position);
    this.game.audio.play('chargeImpact', { at: this.player.position });
    this.game.rig.addShake(0.5);
    this.game.time.hitStop(cfg.hitStop);
    this.game.input.rumble(0.8, 0.25);
    if (arrived && target.alive) {
      _dir.copy(target.position).sub(this.player.position).setY(0);
      if (_dir.lengthSq() < 1e-4) _dir.set(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
      _dir.normalize();
      this.game.combat.detonatorHit(target, 'charge', cfg.damage, cfg.layers, _dir, { speed: cfg.knockback, up: 4 });
    }
    // Splash knockback around the impact.
    for (const e of this.game.enemies.active) {
      if (!e.alive || e === target) continue;
      const d = e.position.distanceTo(this.player.position);
      if (d > cfg.impactRadius) continue;
      _dir.copy(e.position).sub(this.player.position).setY(0).normalize();
      e.chestPoint(_v);
      this.game.combat.damage(e, cfg.splashDamage, cfg.layers, 'body', _v, _dir, { stagger: 0.6, source: 'charge' });
    }
  }
}
