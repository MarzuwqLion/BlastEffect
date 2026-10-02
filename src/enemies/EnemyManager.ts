import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Game } from '../game/Game';
import { Enemy } from './Enemy';
import type { EnemyKind } from './EnemyModel';

/**
 * Shared attack tokens: no more than `maxAttackTokens` enemies shoot at the
 * player at once. Enemies request a token before telegraphing an attack and
 * release it when the burst ends or is interrupted.
 */
export class AttackTokens {
  private readonly holders = new Set<Enemy>();
  max = CONFIG.ai.maxAttackTokens;

  request(e: Enemy): boolean {
    if (this.holders.has(e)) return true;
    if (this.holders.size >= this.max) return false;
    this.holders.add(e);
    return true;
  }

  release(e: Enemy): void {
    this.holders.delete(e);
  }

  get inUse(): number {
    return this.holders.size;
  }

  clear(): void {
    this.holders.clear();
  }
}

/** Pools enemies by kind and updates the active ones. */
export class EnemyManager {
  readonly tokens = new AttackTokens();
  /** Active enemies (alive or still playing a death). */
  readonly active: Enemy[] = [];
  private readonly pools: Record<EnemyKind, Enemy[]> = { grunt: [], trooper: [], heavy: [] };
  private deathListeners: ((e: Enemy) => void)[] = [];
  kills = 0;

  constructor(private readonly game: Game) {}

  /** Pre-create pooled instances so spawning never allocates. */
  warm(counts: Partial<Record<EnemyKind, number>>): void {
    for (const kind of Object.keys(counts) as EnemyKind[]) {
      const pool = this.pools[kind];
      while (pool.length < (counts[kind] ?? 0)) pool.push(new Enemy(this.game, kind, CONFIG.enemies[kind]));
    }
  }

  onEnemyDeath(l: (e: Enemy) => void): void {
    this.deathListeners.push(l);
  }

  spawn(kind: EnemyKind, pos: THREE.Vector3, yaw: number, section: number, opts?: { alerted?: boolean; delay?: number }): Enemy {
    const pool = this.pools[kind];
    let e = pool.find((x) => !x.active);
    if (!e) {
      e = new Enemy(this.game, kind, CONFIG.enemies[kind]);
      pool.push(e);
    }
    e.spawn(pos, yaw, section, opts);
    this.active.push(e);
    return e;
  }

  /** Track an externally created enemy (the boss). */
  register(e: Enemy): void {
    if (!this.active.includes(e)) this.active.push(e);
  }

  onDeath(e: Enemy): void {
    this.kills++;
    for (const l of this.deathListeners) l(e);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.update(dt);
      if (!e.active) this.active.splice(i, 1);
    }
  }

  /** Living enemies in a section (or all). */
  aliveCount(section?: number): number {
    let n = 0;
    for (const e of this.active) if (e.alive && (section === undefined || e.section === section)) n++;
    return n;
  }

  /** Remove everything (checkpoint reload). */
  clear(): void {
    for (const e of [...this.active]) e.deactivate();
    this.active.length = 0;
    this.tokens.clear();
  }

  /** Living enemy whose chest is nearest the screen-space ray within `coneDeg`. */
  findTargetInCone(origin: THREE.Vector3, dir: THREE.Vector3, coneDeg: number, maxRange: number, out?: THREE.Vector3): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    const cos = Math.cos((coneDeg * Math.PI) / 180);
    for (const e of this.active) {
      if (!e.alive || e.state === 'spawning') continue;
      e.chestPoint(_p);
      _d.copy(_p).sub(origin);
      const dist = _d.length();
      if (dist > maxRange || dist < 0.5) continue;
      _d.divideScalar(dist);
      const dot = _d.dot(dir);
      if (dot < cos) continue;
      // Prefer small angle, then distance.
      const score = (1 - dot) * 400 + dist * 0.02;
      if (score < bestScore) {
        if (this.game.physics.blocked(origin, _p)) continue;
        bestScore = score;
        best = e;
        if (out) out.copy(_p);
      }
    }
    return best;
  }
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
