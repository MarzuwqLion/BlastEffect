import { CONFIG } from '../config';

/**
 * Game clock with hit-stop. `scale` drops briefly on kills and combos; the
 * camera and UI keep using real time so the freeze reads as impact.
 */
export class GameTime {
  /** Seconds of simulated (scaled) time. */
  now = 0;
  private stopT = 0;
  scale = 1;

  hitStop(duration: number): void {
    this.stopT = Math.max(this.stopT, duration);
  }

  /** Returns the scaled dt for this frame. */
  tick(realDt: number): number {
    if (this.stopT > 0) {
      this.stopT -= realDt;
      this.scale = CONFIG.feel.hitStopScale;
    } else {
      this.scale += (1 - this.scale) * Math.min(1, realDt * 30);
    }
    const dt = realDt * this.scale;
    this.now += dt;
    return dt;
  }

  reset(): void {
    this.stopT = 0;
    this.scale = 1;
  }
}
