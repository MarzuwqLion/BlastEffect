import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { estimateBossFight, estimateTimeToKill } from '../src/combat/damage';

const { smg, rifle } = CONFIG.weapons;
const B = CONFIG.boss;

describe('boss tuning', () => {
  it('the fight lasts about 3-4 minutes', () => {
    const { total } = estimateBossFight(B, [smg, rifle]);
    expect(total).toBeGreaterThanOrEqual(180);
    expect(total).toBeLessThanOrEqual(240);
  });

  it('each phase pulls its weight (no phase is a formality)', () => {
    const { layers } = estimateBossFight(B, [smg, rifle]);
    const sum = layers.shield + layers.armor + layers.health;
    for (const v of Object.values(layers)) expect(v / sum).toBeGreaterThan(0.2);
  });

  it('weapon choice matters per layer', () => {
    const shieldOnly = { shield: B.shield, armor: 0, health: 1 };
    const armorOnly = { shield: 0, armor: B.armor, health: 1 };
    expect(estimateTimeToKill(shieldOnly, smg)).toBeLessThan(estimateTimeToKill(shieldOnly, rifle));
    expect(estimateTimeToKill(armorOnly, rifle)).toBeLessThan(estimateTimeToKill(armorOnly, smg));
  });

  it('every attack telegraphs for at least the minimum', () => {
    for (const a of Object.values(B.attacks)) expect(a.telegraph).toBeGreaterThanOrEqual(CONFIG.ai.minTelegraph);
  });
});
