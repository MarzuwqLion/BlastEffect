import { describe, expect, it } from 'vitest';
import { SOUNDS, VOICES, voiceFor } from '../src/audio/manifest';
import { RECIPES } from '../src/audio/synth';
import { SPEAKERS } from '../src/strings';

const SR = 22050;

/** Share of a signal's energy near a frequency (Goertzel), relative to total energy. */
function energyNear(d: Float32Array, hz: number): number {
  const w = (2 * Math.PI * hz) / SR;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let total = 0;
  for (let i = 0; i < d.length; i++) {
    const s0 = d[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
    total += d[i] * d[i];
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (total * d.length);
}

describe('audio manifest', () => {
  it('every sound has a file or a synthesized recipe', () => {
    for (const [id, e] of Object.entries(SOUNDS)) if (!e.src) expect(RECIPES[id], id).toBeTypeOf('function');
  });

  it('the synthesized voices are short, audible and not clipped', () => {
    for (const id of ['voiceA', 'voiceE', 'voiceO', 'alert']) {
      const d = RECIPES[id](SR);
      expect(d.length / SR, id).toBeLessThan(0.5);
      let peak = 0;
      for (const v of d) {
        expect(Number.isFinite(v), id).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, id).toBeGreaterThan(0.3);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });

  it('the vowels differ where vowels differ: "ah" carries more around 700-1300 Hz, "eh" more around 1700-2000 Hz', () => {
    // The source is a pulse train, so energy sits on harmonics: sum across a band.
    const band = (d: Float32Array, lo: number, hi: number): number => {
      let e = 0;
      for (let f = lo; f <= hi; f += 15) e += energyNear(d, f);
      return e;
    };
    const a = RECIPES.voiceA(SR);
    const e = RECIPES.voiceE(SR);
    const aRatio = band(a, 700, 1300) / band(a, 1700, 2000);
    const eRatio = band(e, 700, 1300) / band(e, 1700, 2000);
    expect(aRatio).toBeGreaterThan(eRatio * 2);
  });

  it('every speaker has a voice, and they are spread apart', () => {
    for (const id of Object.keys(SPEAKERS)) expect(VOICES[id], id).toBeGreaterThan(0.3);
    expect(VOICES.croc).toBeLessThan(VOICES.yaw);
    expect(VOICES.yaw).toBeLessThan(VOICES.imani);
    expect(VOICES.mari).not.toBe(VOICES.imani);
  });

  it('letters make sounds; spaces and punctuation do not', () => {
    expect(voiceFor('a')).toBe('voiceA');
    expect(voiceFor('E')).toBe('voiceE');
    expect(voiceFor('o')).toBe('voiceO');
    expect(voiceFor('t')).toMatch(/^voice/);
    expect(voiceFor(' ')).toBeNull();
    expect(voiceFor('.')).toBeNull();
  });
});
