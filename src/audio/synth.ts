/**
 * Placeholder sound effects synthesized in JS at startup (no files). Each
 * recipe returns mono samples. Swap any of them for a real file through
 * src/audio/manifest.ts.
 */

export type Recipe = (sr: number) => Float32Array;

const TAU = Math.PI * 2;

/** Deterministic noise so sounds are identical every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function buf(sr: number, dur: number): Float32Array {
  return new Float32Array(Math.ceil(sr * dur));
}

/** One-pole low-pass coefficient. */
function lpk(sr: number, hz: number): number {
  return 1 - Math.exp((-TAU * hz) / sr);
}

function env(t: number, attack: number, decay: number): number {
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

function normalize(d: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  // Short fade out to avoid clicks.
  const f = Math.min(d.length, 64);
  for (let i = 0; i < f; i++) d[d.length - 1 - i] *= i / f;
  return d;
}

function softclip(x: number, drive = 1): number {
  return Math.tanh(x * drive);
}

/** Gunshot body: noise burst through a falling low-pass plus a thump. */
function gunshot(sr: number, o: { dur: number; seed: number; thump: number; thumpHz: number; bright: number; decay: number; tail: number; crack?: number }): Float32Array {
  const d = buf(sr, o.dur);
  const r = rng(o.seed);
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const n = r();
    const cut = 300 + o.bright * Math.exp(-t * 30);
    lp += (n - lp) * lpk(sr, cut);
    lp2 += (lp - lp2) * lpk(sr, cut * 1.5);
    const noise = lp2 * env(t, 0.0008, o.decay) * 1.6;
    const thump = Math.sin(TAU * o.thumpHz * t * (1 + Math.exp(-t * 40))) * env(t, 0.001, 0.03) * o.thump;
    const crack = (o.crack ?? 0) * n * env(t, 0.0002, 0.004);
    const tail = lp * o.tail * env(t, 0.01, o.decay * 4);
    d[i] = softclip(noise + thump + crack + tail, 1.4);
  }
  return normalize(d);
}

function sweep(sr: number, dur: number, f0: number, f1: number, o: { type?: 'sine' | 'saw' | 'square' | 'tri'; attack?: number; decay?: number; noise?: number; seed?: number; vibrato?: number } = {}): Float32Array {
  const d = buf(sr, dur);
  const r = rng(o.seed ?? 7);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const k = t / dur;
    const f = f0 * Math.pow(f1 / f0, k) * (1 + (o.vibrato ?? 0) * Math.sin(TAU * 6 * t));
    ph += f / sr;
    const p = ph % 1;
    let v: number;
    switch (o.type ?? 'sine') {
      case 'saw': v = p * 2 - 1; break;
      case 'square': v = p < 0.5 ? 1 : -1; break;
      case 'tri': v = 1 - Math.abs(p * 4 - 2); break;
      default: v = Math.sin(TAU * p);
    }
    lp += (r() - lp) * lpk(sr, f * 2);
    v += lp * (o.noise ?? 0);
    const a = o.attack ?? 0.005;
    const e = t < a ? t / a : 1 - Math.pow((t - a) / Math.max(1e-3, dur - a), o.decay ?? 1.5);
    d[i] = v * Math.max(0, e);
  }
  return normalize(d);
}

function noiseBurst(sr: number, dur: number, o: { lowHz: number; highHz: number; seed?: number; attack?: number; decay?: number; band?: boolean }): Float32Array {
  const d = buf(sr, dur);
  const r = rng(o.seed ?? 3);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const k = t / dur;
    const cut = o.lowHz + (o.highHz - o.lowHz) * k;
    lp += (r() - lp) * lpk(sr, Math.max(20, cut));
    hp = 0.97 * (hp + lp - prev);
    prev = lp;
    const v = o.band ? hp : lp;
    d[i] = v * env(t, o.attack ?? 0.005, o.decay ?? dur / 3);
  }
  return normalize(d);
}

function mix(...parts: [Float32Array, number, number?][]): Float32Array {
  let len = 0;
  for (const [p, , off] of parts) len = Math.max(len, p.length + (off ?? 0));
  const d = new Float32Array(len);
  for (const [p, g, off] of parts) for (let i = 0; i < p.length; i++) d[i + (off ?? 0)] += p[i] * g;
  return normalize(d);
}

