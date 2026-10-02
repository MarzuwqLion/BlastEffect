import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { applyDamage, makeDefenses, outerLayer, zoneDamage } from '../src/combat/damage';

const smg = CONFIG.weapons.smg;
const rifle = CONFIG.weapons.rifle;

describe('layer multipliers', () => {
  it('SMG does 1.5x to shields', () => {
    const d = makeDefenses(100, 0, 100);
    const r = applyDamage(d, 12, smg.layers);
    expect(r.dealtShield).toBeCloseTo(18);
    expect(d.shield).toBeCloseTo(82);
    expect(r.firstLayer).toBe('shield');
  });

  it('SMG does 0.5x to armor', () => {
    const d = makeDefenses(0, 100, 100);
    applyDamage(d, 12, smg.layers);
    expect(d.armor).toBeCloseTo(94);
  });

  it('rifle does 1.5x to armor and 0.75x to shields', () => {
    const a = makeDefenses(0, 200, 100);
    applyDamage(a, 70, rifle.layers);
    expect(a.armor).toBeCloseTo(95);
    const s = makeDefenses(200, 0, 100);
    applyDamage(s, 70, rifle.layers);
    expect(s.shield).toBeCloseTo(147.5);
  });

  it('health takes 1x', () => {
    const d = makeDefenses(0, 0, 150);
    applyDamage(d, 12, smg.layers);
    expect(d.health).toBe(138);
  });

  it('carries overflow into the next layer at that layer multiplier', () => {
    // 10 shield left; SMG hit is worth 18 vs shield. 10 shield uses 10/1.5
    // = 6.667 base, leaving 5.333 base for health at 1x.
    const d = makeDefenses(10, 0, 100);
    const r = applyDamage(d, 12, smg.layers);
    expect(r.shieldBroken).toBe(true);
    expect(d.shield).toBe(0);
    expect(d.health).toBeCloseTo(100 - (12 - 10 / 1.5));
    expect(r.dealtHealth).toBeCloseTo(12 - 10 / 1.5);
  });

  it('carries overflow through all three layers', () => {
    const d = makeDefenses(15, 15, 100);
    // Rifle: 15 shield uses 20 base; 15 armor uses 10 base; 40 base to health.
    const r = applyDamage(d, 70, rifle.layers);
    expect(r.shieldBroken && r.armorBroken).toBe(true);
    expect(d.health).toBeCloseTo(60);
  });

  it('a zero multiplier absorbs the hit', () => {
    const d = makeDefenses(50, 0, 100);
    const r = applyDamage(d, 100, { shield: 0, armor: 1, health: 1 });
    expect(r.total).toBe(0);
    expect(d.shield).toBe(50);
    expect(d.health).toBe(100);
  });

  it('reports kills once and ignores damage to the dead', () => {
    const d = makeDefenses(0, 0, 10);
    expect(applyDamage(d, 12, smg.layers).killed).toBe(true);
    const again = applyDamage(d, 12, smg.layers);
    expect(again.killed).toBe(false);
    expect(again.total).toBe(0);
    expect(outerLayer(d)).toBeNull();
  });
});

describe('hit zones', () => {
  it('headshots are 1.5x on both weapons', () => {
    expect(zoneDamage(smg, 'head')).toBeCloseTo(18);
    expect(zoneDamage(rifle, 'head')).toBeCloseTo(105);
  });

  it('rifle weak point is 2.5x and stacks with the armor multiplier', () => {
    expect(zoneDamage(rifle, 'weak')).toBeCloseTo(175);
    const d = makeDefenses(0, 300, 250);
    applyDamage(d, zoneDamage(rifle, 'weak'), rifle.layers);
    expect(d.armor).toBeCloseTo(300 - 262.5);
  });
});
