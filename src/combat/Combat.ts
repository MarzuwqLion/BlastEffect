import * as THREE from 'three';
import { CONFIG, type LayerMultipliers, type WeaponConfig } from '../config';
import { resolveCombo } from './combo';
import { zoneDamage, type DamageResult, type HitZone, type Layer } from './damage';
import type { Enemy } from '../enemies/Enemy';
import type { Game } from '../game/Game';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _center = new THREE.Vector3();

interface ComboTargetRef {
  x: number;
  y: number;
  z: number;
  defenses: Enemy['defenses'];
  enemy: Enemy;
}

/**
 * Applies player damage to enemies and owns all the feedback around it:
 * hit markers, sounds, sparks by layer, hit-stop, kills and ragdolls, and
 * the combo explosion.
 */
export class Combat {
  combos = 0;
  private readonly comboTargets: ComboTargetRef[] = [];

  constructor(private readonly game: Game) {}

  weaponHit(e: Enemy, w: WeaponConfig, zone: HitZone, point: THREE.Vector3, dir: THREE.Vector3, normal: THREE.Vector3): void {
    const z = this.effectiveZone(e, zone);
    let base = zoneDamage(w, z);
    if (z === 'weak') base *= e.weakPointBonus;
    const stagger = w.id === 'rifle' ? 0.45 : 0;
    const r = this.damage(e, base, w.layers, z, point, dir, { stagger, impulse: w.killImpulse, source: w.id });
    // Zero damage on a live target means an invulnerable barrier: spark like a shield.
    const surface = r.firstLayer === 'shield' || (r.total <= 0 && e.alive) ? 'shield' : r.firstLayer === 'armor' ? 'armor' : 'flesh';
    this.game.fx.impact(point, normal, surface, w.id === 'rifle' ? 1.6 : 1);
    if (!e.alive || e.state === 'flung') {
      // Shots push ragdolls around a little.
      _v.copy(dir).multiplyScalar(w.id === 'rifle' ? 3 : 0.6);
      if (e.body.isDynamic()) e.body.applyImpulseAtPoint({ x: _v.x * 10, y: _v.y * 10, z: _v.z * 10 }, point, true);
    }
  }

  /** Bosses can have a dedicated weak point bonus; zones may be downgraded. */
  private effectiveZone(e: Enemy, zone: HitZone): HitZone {
    if (zone === 'weak' && !e.weakPointActive) return 'body';
    return zone;
  }

  meleeHit(e: Enemy, dir: THREE.Vector3): void {
    const M = CONFIG.player.melee;
    e.chestPoint(_v);
    const r = this.damage(e, M.damage, M.layers, 'body', _v, dir, { stagger: 0.5, impulse: M.knockback, source: 'melee' });
    this.game.audio.play('meleeHit', { at: _v });
    this.game.rig.addShake(0.2);
    this.game.time.hitStop(0.05);
    if (e.alive && !e.isProtected && e.kind !== 'boss') {
      _v2.copy(dir).multiplyScalar(M.knockback).setY(3);
      e.fling(_v2, 3);
    } else if (e.alive) {
      e.stagger(0.4);
    }
    void r;
  }

  /**
   * Central damage path: applies through layers, then feedback. Returns a
   * copy-safe snapshot of the result fields that matter.
   */
  damage(
    e: Enemy,
    base: number,
    layers: LayerMultipliers,
    zone: HitZone,
    point: THREE.Vector3,
    dir: THREE.Vector3 | null,
    opts: { stagger?: number; impulse?: number; source?: string; silent?: boolean } = {},
  ): { killed: boolean; firstLayer: Layer | null; total: number; shieldBroken: boolean; armorBroken: boolean } {
    const r: DamageResult = e.applyHit(base, layers, zone, dir, { stagger: opts.stagger, source: opts.source });
    const out = { killed: r.killed, firstLayer: r.firstLayer, total: r.total, shieldBroken: r.shieldBroken, armorBroken: r.armorBroken };
    if (r.total <= 0) return out;
    const crit = zone === 'head' || zone === 'weak';
    if (!opts.silent) {
      this.game.hud.hitMarker(r.firstLayer ?? 'health', r.killed, crit);
      this.game.audio.play(
        r.killed ? 'killConfirm' : r.firstLayer === 'shield' ? 'hitShield' : r.firstLayer === 'armor' ? 'hitArmor' : crit ? 'hitCrit' : 'hitFlesh',
        { volume: r.killed ? 0.9 : 0.55 },
      );
      this.game.hud.damageNumber(point, r.total, r.firstLayer ?? 'health', crit);
    }
    if (r.killed) this.kill(e, dir, opts.impulse ?? 4, crit);
    return out;
  }

