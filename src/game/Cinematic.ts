import * as THREE from 'three';
import { VOICES, voiceFor } from '../audio/manifest';
import { SPEAKERS, UI } from '../strings';
import { glyph } from '../ui/glyph';
import type { Game } from './Game';

type V3 = readonly [number, number, number];

/** A caption during a shot: `at` seconds in, optionally spoken by someone. */
export interface CineLine {
  at: number;
  /** Speaker label and voice (a key of VOICES); omit for a plain caption. */
  who?: string;
  text: string;
}

export interface CineShot {
  dur: number;
  /** Camera position and look-at point, from → to across the shot. */
  pos: [V3, V3];
  look: [V3, V3];
  fov?: [number, number];
  /** Movement curve (default: ease in and out). */
  ease?: 'linear' | 'inOut' | 'out';
  lines?: CineLine[];
  /** A title card held through the shot. */
  title?: { head: string; sub: string };
  /** Seconds fading in from black at the start / out to black at the end. */
  fadeIn?: number;
  fadeOut?: number;
  /** `skipped`: the scene was skipped and this shot never showed (set state, play nothing). */
  onStart?: (skipped: boolean) => void;
  /** Every frame: k is 0..1 through the shot, t its seconds. */
  onUpdate?: (k: number, t: number, dt: number) => void;
}

const SKIP_HOLD = 0.75;
const CPS = 36;

/**
 * Plays a list of camera shots with captions, letterboxed: the opening and
 * the ending. Hold confirm (or pause) to skip. The world keeps running
 * underneath; the game decides what updates while a cutscene is on.
 */
