import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { estimateTimeToKill } from '../src/combat/damage';

const { smg, rifle } = CONFIG.weapons;
const { grunt, trooper, heavy } = CONFIG.enemies;

// Feel targets from the design brief, checked against the tuned config.
describe('feel targets: time to kill', () => {
  it('grunt dies in about 1.5 s of sustained SMG fire', () => {
    const t = estimateTimeToKill(grunt, smg);
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(1.8);
  });

  it('shield trooper takes about 4 s with guns alone', () => {
    const t = estimateTimeToKill(trooper, smg);
    expect(t).toBeGreaterThan(3.3);
    expect(t).toBeLessThan(4.7);
  });

  it('heavy takes 8-10 s with the SMG', () => {
    const t = estimateTimeToKill(heavy, smg, { accuracy: 0.9 });
    expect(t).toBeGreaterThanOrEqual(8);
    expect(t).toBeLessThanOrEqual(10);
  });

  it('heavy takes about half that with the rifle on its armor', () => {
    const tSmg = estimateTimeToKill(heavy, smg, { accuracy: 0.9 });
    const tRifle = estimateTimeToKill(heavy, rifle);
    expect(tRifle / tSmg).toBeGreaterThan(0.35);
    expect(tRifle / tSmg).toBeLessThan(0.6);
  });

  it('the weak point is faster again', () => {
    const body = estimateTimeToKill(heavy, rifle);
    const weak = estimateTimeToKill(heavy, rifle, { zone: 'weak' });
    expect(weak).toBeLessThan(body * 0.75);
  });
});
