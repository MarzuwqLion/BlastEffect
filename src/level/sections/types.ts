import type { EnemyKind } from '../../enemies/EnemyModel';
import type { NavBounds } from '../nav';
import type { LevelBuilder } from '../LevelBuilder';
import type { MusicCue } from '../../audio/manifest';
import type { Director } from '../../game/Director';
import type { Game } from '../../game/Game';

export interface SpawnDef {
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  delay?: number;
}

export interface WaveDef {
  spawns: SpawnDef[];
  /** Start this wave once living enemies of the encounter drop to this many. */
  whenAliveAtMost?: number;
  delay?: number;
  hint?: string;
}

export interface EncounterDef {
  id: string;
  /** Player entering this box starts the encounter. [x0,y0,z0,x1,y1,z1] */
  trigger: [number, number, number, number, number, number];
  waves: WaveDef[];
  onStart?: (d: Director) => void;
  onClear?: (d: Director) => void;
}

export interface NpcDef {
  id: 'odette' | 'yaw';
  x: number;
  y: number;
  z: number;
  yaw: number;
  dialogue: string;
  /** Talk is only offered while this returns true. */
  available?: (d: Director) => boolean;
}

export interface SectionDef {
  index: number;
  name: string;
  checkpoint: { x: number; y: number; z: number; yaw: number };
  /** Entering this box makes the section current (and saves the checkpoint). */
  enter: [number, number, number, number, number, number];
  nav: NavBounds;
  music: MusicCue;
  objective: string;
  encounters: EncounterDef[];
  npcs?: NpcDef[];
  /** Points the objective marker can show, keyed by name. */
  markers?: Record<string, [number, number, number]>;
  build(b: LevelBuilder, game: Game): void;
  /** Called when the section becomes current (fresh or from checkpoint). */
  onEnter?: (d: Director) => void;
}