export class Cinematic {
  active = false;
  private shots: CineShot[] = [];
  private index = 0;
  private t = 0;
  private onDone: (() => void) | null = null;
  private skipT = 0;
  private skipHintT = 0;
  /** The key that started the scene must be let go before a hold counts as "skip". */
  private skipArmed = false;
  private line: CineLine | null = null;
  private lineShown = 0;
  private fadeOutT = -1;
  private readonly root: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly captionEl: HTMLDivElement;
  private readonly whoEl: HTMLSpanElement;
  private readonly textEl: HTMLSpanElement;
  private readonly titleEl: HTMLDivElement;
  private readonly skipEl: HTMLDivElement;
  private readonly skipFill: HTMLDivElement;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'cine';
    this.root.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div>';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'cine-title';
    this.captionEl = document.createElement('div');
    this.captionEl.className = 'cine-caption';
    this.whoEl = document.createElement('span');
    this.whoEl.className = 'who';
    this.textEl = document.createElement('span');
    this.textEl.className = 'text';
    this.captionEl.append(this.whoEl, this.textEl);
    this.skipEl = document.createElement('div');
    this.skipEl.className = 'cine-skip';
    this.skipFill = document.createElement('div');
    this.skipFill.className = 'fill';
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'cine-fade';
    this.root.append(this.titleEl, this.captionEl, this.skipEl, this.fadeEl);
    parent.appendChild(this.root);
    game.input.onDeviceChange(() => this.renderSkip());
  }

  private renderSkip(): void {
    this.skipEl.innerHTML = `<span>${glyph('uiConfirm', this.game.input.device)}${UI.holdToSkip}</span>`;
    this.skipEl.appendChild(this.skipFill);
  }

  play(shots: CineShot[], onDone: () => void): void {
    this.shots = shots;
    this.onDone = onDone;
    this.index = -1;
    this.active = true;
    this.skipT = 0;
    this.skipHintT = 0;
    this.skipArmed = false;
    this.fadeOutT = -1;
    this.fadeEl.style.opacity = shots[0]?.fadeIn ? '1' : '0';
    this.renderSkip();
    this.root.classList.add('show');
    this.skipEl.classList.remove('show');
    this.next();
    // The first frame must already be the first shot.
    this.frame(0);
  }

  private next(): void {
    this.index++;
    this.t = 0;
    this.setLine(null);
    const s = this.shots[this.index];
    if (!s) {
      this.finish();
      return;
    }
    if (s.title) {
      this.titleEl.innerHTML = `<div class="head">${s.title.head}</div><div class="sub">${s.title.sub}</div>`;
      this.titleEl.classList.add('show');
    } else {
      this.titleEl.classList.remove('show');
    }
    s.onStart?.(false);
  }

  private setLine(l: CineLine | null): void {
    this.line = l;
    this.lineShown = 0;
    this.captionEl.classList.toggle('show', !!l);
    if (l) {
      this.whoEl.textContent = l.who ? ((SPEAKERS as Record<string, string>)[l.who] ?? l.who) : '';
      this.whoEl.style.display = l.who ? '' : 'none';
      this.textEl.textContent = '';
    }
  }

  private finish(): void {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('show');
    this.titleEl.classList.remove('show');
    this.captionEl.classList.remove('show');
    // The overlay fades out with the letterbox (see .cine in the stylesheet).
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  /** Cut to black, run every remaining shot's set-up so the world ends in the right state, then finish. */
  skip(): void {
    if (!this.active || this.fadeOutT >= 0) return;
    this.fadeOutT = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    const input = this.game.input;
    // Hold to skip (so a stray press doesn't throw the scene away).
    const holding = input.isHeld('uiConfirm') || input.isHeld('pause') || input.isHeld('interact');
    if (!holding) this.skipArmed = true;
    if (holding && this.skipArmed) {
      this.skipHintT = 2.5;
      this.skipT += dt;
      if (this.skipT >= SKIP_HOLD) this.skip();
    } else {
      this.skipT = Math.max(0, this.skipT - dt * 3);
    }
    if (input.pressed('fire') || input.pressed('uiBack') || input.pressed('jump')) this.skipHintT = 2.5;
    this.skipHintT -= dt;
    this.skipEl.classList.toggle('show', this.skipHintT > 0);
    this.skipFill.style.transform = `scaleX(${Math.min(1, this.skipT / SKIP_HOLD).toFixed(3)})`;

    if (this.fadeOutT >= 0) {
      this.fadeOutT += dt;
      this.fadeEl.style.opacity = String(Math.min(1, this.fadeOutT / 0.35));
      if (this.fadeOutT >= 0.4) {
        // Let the shots that never played leave the world as they would have.
        for (let i = this.index; i < this.shots.length; i++) {
          const s = this.shots[i];
          if (i > this.index) s.onStart?.(true);
          s.onUpdate?.(1, s.dur, 0);
        }
        this.finish();
        return;
      }
      this.frame(0);
      return;
    }
    this.frame(dt);
  }

  private frame(dt: number): void {
    const s = this.shots[this.index];
    if (!s) return;
    this.t += dt;
    const k = Math.min(1, this.t / s.dur);
    const e = s.ease === 'linear' ? k : s.ease === 'out' ? 1 - (1 - k) * (1 - k) : k * k * (3 - 2 * k);
    this.pos.set(lerp(s.pos[0][0], s.pos[1][0], e), lerp(s.pos[0][1], s.pos[1][1], e), lerp(s.pos[0][2], s.pos[1][2], e));
    this.look.set(lerp(s.look[0][0], s.look[1][0], e), lerp(s.look[0][1], s.look[1][1], e), lerp(s.look[0][2], s.look[1][2], e));
    const fov = s.fov ? lerp(s.fov[0], s.fov[1], e) : 42;
    this.game.rig.cine(this.pos, this.look, fov);
    s.onUpdate?.(k, this.t, dt);

    // Captions: the latest line whose time has come, typed out in its speaker's voice.
    let cur: CineLine | null = null;
    for (const l of s.lines ?? []) if (this.t >= l.at) cur = l;
    if (cur !== this.line) this.setLine(cur);
    if (this.line && this.lineShown < this.line.text.length) {
      const before = Math.floor(this.lineShown);
      this.lineShown = Math.min(this.line.text.length, this.lineShown + dt * CPS);
      const now = Math.floor(this.lineShown);
      if (now !== before) {
        this.textEl.textContent = this.line.text.slice(0, now);
        const sound = voiceFor(this.line.text[now - 1] ?? ' ');
        if (this.line.who && sound && now % 4 === 0) this.game.audio.play(sound, { rate: VOICES[this.line.who] ?? 1 });
      }
    }

    // Fades.
    if (this.fadeOutT < 0) {
      let black = 0;
      if (s.fadeIn && this.t < s.fadeIn) black = 1 - this.t / s.fadeIn;
      if (s.fadeOut && this.t > s.dur - s.fadeOut) black = Math.max(black, (this.t - (s.dur - s.fadeOut)) / s.fadeOut);
      this.fadeEl.style.opacity = black.toFixed(3);
    }
    if (this.t >= s.dur) this.next();
  }
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