function clicks(sr: number, times: number[], o: { hz: number; seed: number; dur?: number }): Float32Array {
  const d = buf(sr, o.dur ?? Math.max(...times) + 0.1);
  const r = rng(o.seed);
  for (const t0 of times) {
    const s0 = Math.floor(t0 * sr);
    let lp = 0;
    for (let i = 0; i < sr * 0.05 && s0 + i < d.length; i++) {
      const t = i / sr;
      lp += (r() - lp) * lpk(sr, o.hz);
      d[s0 + i] += (lp * 2 + Math.sin(TAU * o.hz * 0.4 * t) * 0.5) * Math.exp(-t * 120);
    }
  }
  return normalize(d);
}

/** Bell / chime partials. */
function chime(sr: number, dur: number, base: number, partials: number[], decay: number): Float32Array {
  const d = buf(sr, dur);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let v = 0;
    partials.forEach((p, k) => {
      v += Math.sin(TAU * base * p * t) * Math.exp(-t / (decay / (1 + k * 0.4))) / (k + 1);
    });
    d[i] = v * Math.min(1, t * 400);
  }
  return normalize(d);
}

function boom(sr: number, dur: number, seed: number, hz = 50): Float32Array {
  const d = buf(sr, dur);
  const r = rng(seed);
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    lp += (r() - lp) * lpk(sr, 200 + 3000 * Math.exp(-t * 12));
    const sub = Math.sin(TAU * hz * t * (1 + 2 * Math.exp(-t * 18))) * env(t, 0.002, 0.35);
    d[i] = softclip(lp * 2.2 * env(t, 0.002, dur / 4) + sub * 1.2, 1.5);
  }
  return normalize(d);
}

