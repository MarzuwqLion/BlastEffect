/**
 * Every sound and music track goes through this manifest. To use your own
 * audio, drop a file in public/audio/ and set `src` (relative to the site
 * root, e.g. 'audio/smg.ogg'). Without `src`, the synthesized placeholder
 * from synth.ts (sounds) or music.ts (tracks) is used.
 */

export type Bus = 'sfx' | 'ui' | 'music';

export interface SoundEntry {
  /**
   * File(s) relative to the site root. Several files are variations: one is
   * picked at random each time. Without `src` the synthesized placeholder
   * from synth.ts is used.
   */
  src?: string | string[];
  bus?: Bus;
  /** Base gain 0..1. */
  volume?: number;
  /** Random pitch variation (fraction, e.g. 0.06 = ±6%). */
  pitchVar?: number;
  /** Max simultaneous voices of this sound. */
  voices?: number;
}

const sfx = (...names: string[]): string | string[] => (names.length === 1 ? `audio/sfx/${names[0]}.mp3` : names.map((n) => `audio/sfx/${n}.mp3`));
const range = (base: string, from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `${base}${from + i}`);

export const SOUNDS: Record<string, SoundEntry> = {
  // Weapons.
  smgShot: { src: sfx('smgShot', 'smgShot2'), volume: 0.62, pitchVar: 0.04, voices: 6 },
  rifleShot: { src: sfx('rifleShot'), volume: 0.95, pitchVar: 0.03, voices: 3 },
  gruntShot: { src: sfx(...range('gruntShot', 1, 3)), volume: 0.55, pitchVar: 0.06, voices: 8 },
  trooperShot: { src: sfx(...range('trooperShot', 1, 3)), volume: 0.55, pitchVar: 0.06, voices: 8 },
  heavyShot: { src: sfx('heavyShot4', 'heavyShot5'), volume: 0.5, pitchVar: 0.05, voices: 8 },
  enemyCharge: { src: sfx('enemyCharge'), volume: 0.5, pitchVar: 0.05, voices: 4 },
  heavyWindup: { src: sfx('heavyWindup'), volume: 0.7, voices: 2 },
  impact: { src: sfx(...range('impact', 0, 4)), volume: 0.5, pitchVar: 0.12, voices: 6 },
  impactHeavy: { src: sfx('impactHeavy'), volume: 0.6, pitchVar: 0.08, voices: 3 },
  hitFlesh: { src: sfx('hitFlesh'), volume: 0.55, pitchVar: 0.1, voices: 4, bus: 'ui' },
  hitShield: { src: sfx('hitShield', 'hitShield2'), volume: 0.75, pitchVar: 0.08, voices: 4, bus: 'ui' },
  hitArmor: { src: sfx('hitArmor', 'hitArmor2'), volume: 0.5, pitchVar: 0.08, voices: 4, bus: 'ui' },
  hitCrit: { src: sfx('hitCrit'), volume: 0.55, pitchVar: 0.05, voices: 3, bus: 'ui' },
  killConfirm: { src: sfx('killConfirm'), volume: 0.8, pitchVar: 0.04, voices: 3, bus: 'ui' },
  shieldBreak: { src: sfx('shieldBreak'), volume: 0.8, voices: 3 },
  armorBreak: { src: sfx('armorBreak'), volume: 0.8, voices: 3 },
  shieldBreakPlayer: { src: sfx('shieldBreakPlayer'), volume: 0.8, voices: 1, bus: 'ui' },
  playerHitShield: { src: sfx('playerHitShield'), volume: 0.7, pitchVar: 0.1, voices: 3, bus: 'ui' },
  playerHitHealth: { src: sfx('playerHitHealth'), volume: 0.6, pitchVar: 0.1, voices: 3, bus: 'ui' },
  playerDeath: { src: sfx('playerDeath'), volume: 0.9, voices: 1, bus: 'ui' },
  dryFire: { src: sfx('dryFire'), volume: 0.6, voices: 1 },
  swap: { src: sfx('swap'), volume: 0.55, voices: 1 },
  reloadSmg: { src: sfx('reloadSmg'), volume: 0.55, voices: 1 },
  reloadRifle: { src: sfx('reloadRifle'), volume: 0.55, voices: 1 },
  meleeSwing: { src: sfx('meleeSwing'), volume: 0.6, pitchVar: 0.1, voices: 2 },
  meleeHit: { src: sfx('meleeHit'), volume: 0.85, pitchVar: 0.05, voices: 2 },
  // Movement.
  dash: { src: sfx('dash'), volume: 0.6, pitchVar: 0.06, voices: 2 },
  jump: { src: sfx('jump'), volume: 0.5, pitchVar: 0.06, voices: 2 },
  land: { src: sfx('land'), volume: 0.45, pitchVar: 0.08, voices: 2 },
  coverIn: { src: sfx('coverIn'), volume: 0.45, pitchVar: 0.1, voices: 1 },
  footstep: { src: sfx(...range('footstep', 0, 4)), volume: 0.28, pitchVar: 0.08, voices: 4 },
  // Powers.
  castPull: { src: sfx('castPull'), volume: 0.7, voices: 2 },
  castThrow: { src: sfx('castThrow'), volume: 0.7, voices: 2 },
  castCharge: { src: sfx('castCharge'), volume: 0.75, voices: 2 },
  pullHit: { src: sfx('pullHit'), volume: 0.75, voices: 2 },
  throwHit: { src: sfx('throwHit'), volume: 0.8, voices: 2 },
  chargeImpact: { src: sfx('chargeImpact'), volume: 0.9, voices: 2 },
  powerFizzle: { src: sfx('powerFizzle'), volume: 0.45, voices: 2 },
  powerBlocked: { src: sfx('powerBlocked'), volume: 0.6, voices: 2 },
  combo: { src: sfx('combo'), volume: 1, voices: 2 },
  explosion: { src: sfx('explosion'), volume: 0.95, pitchVar: 0.06, voices: 3 },
  grenadeBounce: { src: sfx('grenadeBounce'), volume: 0.5, pitchVar: 0.15, voices: 3 },
  grenadeBeep: { src: sfx('grenadeBeep'), volume: 0.45, voices: 3 },
  // Enemies.
  deathGrunt: { src: sfx('deathGrunt'), volume: 0.6, pitchVar: 0.1, voices: 3 },
  deathHeavy: { src: sfx('deathHeavy'), volume: 0.8, voices: 2 },
  stomp: { src: sfx('stomp'), volume: 0.9, voices: 2 },
  whizz: { src: sfx('whizz'), volume: 0.6, pitchVar: 0.2, voices: 3, bus: 'ui' },
  // Boss.
  bossRoar: { volume: 1, voices: 1 },
  bossSlam: { src: sfx('bossSlam'), volume: 1, voices: 2 },
  bossCharge: { src: sfx('bossCharge'), volume: 0.8, voices: 2 },
  bossVolley: { src: sfx('bossVolley'), volume: 0.8, voices: 2 },
  bossOrb: { src: sfx('bossOrb'), volume: 0.6, voices: 3 },
  bossDrag: { src: sfx('bossDrag'), volume: 0.8, voices: 1 },
  phaseChange: { src: sfx('phaseChange'), volume: 0.9, voices: 1 },
  // World and UI.
  doorOpen: { src: sfx('doorOpen'), volume: 0.7, voices: 2 },
  pickupAmmo: { src: sfx('pickupAmmo'), volume: 0.65, voices: 1, bus: 'ui' },
  pickupHealth: { src: sfx('pickupHealth'), volume: 0.65, voices: 1, bus: 'ui' },
  holoLog: { src: sfx('holoLog'), volume: 0.7, voices: 1, bus: 'ui' },
  bubbles: { src: sfx('bubbles'), volume: 0.35, pitchVar: 0.15, voices: 2 },
  uiMove: { src: sfx('uiMove'), volume: 0.35, voices: 2, bus: 'ui' },
  uiSelect: { src: sfx('uiSelect'), volume: 0.5, voices: 2, bus: 'ui' },
  uiBack: { src: sfx('uiBack'), volume: 0.45, voices: 2, bus: 'ui' },
  uiDeny: { src: sfx('uiDeny'), volume: 0.4, voices: 2, bus: 'ui' },
  typeBlip: { src: sfx('typeBlip'), volume: 0.18, pitchVar: 0.1, voices: 2, bus: 'ui' },
  checkpoint: { src: sfx('checkpoint'), volume: 0.6, voices: 1, bus: 'ui' },
  objective: { src: sfx('objective'), volume: 0.55, voices: 1, bus: 'ui' },
};

