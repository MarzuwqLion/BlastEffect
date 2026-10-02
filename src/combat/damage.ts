import type { EnemyConfig, LayerMultipliers, WeaponConfig } from '../config';

/** Defense layers, outermost first. Damage always hits the outermost layer left. */
export type Layer = 'shield' | 'armor' | 'health';
export const LAYER_ORDER: readonly Layer[] = ['shield', 'armor', 'health'];

export type HitZone = 'body' | 'head' | 'weak';

export interface Defenses {
  shield: number;
  armor: number;
  health: number;
  shieldMax: number;
  armorMax: number;
  healthMax: number;
}

export interface DamageResult {
  dealtShield: number;
  dealtArmor: number;
  dealtHealth: number;
  total: number;
  /** The layer the hit landed on first (null if the target was already dead). */
  firstLayer: Layer | null;
  shieldBroken: boolean;
  armorBroken: boolean;
  killed: boolean;
}

export function makeDefenses(shield: number, armor: number, health: number): Defenses {
  return { shield, armor, health, shieldMax: shield, armorMax: armor, healthMax: health };
}

export function defensesFor(cfg: Pick<EnemyConfig, 'shield' | 'armor' | 'health'>): Defenses {
  return makeDefenses(cfg.shield, cfg.armor, cfg.health);
}

export function emptyResult(out?: DamageResult): DamageResult {
  const r = out ?? ({} as DamageResult);
  r.dealtShield = 0;
  r.dealtArmor = 0;
  r.dealtHealth = 0;
  r.total = 0;
  r.firstLayer = null;
  r.shieldBroken = false;
  r.armorBroken = false;
  r.killed = false;
  return r;
}

/** The outermost layer that still has points, or null when dead. */
export function outerLayer(d: Defenses): Layer | null {
  if (d.shield > 0) return 'shield';
  if (d.armor > 0) return 'armor';
  if (d.health > 0) return 'health';
  return null;
}

/** True while shields or armor are up, which blocks primers like Pull. */
export function hasProtection(d: Defenses): boolean {
  return d.shield > 0 || d.armor > 0;
}

/**
 * Applies `base` damage through the layers, outermost first. Each layer
 * scales the remaining base damage by its multiplier; when a layer breaks,
 * the unused part of the base damage carries into the next layer at that
 * layer's multiplier. A multiplier of 0 makes a layer absorb the hit.
 * Mutates `d` and returns what each layer took.
 */
export function applyDamage(
  d: Defenses,
  base: number,
  mult: LayerMultipliers,
  out?: DamageResult,
): DamageResult {
  const r = emptyResult(out);
  if (d.health <= 0 || base <= 0) return r;
  let remaining = base;
  for (let i = 0; i < LAYER_ORDER.length && remaining > 1e-9; i++) {
    const layer = LAYER_ORDER[i];
    const current = d[layer];
    if (current <= 0) continue;
    if (r.firstLayer === null) r.firstLayer = layer;
    const m = mult[layer];
    if (m <= 0) {
      remaining = 0;
      break;
    }
    const effective = remaining * m;
    if (effective >= current) {
      d[layer] = 0;
      remaining -= current / m;
      addDealt(r, layer, current);
      if (layer === 'shield') r.shieldBroken = true;
      else if (layer === 'armor') r.armorBroken = true;
      else r.killed = true;
    } else {
      d[layer] = current - effective;
      addDealt(r, layer, effective);
      remaining = 0;
    }
  }
  r.total = r.dealtShield + r.dealtArmor + r.dealtHealth;
  return r;
}

function addDealt(r: DamageResult, layer: Layer, v: number): void {
  if (layer === 'shield') r.dealtShield += v;
  else if (layer === 'armor') r.dealtArmor += v;
  else r.dealtHealth += v;
}

/** Base damage for a weapon hit on a zone, before layer multipliers. */
export function zoneDamage(weapon: Pick<WeaponConfig, 'damage' | 'headshot' | 'weakPoint'>, zone: HitZone): number {
  if (zone === 'head') return weapon.damage * weapon.headshot;
  if (zone === 'weak') return weapon.damage * weapon.weakPoint;
  return weapon.damage;
}

export interface TtkOptions {
  accuracy?: number;
  zone?: HitZone;
}

/**
 * Expected time to kill with sustained fire, including reloads. Each shot
 * contributes `accuracy` of its damage (expected value), so the estimate is
 * smooth rather than dependent on a random seed.
 */
export function estimateTimeToKill(
  enemy: Pick<EnemyConfig, 'shield' | 'armor' | 'health'>,
  weapon: WeaponConfig,
  opts: TtkOptions = {},
): number {
  const accuracy = opts.accuracy ?? weapon.ttkAccuracy;
  const zone = opts.zone ?? 'body';
  const d = defensesFor(enemy);
  const base = zoneDamage(weapon, zone) * accuracy;
  let t = 0;
  let mag = weapon.magSize;
  for (let shot = 0; shot < 10000; shot++) {
    if (mag === 0) {
      t += weapon.reloadTime;
      mag = weapon.magSize;
    }
    applyDamage(d, base, weapon.layers);
    mag--;
    if (d.health <= 0) return t;
    t += weapon.fireInterval;
  }
  return Infinity;
}

export interface BossFightModel {
  shield: number;
  armor: number;
  health: number;
  transitionTime: number;
  leapTime: number;
  estimate: { uptime: number; waveTime: number };
}

/**
 * Expected boss fight length: each layer is shot with whichever weapon is
 * best against it, stretched by the share of time the player can actually
 * shoot (dodging telegraphs, reloading behind cover), plus the two phase
 * transitions with their reinforcement waves.
 */
export function estimateBossFight(boss: BossFightModel, weapons: WeaponConfig[]): { total: number; layers: Record<Layer, number> } {
  const layers = { shield: 0, armor: 0, health: 0 } as Record<Layer, number>;
  for (const layer of LAYER_ORDER) {
    const single = { shield: 0, armor: 0, health: 1 };
    if (layer === 'health') single.health = boss.health;
    else single[layer] = boss[layer];
    let best = Infinity;
    for (const w of weapons) best = Math.min(best, estimateTimeToKill(single, w));
    layers[layer] = best / boss.estimate.uptime;
  }
  const transitions = 2 * (boss.transitionTime + boss.leapTime + boss.estimate.waveTime);
  return { total: layers.shield + layers.armor + layers.health + transitions, layers };
}
