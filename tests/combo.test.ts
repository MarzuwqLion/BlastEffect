import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { canPrime, resolveCombo } from '../src/combat/combo';
import { defensesFor, makeDefenses, type Defenses } from '../src/combat/damage';

const combo = CONFIG.powers.combo;

function target(x: number, z: number, d: Defenses) {
  return { x, y: 0, z, defenses: d };
}

describe('priming', () => {
  it('Pull is blocked by shields and armor', () => {
    expect(canPrime(defensesFor(CONFIG.enemies.trooper))).toBe(false);
    expect(canPrime(defensesFor(CONFIG.enemies.heavy))).toBe(false);
    expect(canPrime(defensesFor(CONFIG.enemies.grunt))).toBe(true);
  });

  it('works on every enemy type once its defenses are stripped', () => {
    for (const e of Object.values(CONFIG.enemies)) {
      const d = defensesFor(e);
      d.shield = 0;
      d.armor = 0;
      expect(canPrime(d)).toBe(true);
    }
  });

  it('cannot prime the dead', () => {
    expect(canPrime(makeDefenses(0, 0, 0))).toBe(false);
  });
});

describe('combo explosion', () => {
  it('hits everyone inside 5 m for 150 and nobody outside', () => {
    const near = target(1, 1, makeDefenses(0, 0, 300));
    const edge = target(4.9, 0, makeDefenses(0, 0, 300));
    const far = target(5.2, 0, makeDefenses(0, 0, 300));
    const hits = resolveCombo(0, 0, 0, [far, edge, near], combo.radius, combo.damage, combo.layers);
    expect(hits.map((h) => h.target)).toEqual([near, edge]);
    expect(near.defenses.health).toBe(150);
    expect(edge.defenses.health).toBe(150);
    expect(far.defenses.health).toBe(300);
  });

  it('kills a full-health grunt outright', () => {
    const g = target(0, 2, defensesFor(CONFIG.enemies.grunt));
    const [hit] = resolveCombo(0, 0, 0, [g], combo.radius, combo.damage, combo.layers);
    expect(hit.result.killed).toBe(true);
  });

  it('strips a large share of a trooper group (shields go through combos)', () => {
    const t = target(0, 2, defensesFor(CONFIG.enemies.trooper));
    resolveCombo(0, 0, 0, [t], combo.radius, combo.damage, combo.layers);
    expect(t.defenses.shield).toBe(CONFIG.enemies.trooper.shield - combo.damage);
  });

  it('skips dead targets', () => {
    const dead = target(0, 1, makeDefenses(0, 0, 0));
    expect(resolveCombo(0, 0, 0, [dead], 5, 150, combo.layers)).toHaveLength(0);
  });
});
