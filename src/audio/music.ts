/**
 * Procedural placeholder score: a Phrygian-dominant (Hijaz) groove on D with
 * a drone pad, bass, arpeggio, darbuka-style percussion and a ney-like lead.
 * Each cue is a mix of layers and a tempo; changes land on bar lines.
 */

export interface CueMix {
  bpm: number;
  pad: number;
  bass: number;
  arp: number;
  drums: number;
  perc: number;
  lead: number;
  /** Low-pass cutoff on the whole score (Hz). */
  cutoff: number;
}

export const CUE_MIX: Record<string, CueMix> = {
  title: { bpm: 84, pad: 0.8, bass: 0.0, arp: 0.25, drums: 0, perc: 0.25, lead: 0.6, cutoff: 2400 },
  dock: { bpm: 84, pad: 0.7, bass: 0.2, arp: 0.2, drums: 0, perc: 0.35, lead: 0.5, cutoff: 2600 },
  explore: { bpm: 96, pad: 0.6, bass: 0.45, arp: 0.35, drums: 0.15, perc: 0.5, lead: 0.25, cutoff: 3500 },
  combat: { bpm: 112, pad: 0.45, bass: 0.8, arp: 0.6, drums: 0.8, perc: 0.7, lead: 0, cutoff: 9000 },
  boss: { bpm: 124, pad: 0.6, bass: 1, arp: 0.7, drums: 1, perc: 0.9, lead: 0.2, cutoff: 12000 },
  victory: { bpm: 80, pad: 0.9, bass: 0.2, arp: 0.2, drums: 0, perc: 0.1, lead: 0.7, cutoff: 3000 },
  silence: { bpm: 90, pad: 0, bass: 0, arp: 0, drums: 0, perc: 0, lead: 0, cutoff: 1000 },
};

const D = 146.83; // D3
const semis = (n: number): number => D * Math.pow(2, n / 12);
/** Chord progression (semitones from D): D, Eb, Cm, D. */
const CHORDS: number[][] = [
  [0, 4, 7],
  [1, 7, 10],
  [-2, 1, 5],
  [0, 4, 7],
];
const SCALE = [0, 1, 4, 5, 7, 8, 10, 12];
const ARP_PATTERN = [0, 2, 1, 2, 0, 3, 2, 1, 0, 2, 1, 2, 3, 2, 1, 0];
/** Maqsum-like darbuka: D = dum, T = tek, . = rest (16ths). */
const DARBUKA = 'D.T...T.D...T...';
const LEAD_PHRASE: [number, number][] = [
  // [scale degree, length in 16ths]
  [4, 6], [5, 2], [4, 4], [2, 4], [1, 6], [2, 2], [0, 8], [-1, 0],
];

