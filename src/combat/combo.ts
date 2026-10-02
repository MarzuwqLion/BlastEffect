import type { LayerMultipliers } from '../config';
import { applyDamage, hasProtection, type DamageResult, type Defenses } from './damage';

/** Primers (Pull) only take hold once shields and armor are gone. */
export function canPrime(d: Defenses): boolean {
  return d.health > 0 && !hasProtection(d);
}

export interface ComboTarget {
  x: number;
  y: number;
  z: number;
  defenses: Defenses;
}

export interface ComboHit<T extends ComboTarget> {
  target: T;
  result: DamageResult;
  distance: number;
}

/**
 * Resolves a combo explosion: every living target within `radius` of the
 * centre takes `damage` through its layers. The caller applies stagger and
 * physics. Returns hits sorted by distance.
 */
export function resolveCombo<T extends ComboTarget>(
  cx: number,
  cy: number,
  cz: number,
  targets: readonly T[],
  radius: number,
  damage: number,
  layers: LayerMultipliers,
): ComboHit<T>[] {
  const hits: ComboHit<T>[] = [];
  const r2 = radius * radius;
  for (const t of targets) {
    if (t.defenses.health <= 0) continue;
    const dx = t.x - cx;
    const dy = t.y - cy;
    const dz = t.z - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 > r2) continue;
    const result = applyDamage(t.defenses, damage, layers);
    hits.push({ target: t, result, distance: Math.sqrt(dist2) });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}
