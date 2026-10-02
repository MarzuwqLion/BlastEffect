import { settings, type Settings } from '../core/settings';
import { END_TEXT, NAMES, UI } from '../strings';
import type { Game } from '../game/Game';
import { ACTIONS, GAMEPAD, KEYBOARD, actionLabels, type Action } from '../input/bindings';
import type { QualityLevel } from '../config';

type Item =
  | { kind: 'button'; label: string; action: () => void }
  | { kind: 'toggle'; label: string; key: keyof Settings }
  | { kind: 'range'; label: string; key: keyof Settings; min: number; max: number; step: number; fmt?: (v: number) => string }
  | { kind: 'select'; label: string; key: keyof Settings; options: { value: string; label: string }[] };

interface Screen {
  el: HTMLDivElement;
  items: Item[];
  buttons: HTMLButtonElement[];
  focus: number;
  back?: () => void;
}

const ACTION_LABELS: Partial<Record<Action, string>> = {
  fire: 'Fire', aim: 'Aim / hover in air', reload: 'Reload', jump: 'Jump-jet / hover', sprint: 'Sprint', dash: 'Dash',
  power1: 'Ka Snare (primer)', power2: 'Ka Lance (detonator)', power3: 'Ka Surge (detonator)', melee: 'Melee',
  interact: 'Interact / talk', swapWeapon: 'Swap weapon', swapShoulder: 'Swap shoulder', pause: 'Pause',
};

