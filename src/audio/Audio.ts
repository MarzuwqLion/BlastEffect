import * as THREE from 'three';
import { CONFIG } from '../config';
import { settings } from '../core/settings';
import { LOOPS, MUSIC, SOUNDS, type Bus, type LoopId, type MusicCue } from './manifest';
import { RECIPES } from './synth';
import { MusicEngine } from './music';

interface PlayOpts {
  at?: THREE.Vector3;
  volume?: number;
  rate?: number;
}

interface Stream {
  el: HTMLAudioElement;
  gain: GainNode;
  target: number;
  failed: boolean;
  stopTimer: number;
}

/**
 * Web Audio engine. Sound effects are decoded up front (files from the
 * manifest, synthesized placeholders for anything without one) and played
 * as one-shots with distance attenuation and panning. Music and looping
 * beds are streamed from <audio> elements through Web Audio, so a long track
 * costs no decode memory and only downloads when first needed.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly voices = new Map<string, number>();
  private music: MusicEngine | null = null;
  private readonly streams = new Map<string, Stream>();
  private wantedCue: MusicCue | 'silence' = 'silence';
  private readonly loopTargets = new Map<LoopId, number>();
  readonly listener = new THREE.Vector3();
  readonly listenerRight = new THREE.Vector3(1, 0, 0);
  private unlocked = false;
  private loading: Promise<void> | null = null;
  muted = false;

  constructor() {
    settings.onChange(() => this.applyVolumes());
  }

  /** Must be called from a user gesture (click/key/button). */
  unlock(): Promise<void> {
    if (this.unlocked) return this.loading ?? Promise.resolve();
    this.unlocked = true;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return Promise.resolve();
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.buses = { sfx: ctx.createGain(), ui: ctx.createGain(), music: ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.applyVolumes();
    this.music = new MusicEngine(ctx, this.buses.music);
    this.music.start();
    const cue = this.wantedCue;
    this.wantedCue = 'silence';
    this.setMusic(cue);
    for (const [id, v] of this.loopTargets) this.applyLoop(id, v);
    this.loading = this.loadAll();
    return this.loading;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings.value;
    this.master.gain.value = this.muted ? 0 : s.masterVolume;
    this.buses.sfx.gain.value = s.sfxVolume;
    this.buses.ui.gain.value = s.sfxVolume;
    this.buses.music.gain.value = s.musicVolume;
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx!;
    const base = import.meta.env.BASE_URL;
    const ids = Object.keys(SOUNDS);
    // Files first (in parallel); synth the rest in small slices so the page stays responsive.
    await Promise.all(
      ids.filter((id) => SOUNDS[id].src).map(async (id) => {
        const src = SOUNDS[id].src!;
        const files = Array.isArray(src) ? src : [src];
        try {
          const list = await Promise.all(files.map(async (f) => {
            const res = await fetch(base + f);
            if (!res.ok) throw new Error(`${res.status} ${f}`);
            return ctx.decodeAudioData(await res.arrayBuffer());
          }));
          this.buffers.set(id, list);
        } catch (e) {
          console.warn(`Audio file for ${id} failed, using placeholder`, e);
        }
      }),
    );
    for (const id of ids) {
      if (this.buffers.has(id)) continue;
      const recipe = RECIPES[id];
      if (!recipe) continue;
      const samples = recipe(ctx.sampleRate);
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(id, [b]);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3): void {
    this.listener.copy(pos);
    this.listenerRight.copy(right);
  }

  play(id: string, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers.get(id);
    const entry = SOUNDS[id];
    if (!list || !entry) return;
    const buffer = list.length === 1 ? list[0] : list[Math.floor(Math.random() * list.length)];
    const maxVoices = entry.voices ?? 4;
    const playing = this.voices.get(id) ?? 0;
    if (playing >= maxVoices) return;

    let gain = (entry.volume ?? 1) * (opts.volume ?? 1);
    let pan = 0;
    if (opts.at) {
      const dx = opts.at.x - this.listener.x;
      const dy = opts.at.y - this.listener.y;
      const dz = opts.at.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > CONFIG.audio.maxDistance) return;
      gain *= Math.min(1, CONFIG.audio.refDistance / Math.max(CONFIG.audio.refDistance, d)) * (1 - d / CONFIG.audio.maxDistance * 0.3);
      if (d > 0.5) pan = THREE.MathUtils.clamp((dx * this.listenerRight.x + dz * this.listenerRight.z) / d, -1, 1) * 0.75;
    }
    if (gain < 0.01) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const pv = entry.pitchVar ?? 0;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pv);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    let last: AudioNode = g;
    if (pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      last = p;
    }
    last.connect(this.buses[entry.bus ?? 'sfx']);
    this.voices.set(id, playing + 1);
    src.onended = () => this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 1) - 1));
    src.start();
  }

  // ---- Streams (music and loops) ----

  private stream(key: string, src: string, bus: GainNode): Stream {
    let s = this.streams.get(key);
    if (s) return s;
    const ctx = this.ctx!;
    const el = new Audio();
    el.src = import.meta.env.BASE_URL + src;
    el.loop = true;
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain);
    gain.connect(bus);
    const created: Stream = { el, gain, target: 0, failed: false, stopTimer: 0 };
    el.addEventListener('error', () => {
      created.failed = true;
      console.warn(`Streaming ${src} failed`);
      // A music cue that can't stream falls back to the procedural score.
      if (key === `m:${this.wantedCue}`) this.music?.setCue(this.wantedCue);
    });
    this.streams.set(key, created);
    s = created;
    return s;
  }

  private fade(s: Stream, volume: number, seconds: number, restart = false): void {
    const ctx = this.ctx!;
    s.target = volume;
    window.clearTimeout(s.stopTimer);
    s.gain.gain.cancelScheduledValues(ctx.currentTime);
    s.gain.gain.setValueAtTime(s.gain.gain.value, ctx.currentTime);
    s.gain.gain.setTargetAtTime(volume, ctx.currentTime, Math.max(0.005, seconds / 3));
    if (volume > 0) {
      if (s.el.paused) {
        if (restart) s.el.currentTime = 0;
        void s.el.play().catch(() => {});
      }
    } else {
      // Stop decoding once it has faded out.
      s.stopTimer = window.setTimeout(() => {
        if (s.target === 0) s.el.pause();
      }, seconds * 1000 + 600);
    }
  }

  /**
   * Switch music. Crossfades by default; `cut` drops the old track at once
   * (the club's sound system dying when the shooting starts).
   */
  setMusic(cue: MusicCue | 'silence', opts: { cut?: boolean; force?: boolean } = {}): void {
    if (cue === this.wantedCue && !opts.force) return;
    this.wantedCue = cue;
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [key, s] of this.streams) {
      if (key.startsWith('m:') && key !== `m:${cue}` && s.target > 0) this.fade(s, 0, opts.cut ? 0.05 : 1.6);
    }
    const entry = cue === 'silence' ? null : MUSIC[cue];
    if (entry?.src) {
      const s = this.stream(`m:${cue}`, entry.src, this.buses.music);
      if (!s.failed) {
        this.music?.setCue('silence');
        // Fights start from the top; everything else picks up where it left off.
        this.fade(s, entry.volume ?? 0.8, 1.2, cue === 'combat' || cue === 'boss');
        return;
      }
    }
    this.music?.setCue(cue);
  }

  /** Set a looping bed's level (0..1, times its manifest volume). Cheap to call every frame. */
  setLoop(id: LoopId, level: number): void {
    const prev = this.loopTargets.get(id) ?? 0;
    if (Math.abs(prev - level) < 0.02 && !(level === 0 && prev !== 0)) return;
    this.loopTargets.set(id, level);
    if (this.ctx) this.applyLoop(id, level);
  }

  private applyLoop(id: LoopId, level: number): void {
    const entry = LOOPS[id];
    const s = this.stream(`l:${id}`, entry.src, this.buses.sfx);
    if (s.failed) return;
    this.fade(s, level * (entry.volume ?? 1), 0.8);
  }

  /** Suspend everything (pause menu keeps music quieter rather than silent). */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    this.buses.sfx.gain.setTargetAtTime(paused ? 0 : settings.value.sfxVolume, this.ctx.currentTime, 0.05);
    this.buses.music.gain.setTargetAtTime(settings.value.musicVolume * (paused ? 0.4 : 1), this.ctx.currentTime, 0.2);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
