import type * as THREE from 'three';

export type WeaponId = 'smg' | 'rifle';
export type PowerId = 'pull' | 'throw' | 'charge';

/**
 * Everything the protagonist's visual needs from gameplay each frame.
 * Gameplay code only ever talks to the avatar through this and AvatarEvent.
 */
export interface AvatarState {
  /** Horizontal speed, m/s. */
  speed: number;
  /** Velocity in the body frame: x right, z forward (m/s). */
  localVelX: number;
  localVelZ: number;
  vy: number;
  grounded: boolean;
  sprinting: boolean;
  aiming: boolean;
  scoped: boolean;
  hovering: boolean;
  dashing: boolean;
  /** Dash direction in the body frame. */
  dashLocalX: number;
  dashLocalZ: number;
  charging: boolean;
  cover: 'none' | 'low' | 'high';
  /** 0 = tucked, 1 = popped out. */
  coverOut: number;
  weapon: WeaponId;
  weaponOut: boolean;
  /** Camera pitch (radians), for the aim offset. */
  aimPitch: number;
  /** Aim yaw minus body yaw (radians). */
  aimYawOffset: number;
  reloading: boolean;
  /** 0..1 progress of the current reload. */
  reloadT: number;
  swapping: boolean;
  firing: boolean;
  alive: boolean;
  /** 0..1 how low shields/health are, for posture. */
  hurt: number;
  /** Seconds the player has been in the air. */
  airTime: number;
  ammo: number;
  /** World yaw the body faces (radians). */
  yaw: number;
}

export type AvatarEvent =
  | { type: 'fire'; weapon: WeaponId }
  | { type: 'reload'; weapon: WeaponId; duration: number }
  | { type: 'swap'; to: WeaponId }
  | { type: 'melee' }
  | { type: 'cast'; power: PowerId }
  | { type: 'hit'; fromX: number; fromZ: number; strength: number }
  | { type: 'death' }
  | { type: 'revive' }
  | { type: 'jump' }
  | { type: 'land'; impact: number };

export function makeAvatarState(): AvatarState {
  return {
    speed: 0, localVelX: 0, localVelZ: 0, vy: 0, grounded: true,
    sprinting: false, aiming: false, scoped: false, hovering: false, dashing: false,
    dashLocalX: 0, dashLocalZ: 1, charging: false, cover: 'none', coverOut: 0,
    weapon: 'smg', weaponOut: false, aimPitch: 0, aimYawOffset: 0,
    reloading: false, reloadT: 0, swapping: false, firing: false, alive: true,
    hurt: 0, airTime: 0, ammo: 40, yaw: 0,
  };
}

/** The visual side of the player. Implemented by the protagonist module. */
export interface Avatar {
  readonly object: THREE.Object3D;
  update(dt: number, state: AvatarState): void;
  trigger(e: AvatarEvent): void;
  /** Muzzle of the weapon in hand, world space. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
  /** Point between the shoulders, world space (for jets, casting FX). */
  chestWorld(out: THREE.Vector3): THREE.Vector3;
  /** Back thrusters, world space. */
  jetWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3;
  headWorld(out: THREE.Vector3): THREE.Vector3;
  /** Casting hand, world space. */
  handWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3;
  /** Dialogue: turn the head toward a point; null releases. */
  lookAt(target: THREE.Vector3 | null): void;
  setTalking(talking: boolean): void;
  setVisible(v: boolean): void;
  /** Fade when the camera is very close. */
  setOpacity(o: number): void;
}