/** Title, pause, settings, controls, death and end screens. Mouse, keyboard and gamepad. */
export class Menus {
  private readonly root: HTMLDivElement;
  private current: Screen | null = null;
  private readonly screens = new Map<string, Screen>();
  private pressAny: HTMLDivElement | null = null;
  private waitingAnyKey = false;
  private onAnyKey: (() => void) | null = null;

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    parent.appendChild(this.root);
    window.addEventListener('keydown', () => this.anyKey());
    window.addEventListener('mousedown', () => this.anyKey());
  }

  get open(): boolean {
    return this.current !== null;
  }

  get name(): string | null {
    for (const [k, s] of this.screens) if (s === this.current) return k;
    return null;
  }

  private anyKey(): void {
    if (!this.waitingAnyKey) return;
    this.waitingAnyKey = false;
    this.pressAny?.remove();
    this.pressAny = null;
    const cb = this.onAnyKey;
    this.onAnyKey = null;
    cb?.();
  }

  hide(): void {
    if (this.current) this.current.el.classList.remove('show');
    this.current = null;
  }

  private build(name: string, cls: string, title: string | null, items: Item[], opts: { back?: () => void; header?: string; footer?: string; menuClass?: string } = {}): Screen {
    const old = this.screens.get(name);
    old?.el.remove();
    const el = document.createElement('div');
    el.className = `screen ${cls}`;
    if (opts.header) el.insertAdjacentHTML('beforeend', opts.header);
    const menu = document.createElement('div');
    menu.className = `menu interactive ${opts.menuClass ?? ''}`;
    if (title) menu.insertAdjacentHTML('beforeend', `<h2>${title}</h2>`);
    const screen: Screen = { el, items, buttons: [], focus: 0, back: opts.back };
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'item';
      b.addEventListener('mouseenter', () => this.focus(screen, i));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.focus(screen, i);
        this.activate(screen, i, 1);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.activate(screen, i, -1);
      });
      menu.appendChild(b);
      screen.buttons.push(b);
    });
    if (opts.footer) menu.insertAdjacentHTML('beforeend', opts.footer);
    el.appendChild(menu);
    this.root.appendChild(el);
    this.screens.set(name, screen);
    this.render(screen);
    return screen;
  }

  private show(screen: Screen): void {
    if (this.current && this.current !== screen) this.current.el.classList.remove('show');
    this.current = screen;
    screen.el.classList.add('show');
    this.focus(screen, Math.min(screen.focus, screen.items.length - 1), true);
  }

  private label(it: Item): string {
    const s = settings.value;
    switch (it.kind) {
      case 'button':
        return `<span>${it.label}</span>`;
      case 'toggle':
        return `<span>${it.label}</span><span class="value">${s[it.key] ? UI.on : UI.off}</span>`;
      case 'range': {
        const v = s[it.key] as number;
        return `<span>${it.label}</span><span class="value"><span class="arrows">◂ </span>${it.fmt ? it.fmt(v) : v.toFixed(1)}<span class="arrows"> ▸</span></span>`;
      }
      case 'select': {
        const o = it.options.find((x) => x.value === s[it.key]);
        return `<span>${it.label}</span><span class="value"><span class="arrows">◂ </span>${o?.label ?? ''}<span class="arrows"> ▸</span></span>`;
      }
    }
  }

  private render(screen: Screen): void {
    screen.items.forEach((it, i) => (screen.buttons[i].innerHTML = this.label(it)));
  }

  private focus(screen: Screen, i: number, silent = false): void {
    if (screen.focus !== i && !silent) this.game.audio.play('uiMove');
    screen.focus = i;
    screen.buttons.forEach((b, k) => b.classList.toggle('focus', k === i));
  }

  private activate(screen: Screen, i: number, dir: number): void {
    const it = screen.items[i];
    const s = settings.value;
    switch (it.kind) {
      case 'button':
        this.game.audio.play('uiSelect');
        it.action();
        return;
      case 'toggle':
        settings.set(it.key, !s[it.key] as never);
        break;
      case 'range': {
        let v = (s[it.key] as number) + it.step * dir;
        if (v > it.max + 1e-6) v = it.min;
        if (v < it.min - 1e-6) v = it.max;
        settings.set(it.key, Math.round(v * 100) / 100 as never);
        break;
      }
      case 'select': {
        const idx = it.options.findIndex((o) => o.value === s[it.key]);
        const n = it.options.length;
        settings.set(it.key, it.options[(idx + dir + n) % n].value as never);
        break;
      }
    }
    this.game.audio.play('uiMove');
    this.render(screen);
  }

  update(): void {
    const s = this.current;
    if (!s) return;
    const input = this.game.input;
    const n = s.items.length;
    if (input.pressed('uiDown')) this.focus(s, (s.focus + 1) % n);
    if (input.pressed('uiUp')) this.focus(s, (s.focus + n - 1) % n);
    const it = s.items[s.focus];
    if (it && it.kind !== 'button') {
      if (input.pressed('uiRight')) this.activate(s, s.focus, 1);
      if (input.pressed('uiLeft')) this.activate(s, s.focus, -1);
    }
    if (input.pressed('uiConfirm') && it) this.activate(s, s.focus, 1);
    else if (input.pressed('uiBack') && s.back) {
      this.game.audio.play('uiBack');
      s.back();
    }
  }

  // ---- Screens ----

  showTitle(onStart: () => void): void {
    const header = `<div class="logo"><div class="glyphs">◈ ✦ ◈</div><h1>${NAMES.game.toUpperCase()}</h1><div class="sub">${NAMES.subtitle}</div></div><div class="blurb">${UI.titleBlurb}</div>`;
    const s = this.build('title', 'title-screen', null, [
      { kind: 'button', label: UI.start, action: onStart },
      { kind: 'button', label: UI.settings, action: () => this.showSettings(() => this.show(s)) },
      { kind: 'button', label: UI.controls, action: () => this.showControls(() => this.show(s)) },
    ], { header });
    this.show(s);
  }

  /** Before audio can start the browser needs a gesture. */
  waitForAnyKey(cb: () => void): void {
    this.waitingAnyKey = true;
    this.onAnyKey = cb;
    this.pressAny = document.createElement('div');
    this.pressAny.className = 'screen title-screen show';
    this.pressAny.innerHTML = `<div class="logo"><div class="glyphs">◈ ✦ ◈</div><h1>${NAMES.game.toUpperCase()}</h1><div class="sub">${NAMES.subtitle}</div></div><div class="press">${UI.pressStart}</div>`;
    this.root.appendChild(this.pressAny);
  }

  /** Gamepad buttons can also dismiss the press-any-key screen. */
  pollAnyKey(): void {
    if (this.waitingAnyKey && this.game.input.device === 'gamepad' && (this.game.input.pressed('uiConfirm') || this.game.input.pressed('pause'))) this.anyKey();
  }

  showPause(onResume: () => void, onRestart: () => void, onQuit: () => void): void {
    const s = this.build('pause', 'dim', UI.paused, [
      { kind: 'button', label: UI.resume, action: onResume },
      { kind: 'button', label: UI.restartCheckpoint, action: onRestart },
      { kind: 'button', label: UI.settings, action: () => this.showSettings(() => this.show(s)) },
      { kind: 'button', label: UI.controls, action: () => this.showControls(() => this.show(s)) },
      { kind: 'button', label: UI.quit, action: onQuit },
    ], { back: onResume, footer: `<div class="note">${UI.deviceHint}</div>` });
    s.focus = 0;
    this.show(s);
  }

  showSettings(back: () => void): void {
    const q: { value: QualityLevel; label: string }[] = [
      { value: 'low', label: UI.low }, { value: 'medium', label: UI.medium }, { value: 'high', label: UI.high },
    ];
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const s = this.build('settings', 'dim', UI.settings, [
      { kind: 'range', label: UI.sensitivity, key: 'sensitivity', min: 0.2, max: 3, step: 0.1 },
      { kind: 'toggle', label: UI.invertY, key: 'invertY' },
      { kind: 'range', label: UI.masterVolume, key: 'masterVolume', min: 0, max: 1, step: 0.1, fmt: pct },
      { kind: 'range', label: UI.musicVolume, key: 'musicVolume', min: 0, max: 1, step: 0.1, fmt: pct },
      { kind: 'range', label: UI.sfxVolume, key: 'sfxVolume', min: 0, max: 1, step: 0.1, fmt: pct },
      { kind: 'select', label: UI.quality, key: 'quality', options: q },
      { kind: 'select', label: UI.textSize, key: 'textSize', options: [{ value: 'small', label: UI.small }, { value: 'medium', label: UI.medium }, { value: 'large', label: UI.large }] },
      { kind: 'toggle', label: UI.aimAssist, key: 'aimAssist' },
      { kind: 'button', label: UI.back, action: back },
    ], { back });
    s.focus = 0;
    this.show(s);
  }

  showControls(back: () => void): void {
    let rows = `<div class="controls-grid"><span class="h"></span><span class="h">${UI.controlsKbm}</span><span class="h">${UI.controlsPad}</span>`;
    rows += `<span>Move / look</span><span><span class="key">WASD</span> <span class="key">Mouse</span></span><span><span class="key">LS</span> <span class="key">RS</span></span>`;
    for (const a of ACTIONS) {
      const label = ACTION_LABELS[a];
      if (!label || !KEYBOARD[a].length) continue;
      const kb = actionLabels(a, 'kbm').map((x) => `<span class="key">${x}</span>`).join(' ');
      const pad = GAMEPAD[a].length ? actionLabels(a, 'gamepad').map((x) => `<span class="key pad shoulder">${x}</span>`).join(' ') : '';
      rows += `<span>${label}</span><span>${kb}</span><span>${pad}</span>`;
    }
    rows += '</div><div class="note">No cover button: with your weapon out, move into low walls and pillars. Aim to pop out. Gamepad: click L3 to toggle sprint.</div>';
    const s = this.build('controls', 'dim', UI.controls, [{ kind: 'button', label: UI.back, action: back }], { back, header: '', footer: rows });
    this.show(s);
  }

  showDeath(onRetry: () => void, onQuit: () => void): void {
    const s = this.build('death', 'dim death-screen', UI.deathTitle, [
      { kind: 'button', label: UI.retry, action: onRetry },
      { kind: 'button', label: UI.quit, action: onQuit },
    ], { footer: `<div class="note">${UI.deathBody}</div>` });
    s.focus = 0;
    this.show(s);
  }

  showEnd(onAgain: () => void): void {
    const flags = this.game.director.flags as Set<string>;
    const paras = END_TEXT.filter((p) => (!p.flag || flags.has(p.flag)) && (!p.not || !flags.has(p.not))).map((p) => `<p>${p.text}</p>`).join('');
    const s = this.build('end', 'dim end-screen', UI.endTitle, [{ kind: 'button', label: UI.playAgain, action: onAgain }], {
      header: '',
      footer: `${paras}<div class="note">${UI.endCredits}</div>`,
    });
    // Put the text above the button.
    const menu = s.el.querySelector('.menu')!;
    const btn = s.buttons[0];
    menu.appendChild(btn);
    this.show(s);
  }
}
