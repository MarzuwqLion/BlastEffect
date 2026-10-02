/**
 * Every sound and music track goes through this manifest. To use your own
 * audio, drop a file in public/audio/ and set `src` (relative to the site
 * root, e.g. 'audio/smg.ogg'). Without `src`, the synthesized placeholder
 * from synth.ts (sounds) or music.ts (tracks) is used.
 */

export type Bus = 'sfx' | 'ui' | 'music';

export interface SoundEntry {
  src?: string;
  bus?: Bus;
  /** Base gain 0..1. */
  volume?: number;
  /** Random pitch variation (fraction, e.g. 0.06 = ±6%). */
  pitchVar?: number;
  /** Max simultaneous voices of this sound. */
  voices?: number;
}

export const SOUNDS: Record<string, SoundEntry> = {
  smgShot: { volume: 0.7, pitchVar: 0.05, voices: 6 },
  rifleShot: { volume: 0.9, pitchVar: 0.03, voices: 3 },
  gruntShot: { volume: 0.55, pitchVar: 0.08, voices: 8 },
  trooperShot: { volume: 0.5, pitchVar: 0.08, voices: 8 },
  heavyShot: { volume: 0.55, pitchVar: 0.06, voices: 8 },
  enemyCharge: { volume: 0.45, pitchVar: 0.05, voices: 4 },
  heavyWindup: { volume: 0.7, voices: 2 },
  impact: { volume: 0.5, pitchVar: 0.15, voices: 6 },
  impactHeavy: { volume: 0.6, pitchVar: 0.1, voices: 3 },
  hitFlesh: { volume: 0.6, pitchVar: 0.1, voices: 4, bus: 'ui' },
  hitShield: { volume: 0.5, pitchVar: 0.08, voices: 4, bus: 'ui' },
  hitArmor: { volume: 0.5, pitchVar: 0.08, voices: 4, bus: 'ui' },
  hitCrit: { volume: 0.6, pitchVar: 0.05, voices: 3, bus: 'ui' },
  killConfirm: { volume: 0.7, pitchVar: 0.04, voices: 3, bus: 'ui' },
  shieldBreak: { volume: 0.8, voices: 3 },
  armorBreak: { volume: 0.8, voices: 3 },
  shieldBreakPlayer: { volume: 0.8, voices: 1, bus: 'ui' },
  playerHitShield: { volume: 0.5, pitchVar: 0.1, voices: 3, bus: 'ui' },
  playerHitHealth: { volume: 0.6, pitchVar: 0.1, voices: 3, bus: 'ui' },
  playerDeath: { volume: 0.9, voices: 1, bus: 'ui' },
  dryFire: { volume: 0.6, voices: 1 },
  swap: { volume: 0.6, voices: 1 },
  reloadSmg: { volume: 0.6, voices: 1 },
  reloadRifle: { volume: 0.6, voices: 1 },
  meleeSwing: { volume: 0.6, pitchVar: 0.1, voices: 2 },
  meleeHit: { volume: 0.9, pitchVar: 0.05, voices: 2 },
  dash: { volume: 0.7, pitchVar: 0.06, voices: 2 },
  jump: { volume: 0.6, pitchVar: 0.06, voices: 2 },
  land: { volume: 0.5, pitchVar: 0.08, voices: 2 },
  coverIn: { volume: 0.45, pitchVar: 0.1, voices: 1 },
  castPull: { volume: 0.7, voices: 2 },
  castThrow: { volume: 0.7, voices: 2 },
  castCharge: { volume: 0.8, voices: 2 },
  pullHit: { volume: 0.8, voices: 2 },
  throwHit: { volume: 0.8, voices: 2 },
  chargeImpact: { volume: 1, voices: 2 },
  powerFizzle: { volume: 0.5, voices: 2 },
  powerBlocked: { volume: 0.7, voices: 2 },
  combo: { volume: 1, voices: 2 },
  deathGrunt: { volume: 0.6, pitchVar: 0.1, voices: 3 },
  deathHeavy: { volume: 0.8, voices: 2 },
  stomp: { volume: 0.9, voices: 2 },
  whizz: { volume: 0.45, pitchVar: 0.2, voices: 3, bus: 'ui' },
  uiMove: { volume: 0.35, voices: 2, bus: 'ui' },
  uiSelect: { volume: 0.5, voices: 2, bus: 'ui' },
  uiBack: { volume: 0.45, voices: 2, bus: 'ui' },
  uiDeny: { volume: 0.4, voices: 2, bus: 'ui' },
  typeBlip: { volume: 0.12, pitchVar: 0.1, voices: 2, bus: 'ui' },
  pickupAmmo: { volume: 0.7, voices: 1, bus: 'ui' },
  pickupHealth: { volume: 0.7, voices: 1, bus: 'ui' },
  doorOpen: { volume: 0.8, voices: 2 },
  checkpoint: { volume: 0.6, voices: 1, bus: 'ui' },
  objective: { volume: 0.55, voices: 1, bus: 'ui' },
  bossRoar: { volume: 1, voices: 1 },
  bossSlam: { volume: 1, voices: 2 },
  bossCharge: { volume: 0.8, voices: 2 },
  bossVolley: { volume: 0.8, voices: 2 },
  bossOrb: { volume: 0.6, voices: 3 },
  bossDrag: { volume: 0.8, voices: 1 },
  phaseChange: { volume: 1, voices: 1 },
  footstep: { volume: 0.18, pitchVar: 0.15, voices: 3 },
  hover: { volume: 0.25, voices: 1 },
};

export interface MusicEntry {
  src?: string;
  volume?: number;
}

/** Music cues. Without `src`, the procedural score in music.ts plays. */
export const MUSIC: Record<string, MusicEntry> = {
  title: {},
  dock: {},
  explore: {},
  combat: {},
  boss: {},
  victory: {},
};

export type MusicCue = keyof typeof MUSIC;
