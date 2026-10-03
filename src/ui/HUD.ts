import * as THREE from 'three';
import { CONFIG } from '../config';
import { ENEMY_NAMES, POWER_NAMES, PROMPTS, UI, WEAPON_NAMES } from '../strings';
import type { Game } from '../game/Game';
import type { Enemy } from '../enemies/Enemy';
import type { Layer } from '../combat/damage';
import { HIT_X, LAYER_ICON, POWER_ICON, layerIcon } from './icons';
import { glyph, withGlyphs } from './glyph';
import { POWER_ORDER } from '../player/Powers';
import type { PowerId } from '../character/types';

const BAR_POOL = 10;
const NUM_POOL = 14;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

interface EnemyBar {
  root: HTMLDivElement;
  name: HTMLDivElement;
  rows: Record<Layer, { row: HTMLDivElement; fill: HTMLDivElement }>;
  enemy: Enemy | null;
  shown: boolean;
}

interface DmgNum {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  active: boolean;
}

/**
 * The in-game HUD (DOM). Writes only when values change. Enemy bars and
 * damage numbers are pooled.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly shieldFill: HTMLDivElement;
  private readonly shieldGhost: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthGhost: HTMLDivElement;
  private readonly healthBar: HTMLDivElement;
  private readonly shieldNum: HTMLSpanElement;
  private readonly healthNum: HTMLSpanElement;
  private readonly weaponName: HTMLDivElement;
  private readonly ammoEl: HTMLDivElement;
  private readonly magEl: HTMLSpanElement;
  private readonly reserveEl: HTMLSpanElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly reloadBar: HTMLDivElement;
  private readonly swapHint: HTMLDivElement;
  private readonly powers: Record<PowerId, { root: HTMLDivElement; sweep: HTMLDivElement; secs: HTMLDivElement; key: HTMLDivElement }> = {} as never;
  private readonly crosshair: HTMLDivElement;
  private readonly lines: HTMLDivElement[] = [];
  private readonly hitmarker: HTMLDivElement;
  private readonly hitIcon: HTMLDivElement;
  private readonly calloutEl: HTMLDivElement;
  private readonly dmgArcs: HTMLDivElement[] = [];
  private readonly vignettes: Record<'health' | 'shield' | 'combo' | 'hover', HTMLDivElement> = {} as never;
  private readonly bars: EnemyBar[] = [];
  private readonly nums: DmgNum[] = [];
  private readonly bossBar: HTMLDivElement;
  private readonly bossRows: Record<Layer, { row: HTMLDivElement; fill: HTMLDivElement }> = {} as never;
  private readonly bossPhase: HTMLSpanElement;
  private readonly bossName: HTMLSpanElement;
  private readonly objective: HTMLDivElement;
  private readonly objText: HTMLDivElement;
  private readonly objSecondary: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly markerDist: HTMLDivElement;
  private readonly weakMarker: HTMLDivElement;
  private readonly promptsBox: HTMLDivElement;
  private readonly context: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly logTitle: HTMLDivElement;
  private readonly logText: HTMLDivElement;
  private logFull = '';
  private logShown = 0;
  private logT = 0;
  private readonly subtitle: HTMLDivElement;

  private hitT = 0;
  private calloutT = 0;
  private toastT = 0;
  /** Toasts raised while the HUD is hidden (in a conversation) wait their turn. */
  private readonly toastQueue: string[] = [];
  private subtitleT = 0;
  private readonly arcT = [0, 0, 0, 0];
  private readonly arcAngle = [0, 0, 0, 0];
  private arcCursor = 0;
  private flashT = { shield: 0, combo: 0 };
  private last: Record<string, string | number> = {};
  private activePrompts: { el: HTMLDivElement; key: string; t: number }[] = [];
  private contextKey: string | null = null;
  boss: Enemy | null = null;
  private visible = true;

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.root = el('div', 'hud', parent);

    // Defenses.
    const def = el('div', 'defenses', this.root);
    const shieldRow = el('div', 'bar-row', def);
    shieldRow.innerHTML = layerIcon('shield');
    const sb = el('div', 'bar shield', shieldRow);
    this.shieldGhost = el('div', 'ghost', sb);
    this.shieldFill = el('div', 'fill', sb);
    this.shieldNum = el('span', 'num', shieldRow);
    const healthRow = el('div', 'bar-row', def);
    healthRow.innerHTML = layerIcon('health');
    this.healthBar = el('div', 'bar health', healthRow);
    this.healthGhost = el('div', 'ghost', this.healthBar);
    this.healthFill = el('div', 'fill', this.healthBar);
    this.healthNum = el('span', 'num', healthRow);

    // Powers.
    const pw = el('div', 'powers', this.root);
    for (const id of POWER_ORDER) {
      const root = el('div', 'power ready', pw);
      const tile = el('div', 'tile', root, POWER_ICON[id]);
      const sweep = el('div', 'sweep', tile);
      const secs = el('div', 'secs', tile);
      el('div', 'role', root, POWER_NAMES[id].name);
      const key = el('div', 'key-holder', root);
      this.powers[id] = { root, sweep, secs, key };
    }

    // Weapon.
    const wp = el('div', 'weapon-panel', this.root);
    this.weaponName = el('div', 'name', wp);
    this.ammoEl = el('div', 'ammo', wp);
    this.magEl = el('span', 'mag', this.ammoEl);
    this.reserveEl = el('span', 'reserve', this.ammoEl);
    this.reloadBar = el('div', 'reload', wp);
    this.reloadFill = el('div', 'fill', this.reloadBar);
    this.swapHint = el('div', 'swap', wp);

    // Crosshair + hit marker.
    this.crosshair = el('div', 'crosshair', this.root);
    for (let i = 0; i < 4; i++) this.lines.push(el('div', 'line', this.crosshair));
    el('div', 'dot', this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root, HIT_X);
    this.hitIcon = el('div', 'icon', this.hitmarker);
    this.calloutEl = el('div', 'callout', this.root);
    const dd = el('div', 'dmg-dir', this.root);
    for (let i = 0; i < 4; i++) this.dmgArcs.push(el('div', 'arc', dd));

    // Vignettes.
    for (const k of ['health', 'shield', 'combo', 'hover'] as const) this.vignettes[k] = el('div', `vignette ${k}`, this.root);

    // Enemy bars.
    for (let i = 0; i < BAR_POOL; i++) {
      const root = el('div', 'ebar', this.root);
      const name = el('div', 'name', root);
      el('div', 'primed', root, UI.primed);
      const rows = {} as EnemyBar['rows'];
      for (const layer of ['shield', 'armor', 'health'] as Layer[]) {
        const row = el('div', `row ${layer}`, root, layerIcon(layer));
        const track = el('div', 'track', row);
        rows[layer] = { row, fill: el('div', 'fill', track) };
      }
      this.bars.push({ root, name, rows, enemy: null, shown: false });
    }
    for (let i = 0; i < NUM_POOL; i++) this.nums.push({ el: el('div', 'dmgnum', this.root), pos: new THREE.Vector3(), t: 0, active: false });
    this.weakMarker = el('div', 'weak-marker', this.root, `<span class="t">${UI.weakPoint}</span>`);

    // Boss bar.
    this.bossBar = el('div', 'bossbar', this.root);
    const title = el('div', 'title', this.bossBar);
    this.bossName = el('span', '', title, ENEMY_NAMES.boss);
    this.bossPhase = el('span', 'phase', title);
    for (const layer of ['shield', 'armor', 'health'] as Layer[]) {
      const row = el('div', `row ${layer}`, this.bossBar, layerIcon(layer));
      const track = el('div', 'track', row);
      this.bossRows[layer] = { row, fill: el('div', 'fill', track) };
    }

    // Objective + marker.
    this.objective = el('div', 'objective', this.root);
    el('div', 'head', this.objective, UI.objective);
    this.objText = el('div', 'text', this.objective);
    this.objSecondary = el('div', 'secondary', this.objective);
    this.marker = el('div', 'marker', this.root);
    el('div', 'diamond', this.marker);
    this.markerDist = el('div', 'dist', this.marker);

    this.promptsBox = el('div', 'prompts', this.root);
    this.context = el('div', 'context', this.root);
    this.toastEl = el('div', 'toast', this.root);
    this.logEl = el('div', 'holo-log', this.root);
    this.logTitle = el('div', 'title', this.logEl);
    this.logText = el('div', 'text', this.logEl);
    this.subtitle = el('div', 'subtitle', this.root);

    game.input.onDeviceChange(() => this.refreshGlyphs());
    this.refreshGlyphs();
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (v && this.toastT <= 0 && this.toastQueue.length) this.toast(this.toastQueue.shift()!);
  }

  private set(key: string, value: string | number, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  refreshGlyphs(): void {
    const d = this.game.input.device;
    const keys: Record<PowerId, 'power1' | 'power2' | 'power3'> = { pull: 'power1', throw: 'power2', charge: 'power3' };
    for (const id of POWER_ORDER) this.powers[id].key.innerHTML = glyph(keys[id], d);
    this.swapHint.innerHTML = `${glyph('swapWeapon', d)} <span class="alt"></span>`;
    this.last.weapon = '';
    for (const p of this.activePrompts) p.el.innerHTML = this.promptHtml(p.key);
    if (this.contextKey) this.contextPrompt(this.contextKey, true);
  }

  private promptHtml(key: string): string {
    const d = this.game.input.device;
    let tpl = (PROMPTS as Record<string, string>)[key] ?? key;
    if (key === 'sprint' && d === 'gamepad') tpl = PROMPTS.sprintPad;
    return withGlyphs(tpl, d);
  }

  // ---- Events from gameplay ----

  playerHit(from: THREE.Vector3 | null, _layer: Layer, _amount: number): void {
    if (!from) return;
    const cam = this.game.rig.camera;
    _v.copy(from).sub(cam.position);
    const yaw = Math.atan2(-_v.x, -_v.z);
    let rel = yaw - this.game.rig.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const i = this.arcCursor;
    this.arcCursor = (this.arcCursor + 1) % this.dmgArcs.length;
    this.arcT[i] = 1.2;
    this.arcAngle[i] = -rel;
  }

  flash(kind: 'shield' | 'combo'): void {
    this.flashT[kind] = 1;
  }

  hitMarker(layer: Layer, killed: boolean, crit: boolean): void {
    this.hitT = CONFIG.feel.hitMarkerTime * (killed ? 2 : 1);
    const color = killed ? '#ff4a3a' : layer === 'shield' ? '#7cc8ff' : layer === 'armor' ? '#ffd24a' : crit ? '#ffe680' : '#ffffff';
    this.hitmarker.style.color = color;
    this.hitmarker.style.transform = killed ? 'scale(1.35) rotate(45deg)' : crit ? 'scale(1.15)' : 'scale(1)';
    this.hitIcon.innerHTML = killed ? '' : LAYER_ICON[layer];
    this.hitIcon.style.color = color;
    this.hitmarker.classList.add('show');
  }

  damageNumber(point: THREE.Vector3, amount: number, layer: Layer, crit: boolean): void {
    const n = this.nums.find((x) => !x.active) ?? this.nums[0];
    n.active = true;
    n.t = 0;
    n.pos.copy(point);
    n.pos.x += (Math.random() - 0.5) * 0.4;
    n.el.textContent = String(Math.round(amount));
    n.el.className = `dmgnum ${layer}${crit ? ' crit' : ''}`;
  }

  callout(kind: 'combo' | 'primed', sub: string): void {
    const text = kind === 'combo' ? UI.combo : UI.primed;
    const subText = (UI as Record<string, string>)[sub] ?? '';
    this.calloutEl.innerHTML = `${text}${kind === 'combo' ? `<span class="sub">${subText}</span>` : ''}`;
    this.calloutEl.style.color = kind === 'combo' ? '#7ff0ff' : '#46e6ff';
    this.calloutT = kind === 'combo' ? 1.6 : 0.9;
    this.calloutEl.classList.add('show');
    if (kind === 'combo') this.flash('combo');
  }

  powerDenied(id: PowerId, reason: 'cooldown' | 'noTarget' = 'cooldown'): void {
    const p = this.powers[id].root;
    p.classList.remove('denied');
    void p.offsetWidth;
    p.classList.add('denied');
    if (reason === 'noTarget') {
      this.calloutEl.innerHTML = UI.noTarget;
      this.calloutEl.style.color = '#ff8a6a';
      this.calloutT = 0.7;
      this.calloutEl.classList.add('show');
    }
  }

  blocked(_e: Enemy, layer: 'shield' | 'armor'): void {
    this.calloutEl.innerHTML = `${layer === 'shield' ? UI.blockedShield : UI.blockedArmor}`;
    this.calloutEl.style.color = layer === 'shield' ? '#7cc8ff' : '#ffd24a';
    this.calloutT = 1.1;
    this.calloutEl.classList.add('show');
  }

  toast(text: string): void {
    if (!this.visible || (this.toastT > 0.8 && this.toastEl.textContent !== text && this.toastQueue.length < 3)) {
      if (!this.toastQueue.includes(text)) this.toastQueue.push(text);
      return;
    }
    this.toastEl.textContent = text;
    this.toastT = 2.6;
    this.toastEl.classList.add('show');
  }

  /** A recording or letter of Mari's: typed out in a side panel, then fades. */
  showLog(title: string, text: string, counter?: string): void {
    this.logTitle.textContent = counter ? `${title}  ·  ${counter}` : title;
    this.logFull = text;
    this.logShown = 0;
    this.logText.textContent = '';
    this.logT = 3.5 + text.length * 0.055;
    this.logEl.classList.add('show');
  }

  get logVisible(): boolean {
    return this.logT > 0;
  }

  bark(who: string, text: string): void {
    this.subtitle.innerHTML = `<span class="who">${who}:</span>${text}`;
    this.subtitleT = 2.5;
    this.subtitle.classList.add('show');
  }

  /** Tutorial prompt, shown for `duration` seconds. */
  prompt(key: string, duration: number): void {
    if (this.activePrompts.some((p) => p.key === key)) return;
    const e = el('div', 'prompt', this.promptsBox, this.promptHtml(key));
    requestAnimationFrame(() => e.classList.add('show'));
    this.activePrompts.push({ el: e, key, t: duration });
    while (this.activePrompts.length > 3) this.removePrompt(this.activePrompts[0]);
  }

  private removePrompt(p: { el: HTMLDivElement }): void {
    p.el.classList.remove('show');
    setTimeout(() => p.el.remove(), 400);
    this.activePrompts = this.activePrompts.filter((x) => x !== p);
  }

  clearPrompts(): void {
    for (const p of [...this.activePrompts]) this.removePrompt(p);
  }

  contextPrompt(key: string | null, force = false): void {
    if (key === this.contextKey && !force) return;
    this.contextKey = key;
    if (!key) {
      this.context.classList.remove('show');
      return;
    }
    this.context.innerHTML = this.promptHtml(key);
    this.context.classList.add('show');
  }

  setObjective(text: string): void {
    this.objText.textContent = text;
    this.objSecondary.textContent = '';
    this.objective.classList.remove('flash');
    void this.objective.offsetWidth;
    this.objective.classList.add('flash');
  }

  setSecondary(text: string): void {
    this.objSecondary.textContent = text;
  }

  setBoss(e: Enemy | null): void {
    this.boss = e;
    this.bossBar.classList.toggle('show', !!e);
  }

  // ---- Per frame ----

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const P = CONFIG.player;

    // Defenses.
    const sh = p.shield / p.shieldMax;
    const hp = p.health / P.healthMax;
    this.set('sh', Math.round(sh * 200), () => {
      this.shieldFill.style.transform = `scaleX(${sh})`;
      this.shieldGhost.style.transform = `scaleX(${sh})`;
      this.shieldNum.textContent = String(Math.ceil(p.shield));
    });
    this.set('hp', Math.round(hp * 200), () => {
      this.healthFill.style.transform = `scaleX(${hp})`;
      this.healthGhost.style.transform = `scaleX(${hp})`;
      this.healthNum.textContent = String(Math.ceil(p.health));
      this.healthBar.classList.toggle('low', hp < CONFIG.feel.lowHealthFraction);
    });

    // Weapon.
    const w = p.weapons;
    const ws = w.state;
    this.set('weapon', w.current, () => {
      this.weaponName.textContent = WEAPON_NAMES[w.current];
      const alt = this.swapHint.querySelector('.alt');
      if (alt) alt.textContent = WEAPON_NAMES[w.current === 'smg' ? 'rifle' : 'smg'];
    });
    this.set('mag', ws.mag, () => {
      this.magEl.textContent = String(ws.mag);
      this.ammoEl.classList.toggle('low', ws.mag <= ws.cfg.magSize * 0.25);
    });
    this.set('res', ws.reserve, () => (this.reserveEl.textContent = `/ ${ws.reserve}`));
    const rp = w.isReloading ? w.reloadProgress : 0;
    this.set('reload', Math.round(rp * 50), () => {
      this.reloadFill.style.transform = `scaleX(${rp})`;
      this.reloadBar.style.opacity = w.isReloading ? '1' : '0';
    });

    // Powers.
    for (const id of POWER_ORDER) {
      const f = p.powers.cooldownFraction(id);
      const ui = this.powers[id];
      this.set(`pw-${id}`, Math.round(f * 100), () => {
        ui.sweep.style.setProperty('--cd', `${f * 100}%`);
        ui.secs.textContent = f > 0 ? String(Math.ceil(p.powers.cooldown[id])) : '';
        ui.root.classList.toggle('ready', f <= 0);
      });
    }

    // Crosshair: lines spread with the cone angle.
    const cam = g.rig.camera;
    const halfH = window.innerHeight / 2;
    const spread = Math.tan(w.spreadDeg * (Math.PI / 180)) / Math.tan((cam.fov * Math.PI) / 360) * halfH;
    const gap = Math.max(4, spread);
    this.set('gap', Math.round(gap), () => {
      const len = 7;
      const [t, r, b, l] = this.lines;
      t.style.cssText = `left:-1px;top:${-gap - len}px;width:2px;height:${len}px`;
      b.style.cssText = `left:-1px;top:${gap}px;width:2px;height:${len}px`;
      l.style.cssText = `left:${-gap - len}px;top:-1px;width:${len}px;height:2px`;
      r.style.cssText = `left:${gap}px;top:-1px;width:${len}px;height:2px`;
    });
    const showCross = p.alive && g.state === 'playing' && g.rig.mode === 'gameplay' && !p.sprinting;
    this.set('xh', showCross ? 1 : 0, () => this.crosshair.classList.toggle('hidden', !showCross));
    // Red crosshair over enemies.
    const over = g.enemies.findTargetInCone(g.rig.aimOrigin, g.rig.aimDir, 1.2, 120);
    this.set('xt', over ? 1 : 0, () => this.crosshair.classList.toggle('target', !!over));
    if (over) over.barT = Math.max(over.barT, 0.5);

    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitmarker.classList.remove('show');
    }
    if (this.calloutT > 0) {
      this.calloutT -= dt;
      if (this.calloutT <= 0) this.calloutEl.classList.remove('show');
    }
    if (this.logT > 0) {
      this.logT -= dt;
      if (this.logShown < this.logFull.length) {
        this.logShown = Math.min(this.logFull.length, this.logShown + dt * 55);
        this.logText.textContent = this.logFull.slice(0, Math.floor(this.logShown));
      }
      if (this.logT <= 0) this.logEl.classList.remove('show');
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) {
        this.toastEl.classList.remove('show');
        if (this.visible && this.toastQueue.length) this.toast(this.toastQueue.shift()!);
      }
    }
    if (this.subtitleT > 0) {
      this.subtitleT -= dt;
      if (this.subtitleT <= 0) this.subtitle.classList.remove('show');
    }
    for (let i = 0; i < this.dmgArcs.length; i++) {
      if (this.arcT[i] <= 0) continue;
      this.arcT[i] -= dt;
      const a = this.dmgArcs[i];
      a.style.opacity = String(Math.max(0, Math.min(1, this.arcT[i])));
      a.style.transform = `rotate(${this.arcAngle[i]}rad)`;
    }

    // Vignettes.
    const low = p.alive ? Math.max(0, 1 - hp / CONFIG.feel.lowHealthFraction) : 1;
    const hitPulse = p.lastHitAgo < 0.3 && p.shield <= 0 ? 0.5 * (1 - p.lastHitAgo / 0.3) : 0;
    this.vignettes.health.style.opacity = String(Math.min(1, low * (0.6 + 0.4 * Math.sin(g.time.now * 6)) + hitPulse));
    this.flashT.shield = Math.max(0, this.flashT.shield - dt * 2.5);
    this.flashT.combo = Math.max(0, this.flashT.combo - dt * 2);
    this.vignettes.shield.style.opacity = String(this.flashT.shield);
    this.vignettes.combo.style.opacity = String(this.flashT.combo);
    this.vignettes.hover.style.opacity = p.hovering ? '1' : '0';

    // Prompts timeout.
    for (const pr of [...this.activePrompts]) {
      pr.t -= dt;
      if (pr.t <= 0) this.removePrompt(pr);
    }

    this.updateEnemyBars();
    this.updateNumbers(dt);
    this.updateMarker();
    this.updateBoss();
  }

  private project(p: THREE.Vector3, out: { x: number; y: number; vis: boolean }): void {
    _v.copy(p).project(this.game.rig.camera);
    out.vis = _v.z < 1 && _v.z > -1;
    out.x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  }

  private readonly proj = { x: 0, y: 0, vis: false };

  private updateEnemyBars(): void {
    const g = this.game;
    // Choose enemies to show: damaged recently, primed, or under the crosshair.
    let i = 0;
    for (const e of g.enemies.active) {
      if (i >= this.bars.length) break;
      if (!e.alive || e.kind === 'boss') continue;
      if (e.barT <= 0 && !e.primed) continue;
      if (e.position.distanceTo(g.rig.camera.position) > CONFIG.ui.enemyBarRange) continue;
      const bar = this.bars[i++];
      if (bar.enemy !== e) {
        bar.enemy = e;
        bar.name.textContent = ENEMY_NAMES[e.kind];
        for (const layer of ['shield', 'armor', 'health'] as Layer[]) {
          const max = layer === 'shield' ? e.defenses.shieldMax : layer === 'armor' ? e.defenses.armorMax : e.defenses.healthMax;
          bar.rows[layer].row.style.display = max > 0 ? 'flex' : 'none';
        }
      }
      e.topPoint(_v2);
      this.project(_v2, this.proj);
      if (!this.proj.vis) {
        bar.root.classList.remove('show');
        continue;
      }
      bar.root.style.transform = `translate(${this.proj.x}px, ${this.proj.y}px) translate(-50%, -100%)`;
      const d = e.defenses;
      bar.rows.shield.fill.style.transform = `scaleX(${d.shieldMax ? d.shield / d.shieldMax : 0})`;
      bar.rows.armor.fill.style.transform = `scaleX(${d.armorMax ? d.armor / d.armorMax : 0})`;
      bar.rows.health.fill.style.transform = `scaleX(${d.health / d.healthMax})`;
      bar.root.classList.toggle('is-primed', e.primed);
      if (!bar.shown) {
        bar.shown = true;
        bar.root.classList.add('show');
      }
    }
    for (; i < this.bars.length; i++) {
      const bar = this.bars[i];
      if (bar.shown) {
        bar.shown = false;
        bar.enemy = null;
        bar.root.classList.remove('show');
      }
    }
  }

  private updateNumbers(dt: number): void {
    for (const n of this.nums) {
      if (!n.active) continue;
      n.t += dt;
      const life = CONFIG.feel.damageNumberTime;
      if (n.t >= life) {
        n.active = false;
        n.el.style.opacity = '0';
        continue;
      }
      _v2.copy(n.pos);
      _v2.y += n.t * 0.9;
      this.project(_v2, this.proj);
      n.el.style.opacity = this.proj.vis ? String(1 - (n.t / life) ** 2) : '0';
      n.el.style.transform = `translate(${this.proj.x}px, ${this.proj.y}px) translate(-50%, -50%)`;
    }
  }

  private updateMarker(): void {
    const g = this.game;
    const m = g.director.objectiveMarker;
    const show = !!m && g.state === 'playing' && g.rig.mode === 'gameplay';
    this.set('mk', show ? 1 : 0, () => (this.marker.style.opacity = show ? '1' : '0'));
    if (!show || !m) return;
    const cam = g.rig.camera;
    _v.copy(m).project(cam);
    const behind = _v.z > 1;
    let x = _v.x;
    let y = _v.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const margin = 0.9;
    if (behind || Math.abs(x) > margin || Math.abs(y) > margin) {
      const s = margin / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= s;
      y *= s;
    }
    const px = (x * 0.5 + 0.5) * window.innerWidth;
    const py = (-y * 0.5 + 0.5) * window.innerHeight;
    this.marker.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    const dist = Math.round(m.distanceTo(g.player.position));
    this.set('mkd', dist, () => (this.markerDist.textContent = `${dist}${UI.meters}`));
  }

  private updateBoss(): void {
    const b = this.boss;
    if (!b) {
      this.weakMarker.style.opacity = '0';
      return;
    }
    const d = b.defenses;
    for (const layer of ['shield', 'armor', 'health'] as Layer[]) {
      const max = layer === 'shield' ? d.shieldMax : layer === 'armor' ? d.armorMax : d.healthMax;
      const v = d[layer] / max;
      const r = this.bossRows[layer];
      this.set(`b-${layer}`, Math.round(v * 400), () => {
        r.fill.style.transform = `scaleX(${v})`;
        r.row.classList.toggle('done', v <= 0);
      });
    }
    const phase = d.shield > 0 ? 1 : d.armor > 0 ? 2 : 3;
    this.set('bphase', phase, () => (this.bossPhase.textContent = `${UI.phase} ${phase}/3`));
    void this.bossName;
    // Weak point marker (only when the intel marked it).
    if (this.game.director.flags.has('intel_weakpoint') && b.alive && b.weakPointActive) {
      b.model.weakWorld(_v2);
      this.project(_v2, this.proj);
      this.weakMarker.style.opacity = this.proj.vis ? '0.9' : '0';
      this.weakMarker.style.transform = `translate(${this.proj.x}px, ${this.proj.y}px) rotate(45deg)`;
    } else {
      this.weakMarker.style.opacity = '0';
    }
  }
}
