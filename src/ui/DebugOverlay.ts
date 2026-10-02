import { CONFIG } from '../config';
import type { Game } from '../game/Game';

/** Backtick overlay: fps, frame time, draw calls, triangles, active enemies. */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  visible = false;
  private acc = 0;
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private worstMs = 0;
  /** Peak draw calls / triangles seen while visible (for budget checks). */
  peakCalls = 0;
  peakTris = 0;

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug';
    parent.appendChild(this.el);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.classList.toggle('show', this.visible);
  }

  update(realDt: number): void {
    this.acc += realDt;
    this.frames++;
    this.frameMs = this.frameMs * 0.9 + realDt * 1000 * 0.1;
    this.worstMs = Math.max(this.worstMs * 0.995, realDt * 1000);
    const st = this.game.renderer.frameStats;
    this.peakCalls = Math.max(this.peakCalls, st.calls);
    this.peakTris = Math.max(this.peakTris, st.triangles);
    if (this.acc >= 0.25) {
      this.fps = this.frames / this.acc;
      this.acc = 0;
      this.frames = 0;
      if (!this.visible) return;
      const g = this.game;
      const q = g.renderer.quality;
      const overCalls = q === 'medium' && st.calls > CONFIG.budgets.mediumDrawCalls;
      const overTris = q === 'medium' && st.triangles > CONFIG.budgets.mediumTriangles;
      const p = g.player.position;
      this.el.innerHTML = [
        `fps        ${this.fps.toFixed(0)}`,
        `frame      ${this.frameMs.toFixed(1)} ms (worst ${this.worstMs.toFixed(1)})`,
        `<span class="${overCalls ? 'over' : ''}">draw calls ${st.calls}</span>`,
        `<span class="${overTris ? 'over' : ''}">triangles  ${(st.triangles / 1000).toFixed(0)}k</span>`,
        `enemies    ${g.enemies.aliveCount()} alive / ${g.enemies.active.length} active`,
        `tokens     ${g.enemies.tokens.inUse}/${g.enemies.tokens.max}`,
        `bolts      ${g.bolts.activeCount}`,
        `quality    ${q}`,
        `section    ${g.director.current}`,
        `pos        ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
        `god        ${g.player.god ? 'on' : 'off'}`,
      ].join('\n');
    }
  }

  get stats(): { fps: number; frameMs: number } {
    return { fps: this.fps, frameMs: this.frameMs };
  }
}