export class MusicEngine {
  private readonly ctx: AudioContext;
  readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly layers: Record<keyof Omit<CueMix, 'bpm' | 'cutoff'>, GainNode>;
  private readonly delay: DelayNode;
  private readonly noise: AudioBuffer;
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private mix: CueMix = CUE_MIX.silence;
  private pendingMix: CueMix | null = null;
  private leadIdx = 0;
  private leadWait = 0;
  cue = 'silence';

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 3000;
    this.filter.connect(this.out);
    this.out.connect(destination);
    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.filter);
      return g;
    };
    this.layers = { pad: mk(), bass: mk(), arp: mk(), drums: mk(), perc: mk(), lead: mk() };
    // Echo for the arp and lead.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(wet);
    wet.connect(this.filter);
    // Shared noise buffer for percussion.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.startPad();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setCue(name: string): void {
    const mix = CUE_MIX[name];
    if (!mix || name === this.cue) return;
    this.cue = name;
    // Fades happen immediately; tempo changes on the next bar line.
    this.pendingMix = mix;
    const t = this.ctx.currentTime;
    for (const k of Object.keys(this.layers) as (keyof typeof this.layers)[]) {
      this.layers[k].gain.cancelScheduledValues(t);
      this.layers[k].gain.setTargetAtTime(mix[k], t, 1.2);
    }
    this.filter.frequency.setTargetAtTime(mix.cutoff, t, 1.5);
  }

  private startPad(): void {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 2;
    this.padFilter.connect(this.layers.pad);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(this.padFilter.frequency);
    lfo.start();
    for (let v = 0; v < 6; v++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (v % 2 ? 7 : -7) + v;
      const g = ctx.createGain();
      g.gain.value = 0.045;
      o.connect(g);
      g.connect(this.padFilter);
      o.start();
      this.padOscs.push(o);
    }
    this.setPadChord(0, ctx.currentTime);
    // Sub drone.
    const sub = ctx.createOscillator();
    sub.frequency.value = D / 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.12;
    sub.connect(sg);
    sg.connect(this.layers.pad);
    sub.start();
  }

  private setPadChord(idx: number, t: number): void {
    const chord = CHORDS[idx % CHORDS.length];
    this.padOscs.forEach((o, v) => {
      const n = chord[v % 3] + (v >= 3 ? 12 : 0);
      o.frequency.setTargetAtTime(semis(n), t, 0.4);
    });
  }

  private schedule(): void {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      const spb = 60 / this.mix.bpm / 4;
      this.nextTime += spb;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        if (this.pendingMix) {
          this.mix = this.pendingMix;
          this.pendingMix = null;
        }
        if (this.bar % 2 === 0) this.setPadChord(Math.floor(this.bar / 2), this.nextTime);
      }
    }
  }

  private playStep(step: number, t: number): void {
    const mix = this.mix;
    const chord = CHORDS[Math.floor(this.bar / 2) % CHORDS.length];
    const spb = 60 / mix.bpm / 4;
    // Bass: syncopated root/fifth.
    if (mix.bass > 0 && [0, 3, 6, 10, 12, 14].includes(step)) {
      const n = step === 10 || step === 14 ? chord[0] + 7 : chord[0];
      this.bass(semis(n - 12), t, spb * (step === 0 ? 2.5 : 1.5));
    }
    // Arp: 16ths over chord tones.
    if (mix.arp > 0 && (mix.bpm > 100 || step % 2 === 0)) {
      const deg = ARP_PATTERN[step];
      const n = deg < 3 ? chord[deg] + 12 : chord[0] + 24;
      this.pluck(semis(n), t, spb * 1.6);
    }
    // Drums.
    if (mix.drums > 0) {
      if (step === 0 || step === 8 || (step === 10 && this.bar % 2 === 1)) this.kick(t);
      if (step === 4 || step === 12) this.snare(t);
      if (step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.5 : 0.3);
    }
    // Darbuka.
    if (mix.perc > 0) {
      const c = DARBUKA[step];
      if (c === 'D') this.dum(t);
      else if (c === 'T') this.tek(t, 1);
      else if (mix.bpm > 100 && step % 4 === 3) this.tek(t, 0.4);
    }
    // Ney lead phrase every 4 bars.
    if (mix.lead > 0) {
      if (this.leadWait > 0) {
        this.leadWait--;
      } else if (this.bar % 4 === 0 || this.leadIdx > 0) {
        const [deg, len] = LEAD_PHRASE[this.leadIdx];
        if (len === 0) {
          this.leadIdx = 0;
          this.leadWait = 16 * 2;
        } else {
          const n = SCALE[(deg + SCALE.length) % SCALE.length] + 12;
          this.ney(semis(n), t, spb * len);
          this.leadWait = len - 1;
          this.leadIdx = (this.leadIdx + 1) % LEAD_PHRASE.length;
        }
      }
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private bass(f: number, t: number, len: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(900, t);
    flt.frequency.exponentialRampToValueAtTime(140, t + len);
    flt.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, 0.35, 0.005, len);
    o.connect(flt);
    flt.connect(g);
    g.connect(this.layers.bass);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private pluck(f: number, t: number, len: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.003, len);
    o.connect(g);
    g.connect(this.layers.arp);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private noiseHit(t: number, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.001, decay);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.8, 0.002, 0.28);
    o.connect(g);
    g.connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.35);
  }

  private snare(t: number): void {
    this.noiseHit(t, this.layers.drums, 'bandpass', 1800, 0.8, 0.35, 0.16);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.2, 0.001, 0.08);
    o.connect(g);
    g.connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, v: number): void {
    this.noiseHit(t, this.layers.drums, 'highpass', 7000, 0.5, 0.12 * v, 0.04);
  }

  private dum(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.45, 0.002, 0.25);
    o.connect(g);
    g.connect(this.layers.perc);
    o.start(t);
    o.stop(t + 0.3);
  }

  private tek(t: number, v: number): void {
    this.noiseHit(t, this.layers.perc, 'bandpass', 3200, 3, 0.25 * v, 0.05);
  }

  private ney(f: number, t: number, len: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.4, len * 0.6));
    vib.connect(vg);
    vg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.12);
    g.gain.setValueAtTime(0.11, t + Math.max(0.13, len - 0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
    o.connect(g);
    g.connect(this.layers.lead);
    g.connect(this.delay);
    o.start(t);
    vib.start(t);
    o.stop(t + len + 0.25);
    vib.stop(t + len + 0.25);
    // Breath.
    this.noiseHit(t, this.layers.lead, 'bandpass', f * 2, 4, 0.03, len * 0.8);
  }
}
