import * as THREE from 'three';
import { CONFIG } from '../config';
import { settings } from '../core/settings';
import { MUSIC, SOUNDS, type Bus, type MusicCue } from './manifest';
import { RECIPES } from './synth';
import { MusicEngine } from './music';

interface PlayOpts {
  at?: THREE.Vector3;
  volume?: number;
  rate?: number;
}

/**
 * Web Audio engine. Loads every sound through the manifest (file if `src`
 * is set, synthesized placeholder otherwise), plays one-shots with simple
 * distance attenuation and panning, and runs the music.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Map<string, number>();
  private music: MusicEngine | null = null;
  private musicFile: { cue: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private readonly fileMusic = new Map<string, AudioBuffer>();
  private wantedCue: MusicCue | 'silence' = 'silence';
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
    this.music.setCue(this.wantedCue);
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
        try {
          const res = await fetch(base + SOUNDS[id].src);
          const data = await res.arrayBuffer();
          this.buffers.set(id, await ctx.decodeAudioData(data));
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
      this.buffers.set(id, b);
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(
      Object.entries(MUSIC).filter(([, m]) => m.src).map(async ([cue, m]) => {
        try {
          const res = await fetch(base + m.src);
          this.fileMusic.set(cue, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (e) {
          console.warn(`Music file for ${cue} failed, using procedural score`, e);
        }
      }),
    );
    if (this.fileMusic.has(this.wantedCue)) this.setMusic(this.wantedCue, true);
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3): void {
    this.listener.copy(pos);
    this.listenerRight.copy(right);
  }

  play(id: string, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buffer = this.buffers.get(id);
    const entry = SOUNDS[id];
    if (!buffer || !entry) return;
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

  setMusic(cue: MusicCue | 'silence', force = false): void {
    if (cue === this.wantedCue && !force) return;
    this.wantedCue = cue;
    const ctx = this.ctx;
    if (!ctx) return;
    const file = this.fileMusic.get(cue);
    // Fade out any file track.
    if (this.musicFile && (this.musicFile.cue !== cue || force)) {
      const old = this.musicFile;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      old.src.stop(ctx.currentTime + 3);
      this.musicFile = null;
    }
    if (file) {
      this.music?.setCue('silence');
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(MUSIC[cue as MusicCue]?.volume ?? 0.8, ctx.currentTime, 0.8);
      src.connect(g);
      g.connect(this.buses.music);
      src.start();
      this.musicFile = { cue, src, gain: g };
    } else {
      this.music?.setCue(cue);
    }
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
