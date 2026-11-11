import { CONFIG } from '../config';

/**
 * Game clock with hit-stop. `scale` drops briefly on kills and combos; the
 * camera and UI keep using real time so the freeze reads as impact.
 */
export class GameTime {
  /** Seconds of simulated (scaled) time. */
  now = 0;
  private stopT = 0;
  private slowT = 0;
  private slowScale = 1;
  scale = 1;

  hitStop(duration: number): void {
    this.stopT = Math.max(this.stopT, duration);
  }

  /** Slow motion for `duration` real seconds (the last kill of a fight). */
  slowMo(duration: number, scale: number): void {
    this.slowT = Math.max(this.slowT, duration);
    this.slowScale = scale;
  }

  /** Returns the scaled dt for this frame. */
  tick(realDt: number): number {
    if (this.stopT > 0) {
      this.stopT -= realDt;
      this.scale = CONFIG.feel.hitStopScale;
    } else if (this.slowT > 0) {
      this.slowT -= realDt;
      // Ease in fast, ease out over the last third of a second.
      const target = this.slowT < 0.3 ? this.slowScale + (1 - this.slowScale) * (1 - this.slowT / 0.3) : this.slowScale;
      this.scale += (target - this.scale) * Math.min(1, realDt * 14);
    } else {
      this.scale += (1 - this.scale) * Math.min(1, realDt * 30);
    }
    const dt = realDt * this.scale;
    this.now += dt;
    return dt;
  }

  reset(): void {
    this.stopT = 0;
    this.slowT = 0;
    this.scale = 1;
  }
}