  kill(e: Enemy, dir: THREE.Vector3 | null, impulse: number, crit: boolean): void {
    e.die(dir, impulse);
    this.game.time.hitStop(crit ? CONFIG.feel.hitStopHeadshotKill : CONFIG.feel.hitStopKill);
    const big = e.kind === 'heavy' || e.kind === 'boss';
    this.game.audio.play(big ? 'deathHeavy' : 'deathGrunt', { at: e.position, volume: 0.8 });
    this.game.fx.deathBurst(e.chestPoint(_v), big ? 1.6 : 1);
    this.game.input.rumble(0.35, 0.1);
  }

  /** Detonator hit on a primed enemy: the combo explosion. */
  detonate(primed: Enemy, by: 'throw' | 'charge'): void {
    const C = CONFIG.powers.combo;
    this.combos++;
    primed.chestPoint(_center);
    primed.primedT = 0;
    const targets = this.comboTargets;
    targets.length = 0;
    let boss: Enemy | null = null;
    for (const e of this.game.enemies.active) {
      if (!e.alive) continue;
      e.chestPoint(_v);
      // The boss takes combo damage through his own path (phases, invulnerability).
      if (e.kind === 'boss') {
        if (_v.distanceTo(_center) <= C.radius + e.radius) boss = e;
        continue;
      }
      targets.push({ x: _v.x, y: _v.y, z: _v.z, defenses: e.defenses, enemy: e });
    }
    // resolveCombo applies the layer math; feedback per hit below.
    const hits = resolveCombo(_center.x, _center.y, _center.z, targets, C.radius, C.damage, C.layers);
    for (const h of hits) {
      const e = h.target.enemy;
      _v.set(h.target.x - _center.x, 0, h.target.z - _center.z);
      if (_v.lengthSq() < 1e-4) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _v.normalize();
      e.barT = CONFIG.ui.enemyBarLinger;
      e.lastDamageLayer = h.result.firstLayer ?? 'health';
      this.game.hud.damageNumber(_v2.set(h.target.x, h.target.y + 0.4, h.target.z), h.result.total, h.result.firstLayer ?? 'health', true);
      if (h.result.shieldBroken && e.shieldBubble) {
        e.shieldBubble.visible = false;
        this.game.fx.shieldBreak(_v2.set(h.target.x, h.target.y, h.target.z));
      }
      const falloff = 1 - Math.min(1, h.distance / C.radius) * 0.4;
      if (h.result.killed) {
        e.alerted = true;
        _v.multiplyScalar(C.flingSpeed * falloff).setY(C.flingUp * falloff);
        e.die(_v, 0);
        this.game.fx.deathBurst(_v2.set(h.target.x, h.target.y, h.target.z), 1);
      } else if (!e.isProtected && e.kind !== 'boss') {
        _v.multiplyScalar(C.flingSpeed * falloff * (e.kind === 'heavy' ? 0.5 : 1)).setY(C.flingUp * falloff);
        e.fling(_v, 5);
      } else {
        e.stagger(C.stagger);
      }
    }
    if (boss) {
      boss.chestPoint(_v2);
      _v.copy(_v2).sub(_center).setY(0);
      if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
      _v.normalize();
      this.damage(boss, C.damage, C.layers, 'body', _v2, _v, { source: 'combo', silent: false });
      boss.stagger(C.stagger);
    }
    this.game.time.hitStop(C.hitStop);
    this.game.fx.comboExplosion(_center, C.radius);
    this.game.audio.play('combo', { volume: 1 });
    const dist = this.game.player.position.distanceTo(_center);
    this.game.rig.addShake(C.shake * Math.max(0.35, 1 - dist / 40));
    this.game.input.rumble(1, 0.4);
    this.game.hud.callout('combo', by === 'charge' ? 'comboCharge' : 'comboThrow');
    this.game.events.emit('combo');
  }

  /** Detonator damage on one enemy, triggering a combo if it is primed. */
  detonatorHit(e: Enemy, by: 'throw' | 'charge', base: number, layers: LayerMultipliers, dir: THREE.Vector3, fling: { speed: number; up: number }): void {
    const wasPrimed = e.primed;
    e.chestPoint(_v2);
    const res = this.damage(e, base, layers, 'body', _v2, dir, { impulse: fling.speed, source: by });
    if (wasPrimed) {
      this.detonate(e, by);
      return;
    }
    if (!e.alive || res.killed) return;
    if (!e.isProtected && e.kind !== 'boss') {
      _v.copy(dir).setY(0).normalize().multiplyScalar(fling.speed * (e.kind === 'heavy' ? 0.45 : 1));
      _v.y = fling.up;
      e.fling(_v, 6);
    } else {
      e.stagger(CONFIG.powers.throw.staggerShielded);
    }
  }
}