export const RECIPES: Record<string, Recipe> = {
  smgShot: (sr) => gunshot(sr, { dur: 0.22, seed: 11, thump: 0.7, thumpHz: 120, bright: 5000, decay: 0.03, tail: 0.3, crack: 0.4 }),
  rifleShot: (sr) => mix(
    [gunshot(sr, { dur: 0.9, seed: 12, thump: 1.2, thumpHz: 70, bright: 7000, decay: 0.06, tail: 0.5, crack: 0.8 }), 1],
    [sweep(sr, 0.5, 1800, 400, { type: 'saw', decay: 3 }), 0.08],
  ),
  gruntShot: (sr) => mix([sweep(sr, 0.16, 1400, 300, { type: 'square', decay: 2, noise: 0.6, seed: 13 }), 0.6], [gunshot(sr, { dur: 0.18, seed: 14, thump: 0.4, thumpHz: 160, bright: 2500, decay: 0.03, tail: 0.2 }), 0.6]),
  trooperShot: (sr) => mix([sweep(sr, 0.12, 1800, 500, { type: 'square', decay: 2, noise: 0.5, seed: 15 }), 0.6], [gunshot(sr, { dur: 0.14, seed: 16, thump: 0.3, thumpHz: 180, bright: 3000, decay: 0.025, tail: 0.2 }), 0.5]),
  heavyShot: (sr) => mix([sweep(sr, 0.14, 700, 160, { type: 'saw', decay: 2, noise: 0.5, seed: 17 }), 0.6], [gunshot(sr, { dur: 0.16, seed: 18, thump: 0.8, thumpHz: 90, bright: 1800, decay: 0.03, tail: 0.3 }), 0.6]),
  enemyCharge: (sr) => sweep(sr, 0.6, 300, 1400, { type: 'tri', attack: 0.4, decay: 4, vibrato: 0.02 }),
  heavyWindup: (sr) => mix([sweep(sr, 0.9, 80, 420, { type: 'saw', attack: 0.7, decay: 5, noise: 0.3 }), 0.7], [noiseBurst(sr, 0.9, { lowHz: 300, highHz: 2500, attack: 0.7, decay: 0.3, band: true }), 0.4]),
  impact: (sr) => mix([clicks(sr, [0], { hz: 3000, seed: 21, dur: 0.12 }), 0.8], [noiseBurst(sr, 0.12, { lowHz: 4000, highHz: 800, decay: 0.02, seed: 22 }), 0.6]),
  impactHeavy: (sr) => mix([clicks(sr, [0], { hz: 2000, seed: 23, dur: 0.3 }), 0.7], [noiseBurst(sr, 0.3, { lowHz: 3000, highHz: 300, decay: 0.06, seed: 24 }), 0.8]),
  hitFlesh: (sr) => mix([noiseBurst(sr, 0.1, { lowHz: 1200, highHz: 300, decay: 0.03, seed: 25 }), 1], [sweep(sr, 0.08, 220, 90), 0.6]),
  hitShield: (sr) => mix([sweep(sr, 0.14, 2400, 1200, { type: 'tri', decay: 2 }), 0.5], [noiseBurst(sr, 0.12, { lowHz: 6000, highHz: 3000, decay: 0.03, band: true, seed: 26 }), 0.6]),
  hitArmor: (sr) => mix([chime(sr, 0.18, 900, [1, 2.76, 5.4], 0.05), 0.6], [clicks(sr, [0], { hz: 4000, seed: 27, dur: 0.1 }), 0.5]),
  hitCrit: (sr) => mix([chime(sr, 0.2, 1500, [1, 2], 0.05), 0.6], [noiseBurst(sr, 0.08, { lowHz: 3000, highHz: 900, decay: 0.02, seed: 28 }), 0.6]),
  killConfirm: (sr) => mix([chime(sr, 0.35, 660, [1, 1.5, 2], 0.09), 0.6], [sweep(sr, 0.2, 180, 60), 0.6], [noiseBurst(sr, 0.15, { lowHz: 2500, highHz: 300, decay: 0.05, seed: 29 }), 0.4]),
  shieldBreak: (sr) => mix([chime(sr, 0.7, 1300, [1, 1.33, 2.1, 3.3], 0.15), 0.6], [noiseBurst(sr, 0.6, { lowHz: 8000, highHz: 1500, decay: 0.12, band: true, seed: 30 }), 0.7], [sweep(sr, 0.4, 900, 200, { type: 'saw', decay: 2 }), 0.2]),
  armorBreak: (sr) => mix([clicks(sr, [0, 0.03, 0.07, 0.12], { hz: 2500, seed: 31, dur: 0.6 }), 0.7], [boom(sr, 0.6, 32, 80), 0.6]),
  shieldBreakPlayer: (sr) => mix([chime(sr, 0.9, 700, [1, 1.5, 2.2], 0.2), 0.5], [noiseBurst(sr, 0.7, { lowHz: 6000, highHz: 600, decay: 0.15, band: true, seed: 33 }), 0.7], [sweep(sr, 0.6, 600, 80, { type: 'saw', decay: 1.5 }), 0.4]),
  playerHitShield: (sr) => mix([sweep(sr, 0.15, 1600, 700, { type: 'tri', decay: 2 }), 0.5], [noiseBurst(sr, 0.12, { lowHz: 5000, highHz: 2000, decay: 0.03, band: true, seed: 34 }), 0.6]),
  playerHitHealth: (sr) => mix([noiseBurst(sr, 0.16, { lowHz: 1500, highHz: 200, decay: 0.04, seed: 35 }), 1], [sweep(sr, 0.15, 160, 60), 0.8]),
  playerDeath: (sr) => mix([sweep(sr, 1.6, 400, 40, { type: 'saw', decay: 1, noise: 0.4 }), 0.6], [boom(sr, 1.5, 36, 45), 0.6]),
  dryFire: (sr) => clicks(sr, [0], { hz: 5000, seed: 37, dur: 0.08 }),
  swap: (sr) => clicks(sr, [0, 0.12, 0.2], { hz: 2600, seed: 38, dur: 0.3 }),
  reloadSmg: (sr) => mix([clicks(sr, [0.05, 0.55, 0.62, 1.35, 1.42], { hz: 2400, seed: 39, dur: 1.55 }), 1], [noiseBurst(sr, 0.25, { lowHz: 2000, highHz: 600, decay: 0.08, seed: 40 }), 0.3, Math.floor(sr * 0.3)]),
  reloadRifle: (sr) => mix([clicks(sr, [0.1, 0.8, 0.9, 1.9, 2.05, 2.2], { hz: 1800, seed: 41, dur: 2.35 }), 1], [sweep(sr, 0.3, 300, 900, { type: 'tri' }), 0.15, Math.floor(sr * 1.9)]),
  meleeSwing: (sr) => noiseBurst(sr, 0.22, { lowHz: 400, highHz: 2500, attack: 0.08, decay: 0.06, band: true, seed: 42 }),
  meleeHit: (sr) => mix([boom(sr, 0.35, 43, 90), 0.8], [clicks(sr, [0], { hz: 1800, seed: 44, dur: 0.2 }), 0.6]),
  dash: (sr) => mix([noiseBurst(sr, 0.35, { lowHz: 300, highHz: 4000, attack: 0.02, decay: 0.1, band: true, seed: 45 }), 1], [sweep(sr, 0.3, 200, 700, { type: 'tri', decay: 2 }), 0.2]),
  jump: (sr) => mix([noiseBurst(sr, 0.4, { lowHz: 2500, highHz: 500, attack: 0.01, decay: 0.12, seed: 46 }), 1], [sweep(sr, 0.3, 120, 260, { type: 'saw', decay: 2 }), 0.25]),
  land: (sr) => mix([boom(sr, 0.25, 47, 60), 0.8], [noiseBurst(sr, 0.2, { lowHz: 1200, highHz: 200, decay: 0.05, seed: 48 }), 0.5]),
  coverIn: (sr) => mix([clicks(sr, [0, 0.04], { hz: 1200, seed: 49, dur: 0.2 }), 0.7], [noiseBurst(sr, 0.15, { lowHz: 800, highHz: 200, decay: 0.04, seed: 50 }), 0.6]),
  castPull: (sr) => mix([sweep(sr, 0.45, 300, 1200, { type: 'tri', attack: 0.05, decay: 2, vibrato: 0.03 }), 0.6], [noiseBurst(sr, 0.4, { lowHz: 3000, highHz: 400, attack: 0.05, decay: 0.15, band: true, seed: 51 }), 0.5]),
  castThrow: (sr) => mix([sweep(sr, 0.35, 900, 200, { type: 'saw', attack: 0.01, decay: 2 }), 0.4], [noiseBurst(sr, 0.35, { lowHz: 800, highHz: 4000, attack: 0.02, decay: 0.1, band: true, seed: 52 }), 0.7]),
  castCharge: (sr) => mix([sweep(sr, 0.5, 80, 600, { type: 'saw', attack: 0.02, decay: 2, noise: 0.3 }), 0.6], [noiseBurst(sr, 0.5, { lowHz: 400, highHz: 5000, attack: 0.05, decay: 0.2, band: true, seed: 53 }), 0.6]),
  pullHit: (sr) => mix([chime(sr, 0.9, 440, [1, 1.5, 2.25, 3], 0.3), 0.5], [sweep(sr, 0.8, 200, 900, { type: 'tri', attack: 0.1, decay: 3, vibrato: 0.05 }), 0.4]),
  throwHit: (sr) => mix([boom(sr, 0.5, 54, 70), 0.8], [noiseBurst(sr, 0.4, { lowHz: 5000, highHz: 500, decay: 0.08, seed: 55 }), 0.5]),
  chargeImpact: (sr) => mix([boom(sr, 0.9, 56, 45), 1], [chime(sr, 0.7, 330, [1, 2.4], 0.2), 0.3]),
  powerFizzle: (sr) => noiseBurst(sr, 0.3, { lowHz: 3000, highHz: 400, decay: 0.08, band: true, seed: 57 }),
  powerBlocked: (sr) => mix([sweep(sr, 0.25, 500, 180, { type: 'square', decay: 2 }), 0.4], [noiseBurst(sr, 0.2, { lowHz: 4000, highHz: 1500, decay: 0.05, band: true, seed: 58 }), 0.5]),
  /** The combo: a deep boom, a rising shimmer and a sustained choir-like chord. */
  combo: (sr) => {
    const dur = 3.2;
    const d = buf(sr, dur);
    const r = rng(59);
    let lp = 0;
    const chord = [146.83, 220, 293.66, 349.23, 440, 587.33];
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += (r() - lp) * lpk(sr, 150 + 6000 * Math.exp(-t * 6));
      const blast = lp * 2.4 * env(t, 0.002, 0.35);
      const sub = Math.sin(TAU * 38 * t * (1 + 3 * Math.exp(-t * 10))) * env(t, 0.002, 0.7) * 1.4;
      let pad = 0;
      chord.forEach((f, k) => {
        const det = 1 + (k % 2 ? 0.003 : -0.003);
        pad += (Math.sin(TAU * f * det * t) + Math.sin(TAU * f * 2.001 * t) * 0.3) * 0.18;
      });
      const padEnv = Math.min(1, t / 0.08) * Math.exp(-t / 1.3);
      const shimmer = Math.sin(TAU * (1200 + 1800 * Math.min(1, t * 2)) * t) * env(t, 0.05, 0.25) * 0.15;
      d[i] = softclip(blast + sub + pad * padEnv + shimmer, 1.2);
    }
    return normalize(d, 0.95);
  },
  deathGrunt: (sr) => mix([sweep(sr, 0.45, 260, 90, { type: 'saw', decay: 1.5, noise: 0.5, seed: 60 }), 0.5], [noiseBurst(sr, 0.3, { lowHz: 1200, highHz: 200, decay: 0.08, seed: 61 }), 0.6]),
  deathHeavy: (sr) => mix([boom(sr, 1.2, 62, 40), 0.9], [clicks(sr, [0.05, 0.12, 0.3], { hz: 1500, seed: 63, dur: 0.6 }), 0.4]),
  stomp: (sr) => mix([boom(sr, 1.0, 64, 35), 1], [noiseBurst(sr, 0.6, { lowHz: 1500, highHz: 150, decay: 0.15, seed: 65 }), 0.6]),
  whizz: (sr) => sweep(sr, 0.25, 2200, 900, { type: 'tri', attack: 0.08, decay: 2, noise: 0.6, seed: 66 }),
  uiMove: (sr) => chime(sr, 0.08, 1400, [1], 0.02),
  uiSelect: (sr) => mix([chime(sr, 0.25, 880, [1, 2], 0.06), 0.6], [chime(sr, 0.25, 1320, [1], 0.05), 0.4, Math.floor(sr * 0.05)]),
  uiBack: (sr) => chime(sr, 0.15, 600, [1, 2], 0.04),
  uiDeny: (sr) => sweep(sr, 0.15, 300, 200, { type: 'square', decay: 2 }),
  typeBlip: (sr) => chime(sr, 0.03, 1900, [1], 0.008),
  pickupAmmo: (sr) => clicks(sr, [0, 0.07, 0.14, 0.26], { hz: 2200, seed: 67, dur: 0.4 }),
  pickupHealth: (sr) => mix([chime(sr, 0.6, 523, [1, 1.5, 2], 0.15), 0.6], [chime(sr, 0.5, 784, [1], 0.12), 0.4, Math.floor(sr * 0.08)]),
  doorOpen: (sr) => mix([sweep(sr, 1.2, 60, 110, { type: 'saw', attack: 0.2, decay: 1.5, noise: 0.4 }), 0.6], [noiseBurst(sr, 1.2, { lowHz: 200, highHz: 900, attack: 0.3, decay: 0.4, seed: 68 }), 0.5]),
  checkpoint: (sr) => mix([chime(sr, 1.2, 392, [1, 1.5, 2, 3], 0.4), 0.6], [chime(sr, 1.0, 587, [1, 2], 0.3), 0.4, Math.floor(sr * 0.12)]),
  objective: (sr) => mix([chime(sr, 0.9, 494, [1, 2], 0.25), 0.5], [chime(sr, 0.8, 740, [1], 0.2), 0.5, Math.floor(sr * 0.1)]),
  bossRoar: (sr) => mix([sweep(sr, 2.0, 120, 50, { type: 'saw', attack: 0.15, decay: 1.2, noise: 0.8, vibrato: 0.04, seed: 69 }), 0.8], [boom(sr, 1.6, 70, 30), 0.5]),
  bossSlam: (sr) => mix([boom(sr, 1.6, 71, 28), 1], [noiseBurst(sr, 1.0, { lowHz: 2500, highHz: 150, decay: 0.2, seed: 72 }), 0.6]),
  bossCharge: (sr) => mix([sweep(sr, 1.1, 60, 300, { type: 'saw', attack: 0.9, decay: 6, noise: 0.4 }), 0.7], [sweep(sr, 1.1, 200, 1600, { type: 'tri', attack: 0.9, decay: 6, vibrato: 0.05 }), 0.3]),
  bossVolley: (sr) => mix([sweep(sr, 0.3, 900, 200, { type: 'square', decay: 2, noise: 0.5, seed: 73 }), 0.6], [boom(sr, 0.3, 74, 90), 0.5]),
  bossOrb: (sr) => mix([chime(sr, 0.8, 220, [1, 1.41, 2.8], 0.3), 0.6], [sweep(sr, 0.8, 150, 400, { type: 'tri', attack: 0.2, vibrato: 0.08 }), 0.4]),
  bossDrag: (sr) => mix([sweep(sr, 0.9, 800, 120, { type: 'saw', attack: 0.05, decay: 1, noise: 0.5, seed: 75 }), 0.6], [noiseBurst(sr, 0.9, { lowHz: 500, highHz: 3000, attack: 0.1, decay: 0.3, band: true, seed: 76 }), 0.5]),
  phaseChange: (sr) => mix([boom(sr, 2.2, 77, 32), 0.8], [chime(sr, 2.0, 147, [1, 1.5, 2, 2.67], 0.8), 0.5], [noiseBurst(sr, 2.0, { lowHz: 6000, highHz: 400, attack: 0.3, decay: 0.6, band: true, seed: 78 }), 0.3]),
  footstep: (sr) => mix([noiseBurst(sr, 0.09, { lowHz: 1800, highHz: 400, decay: 0.02, seed: 79 }), 0.7], [boom(sr, 0.09, 80, 90), 0.5]),
  hover: (sr) => noiseBurst(sr, 0.6, { lowHz: 900, highHz: 1100, attack: 0.05, decay: 0.4, band: true, seed: 81 }),
};