export interface MusicEntry {
  src?: string;
  volume?: number;
}

/**
 * Music cues, streamed when first needed. Without `src`, the procedural
 * score in music.ts plays.
 */
export const MUSIC = {
  title: { src: 'audio/music/title.mp3', volume: 0.8 },
  dock: { src: 'audio/music/dock.mp3', volume: 0.75 },
  explore: { src: 'audio/music/explore.mp3', volume: 0.75 },
  combat: { src: 'audio/music/combat.mp3', volume: 0.85 },
  boss: { src: 'audio/music/boss.mp3', volume: 0.9 },
  victory: { src: 'audio/music/victory.mp3', volume: 0.8 },
  /** The Sistrum's sound system: plays in the club until the shooting starts. */
  club: { src: 'audio/music/club.mp3', volume: 0.85 },
  market: { src: 'audio/music/market.mp3', volume: 0.7 },
  gallery: { src: 'audio/music/gallery.mp3', volume: 0.75 },
  heist: { src: 'audio/music/heist.mp3', volume: 0.75 },
} satisfies Record<string, MusicEntry>;

export type MusicCue = keyof typeof MUSIC;

/** Looping beds: ambience by area, plus continuous effects (hover jets, heartbeat). */
export const LOOPS = {
  dome: { src: 'audio/amb/dome.mp3', volume: 0.55 },
  deepSea: { src: 'audio/amb/deepSea.mp3', volume: 0.6 },
  crowdMarket: { src: 'audio/amb/crowdMarket.mp3', volume: 0.7 },
  crowdWalla: { src: 'audio/amb/crowdWalla.mp3', volume: 0.6 },
  hoverJets: { src: 'audio/amb/hoverJets.mp3', volume: 0.45 },
  heartbeat: { src: 'audio/amb/heartbeat.mp3', volume: 0.6 },
} satisfies Record<string, MusicEntry>;

export type LoopId = keyof typeof LOOPS;
