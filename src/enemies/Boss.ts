import type { Game } from '../game/Game';
import type { Enemy } from './Enemy';

/** The Crocodile. Full implementation lands with the boss milestone. */
export class Boss {
  enemy: Enemy | null = null;
  active = false;

  constructor(private readonly game: Game) {}

  prepare(): void {}

  start(): void {
    this.active = true;
  }

  reset(): void {
    this.active = false;
  }

  headWorld(out: import('three').Vector3): import('three').Vector3 {
    return out.set(0, 12, -322);
  }

  setTalking(_t: boolean): void {}

  update(_dt: number): void {
    void this.game;
  }
}
