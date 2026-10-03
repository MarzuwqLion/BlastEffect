/**
 * Every tuning value in the game lives here. Units: metres, seconds,
 * degrees (converted where used), hit points.
 *
 * The numbers started from the design brief and were tuned toward the feel
 * targets, which tests/ttk.test.ts checks:
 *  - grunt dies in ~1.5 s of sustained SMG fire
 *  - shield trooper ~4 s with guns alone
 *  - heavy 8-10 s with the SMG, about half with the rifle on armor, less
 *    again on the weak point
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface LayerMultipliers {
  shield: number;
  armor: number;
  health: number;
}

export interface WeaponConfig {
  id: 'smg' | 'rifle';
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  automatic: boolean;
  magSize: number;
  reloadTime: number;
  reserveStart: number;
  reserveMax: number;
  /** Cone half-angle in degrees. */
  spreadHip: number;
  spreadAim: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecovery: number;
  recoilPitch: number;
  recoilYaw: number;
  recoilRecovery: number;
  range: number;
  headshot: number;
  weakPoint: number;
  layers: LayerMultipliers;
  /** Physics impulse applied to ragdolls on a kill. */
  killImpulse: number;
  shake: number;
  /** Assumed share of shots that land when estimating time-to-kill. */
  ttkAccuracy: number;
}

export interface EnemyWeaponConfig {
  boltDamage: number;
  boltSpeed: number;
  burstCount: number;
  burstInterval: number;
  /** Degrees. */
  spread: number;
  telegraph: number;
  cooldownMin: number;
  cooldownMax: number;
  range: number;
}

export interface EnemyConfig {
  id: 'grunt' | 'trooper' | 'heavy' | 'boss';
  shield: number;
  armor: number;
  health: number;
  walkSpeed: number;
  runSpeed: number;
  radius: number;
  height: number;
  preferredRangeMin: number;
  preferredRangeMax: number;
  weapon: EnemyWeaponConfig;
  /** Seconds between AI decisions. */
  thinkInterval: number;
  /** Chance to throw away a cover position and reposition per decision. */
  repositionChance: number;
  staggerResist: number;
  /** Mass used when flung. */
  mass: number;
  hasWeakPoint: boolean;
  /** Weak point hitbox radius; when set, the hitbox follows the model's weak point. */
  weakRadius?: number;
  score: number;
}

export const CONFIG = {
  physics: {
    gravity: 24,
    maxStep: 1 / 30,
    minStep: 1 / 240,
  },

  player: {
    radius: 0.36,
    /** Half-height of the capsule's cylinder part. */
    halfHeight: 0.52,
    standHeight: 1.76,
    crouchHeight: 1.12,
    runSpeed: 6,
    sprintSpeed: 9,
    aimSpeed: 4.4,
    coverSpeed: 3.2,
    groundAccel: 55,
    groundDecel: 40,
    airAccel: 14,
    turnSpeed: 14,
    /** Tuned so the measured apex is ~2.5 m (controller offset and snap eat a little). */
    jumpHeight: 2.62,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,
    hoverDuration: 1.5,
    hoverFallSpeed: 0.35,
    hoverRiseDamp: 6,
    terminalVelocity: 30,
    dashDistance: 6,
    dashDuration: 0.25,
    dashCooldown: 1.5,
    /** Seconds of damage reduction at the start of a dash. */
    dashGrace: 0.12,
    dashGraceDamageScale: 0.35,
    shieldMax: 100,
    shieldRegenRate: 50,
    shieldRegenDelay: 3,
    healthMax: 100,
    /** How long the weapon stays out after firing/aiming outside combat. */
    weaponOutTime: 5,
    stepHeight: 0.42,
    maxSlopeDeg: 50,
    fallDamageFrom: 999,
    melee: {
      damage: 50,
      cooldown: 1,
      range: 2.4,
      coneDeg: 55,
      knockback: 7,
      lungeSpeed: 9,
      lungeTime: 0.14,
      windup: 0.08,
      layers: { shield: 1, armor: 0.75, health: 1 } as LayerMultipliers,
    },
    pickupRadius: 1.7,
  },

  cover: {
    /** Max gap between capsule and cover face to tuck in. */
    snapDistance: 0.7,
    /** Height below which cover counts as low (crouch). */
    lowMaxHeight: 1.35,
    /** Input pointing away from cover above this dot releases. */
    releaseDot: 0.45,
    /** Edge distance at which aiming steps out of high cover. */
    edgePeekDistance: 1.2,
    peekStepOut: 0.75,
    enterDelay: 0.08,
    /** Gap kept between capsule and cover face. */
    gap: 0.04,
  },

  camera: {
    fov: 68,
    aimFov: 50,
    scopeFov: 30,
    sprintFov: 76,
    pivotHeight: 1.58,
    crouchPivotHeight: 1.12,
    distance: 3.1,
    aimDistance: 1.6,
    shoulder: 0.72,
    aimShoulder: 0.74,
    verticalOffset: 0.12,
    aimVerticalOffset: 0.26,
    pitchMinDeg: -68,
    pitchMaxDeg: 72,
    collisionRadius: 0.22,
    /** Distance recovers this fast after a collision pushes it in. */
    distanceRecover: 5,
    aimLerp: 14,
    shoulderLerp: 9,
    fovLerp: 10,
    pivotYFollow: 14,
    shakeMaxAngleDeg: 3.2,
    shakeMaxOffset: 0.18,
    shakeDecay: 1.7,
    dashFovKick: 9,
    chargeFovKick: 18,
    fovKickDecay: 6,
    dialogueLerp: 4,
  },

  input: {
    mouseSensitivity: 0.0021,
    gamepadYawRate: 3.4,
    gamepadPitchRate: 2.3,
    gamepadAimScale: 0.55,
    deadzone: 0.16,
    triggerThreshold: 0.35,
    /** Window for LB+RB to count as one press (power three). */
    chordWindow: 0.1,
    aimAssist: {
      enabled: true,
      /** Cone half-angle (deg) in which stick rate slows down. */
      slowdownConeDeg: 4.5,
      slowdownScale: 0.5,
      /** How strongly the aim follows a moving target, per second. */
      magnetism: 1.6,
      maxRange: 45,
    },
  },

  weapons: {
    smg: {
      id: 'smg',
      damage: 12,
      fireInterval: 0.1,
      automatic: true,
      magSize: 40,
      reloadTime: 1.6,
      reserveStart: 200,
      reserveMax: 320,
      spreadHip: 2.3,
      spreadAim: 0.7,
      bloomPerShot: 0.22,
      bloomMax: 2.2,
      bloomRecovery: 6,
      recoilPitch: 0.32,
      recoilYaw: 0.18,
      recoilRecovery: 9,
      range: 90,
      headshot: 1.5,
      weakPoint: 1.5,
      layers: { shield: 1.5, armor: 0.5, health: 1 },
      killImpulse: 4,
      shake: 0.05,
      ttkAccuracy: 0.8,
    } as WeaponConfig,
    rifle: {
      id: 'rifle',
      damage: 70,
      fireInterval: 0.6,
      automatic: false,
      magSize: 8,
      reloadTime: 2.4,
      reserveStart: 32,
      reserveMax: 56,
      spreadHip: 1.4,
      spreadAim: 0,
      bloomPerShot: 0.6,
      bloomMax: 1.6,
      bloomRecovery: 3,
      recoilPitch: 2.4,
      recoilYaw: 0.5,
      recoilRecovery: 7,
      range: 220,
      headshot: 1.5,
      weakPoint: 2.5,
      layers: { shield: 0.75, armor: 1.5, health: 1 },
      killImpulse: 9,
      shake: 0.2,
      ttkAccuracy: 0.9,
    } as WeaponConfig,
    swapTime: 0.45,
  },

  powers: {
    pull: {
      cooldown: 8,
      range: 48,
      projectileSpeed: 34,
      homing: 7,
      liftDuration: 4,
      liftHeight: 1.7,
      liftRise: 0.45,
      /** Primed state lingers this long after the lift ends. */
      primeGrace: 0.6,
      blockedDamage: 15,
      castTime: 0.18,
    },
    throw: {
      cooldown: 7,
      range: 48,
      projectileSpeed: 48,
      homing: 4,
      damage: 90,
      layers: { shield: 0.6, armor: 0.6, health: 1 } as LayerMultipliers,
      flingSpeed: 13,
      flingUp: 5,
      staggerShielded: 0.6,
      castTime: 0.14,
    },
    charge: {
      cooldown: 10,
      range: 32,
      speed: 40,
      maxTravelTime: 0.9,
      damage: 110,
      layers: { shield: 1.25, armor: 0.8, health: 1 } as LayerMultipliers,
      shieldRestore: 0.4,
      knockback: 11,
      impactRadius: 2.6,
      splashDamage: 30,
      castTime: 0.06,
      hitStop: 0.06,
    },
    combo: {
      radius: 5,
      damage: 150,
      layers: { shield: 1, armor: 1, health: 1 } as LayerMultipliers,
      stagger: 1.5,
      flingSpeed: 12,
      flingUp: 6,
      hitStop: 0.16,
      shake: 0.85,
    },
    /** Max angle from the crosshair (deg) for a power to lock a target. */
    lockConeDeg: 7,
  },

  enemies: {
    grunt: {
      id: 'grunt',
      shield: 0,
      armor: 0,
      health: 150,
      walkSpeed: 2.6,
      runSpeed: 4.6,
      radius: 0.38,
      height: 1.8,
      preferredRangeMin: 9,
      preferredRangeMax: 22,
      weapon: {
        boltDamage: 6,
        boltSpeed: 46,
        burstCount: 4,
        burstInterval: 0.13,
        spread: 2.6,
        telegraph: 0.6,
        cooldownMin: 1.2,
        cooldownMax: 2.4,
        range: 45,
      },
      thinkInterval: 0.45,
      repositionChance: 0.12,
      staggerResist: 0,
      mass: 80,
      hasWeakPoint: false,
      score: 100,
    } as EnemyConfig,
    trooper: {
      id: 'trooper',
      shield: 250,
      armor: 0,
      health: 200,
      walkSpeed: 3,
      runSpeed: 5.2,
      radius: 0.42,
      height: 1.86,
      preferredRangeMin: 5,
      preferredRangeMax: 11,
      weapon: {
        boltDamage: 5,
        boltSpeed: 50,
        burstCount: 6,
        burstInterval: 0.09,
        spread: 3.4,
        telegraph: 0.6,
        cooldownMin: 0.9,
        cooldownMax: 1.8,
        range: 32,
      },
      thinkInterval: 0.35,
      repositionChance: 0.35,
      staggerResist: 0.3,
      mass: 95,
      hasWeakPoint: false,
      score: 200,
    } as EnemyConfig,
    heavy: {
      id: 'heavy',
      shield: 0,
      armor: 280,
      health: 250,
      walkSpeed: 1.7,
      runSpeed: 2.3,
      radius: 0.62,
      height: 2.35,
      preferredRangeMin: 8,
      preferredRangeMax: 26,
      weapon: {
        boltDamage: 4,
        boltSpeed: 40,
        burstCount: 22,
        burstInterval: 0.085,
        spread: 4.2,
        telegraph: 0.9,
        cooldownMin: 1.8,
        cooldownMax: 3,
        range: 50,
      },
      thinkInterval: 0.6,
      repositionChance: 0.1,
      staggerResist: 0.7,
      mass: 220,
      hasWeakPoint: true,
      score: 400,
    } as EnemyConfig,
  },

  heavyStomp: {
    range: 4.2,
    damage: 32,
    telegraph: 0.8,
    knockback: 10,
    cooldown: 4,
  },

  ai: {
    maxAttackTokens: 3,
    /** Every dangerous attack is telegraphed for at least this long. */
    minTelegraph: 0.6,
    alertRadius: 40,
    coverPointSpacing: 1.2,
    coverOffset: 0.65,
    /** Time a cover point is avoided after an enemy is flushed from it. */
    coverCooldown: 4,
    retreatHealthFraction: 0.3,
    retreatChance: 0.5,
    closeRangeFlee: 4.5,
    tokenHoldExtra: 0.25,
    flankAngleDeg: 70,
    staggerTime: 0.55,
    flungRecoverTime: 1.4,
    getUpTime: 0.8,
    corpseTime: 6,
    navCell: 0.5,
    separation: 1.3,
    lookAheadDist: 0.6,
    /** Delay before newly spawned enemies are allowed to shoot. */
    spawnGrace: 1.2,
    boltRadiusPlayer: 0.08,
  },

  boss: {
    shield: 3000,
    armor: 3000,
    health: 2800,
    radius: 0.9,
    height: 2.9,
    walkSpeed: 2.4,
    /** Phase 3 moves this much faster. */
    enragedSpeed: 1.3,
    /** Distance band he tries to hold from the player. */
    rangeMin: 8,
    rangeMax: 16,
    /** Max turn rate (rad/s): slow enough that flanking reaches his back. */
    turnRate: 2.2,
    /** Extra weak point multiplier once Yaw's intel marked the reservoir. */
    weakPointBonusMarked: 1.4,
    weakRadius: 0.32,
    /** Invulnerable roar when a layer breaks. */
    transitionTime: 2.5,
    /** Hop back to the dais after the roar. */
    leapTime: 1.1,
    /** Longest he channels while his reinforcements fight. */
    channelMax: 35,
    /** Who comes through the side doors when phase 2 / phase 3 begin. */
    reinforcements: [
      ['grunt', 'grunt', 'trooper'],
      ['grunt', 'trooper', 'heavy'],
    ] as ('grunt' | 'trooper' | 'heavy')[][],
    /** This much damage inside staggerWindow staggers him (bursts, combos). */
    staggerDamageThreshold: 340,
    staggerWindow: 1.5,
    staggerTime: 1.4,
    staggerCooldown: 7,
    /** Pause between attacks (s), scaled by phase tempo. */
    attackGapMin: 1.4,
    attackGapMax: 2.4,
    attacks: {
      volley: {
        telegraph: 0.8,
        bolts: 7,
        damage: 9,
        speed: 30,
        spreadDeg: 34,
        cooldown: 2.6,
      },
      slam: {
        telegraph: 1.1,
        /** Only used when the player is this close. */
        triggerRange: 9,
        radius: 12,
        damage: 34,
        knockback: 12,
        ringSpeed: 12,
        ringWidth: 1.4,
        cooldown: 6,
      },
      drag: {
        telegraph: 1,
        range: 30,
        duration: 0.7,
        pullSpeed: 15,
        damage: 10,
        cooldown: 9,
      },
      lunge: {
        telegraph: 1,
        speed: 20,
        maxDistance: 22,
        damage: 34,
        width: 1.8,
        /** Running into a wall or column stuns him this long. */
        wallStagger: 2.4,
        cooldown: 8,
      },
      orbs: {
        telegraph: 0.8,
        count: 4,
        damage: 14,
        speed: 8,
        homing: 1.4,
        life: 6,
        cooldown: 7,
      },
    },
    /** Attack cooldown scale per phase (1-indexed). */
    phaseTempo: [1, 0.85, 0.7],
    /** Fight-length model (tests): share of time spent shooting, seconds per reinforcement wave. */
    estimate: { uptime: 0.5, waveTime: 16 },
  },

  /** Explosive ka cells in the levels and the grunts' grenades. */
  explosives: {
    cell: {
      /** Damage a cell takes before it goes (SMG ~3 hits, rifle 1). */
      hp: 24,
      /** Hiss between ignition and the blast. */
      fuse: 0.4,
      /** Fuse when set off by another explosion (chains ripple). */
      chainFuse: 0.18,
      radius: 5.2,
      damage: 190,
      layers: { shield: 0.8, armor: 1.4, health: 1 } as LayerMultipliers,
      playerDamage: 55,
      flingSpeed: 11,
      flingUp: 6.5,
      shake: 0.7,
    },
    grenade: {
      /** Seconds from the throw to the blast. */
      fuse: 2.4,
      radius: 4.2,
      /** Against the grunts' own side (they're careless). */
      damage: 60,
      layers: { shield: 1, armor: 1, health: 1 } as LayerMultipliers,
      playerDamage: 42,
      /** Wind-up before the throw (the tell). */
      windup: 0.55,
      flight: 1.05,
      /** Only after the player has sat behind the same cover this long. */
      coverTime: 3,
      minRange: 6,
      maxRange: 22,
      /** Per-grunt and shared cooldowns. */
      cooldown: 14,
      sharedCooldown: 7,
      chance: 0.6,
      shake: 0.45,
    },
    /** Damage scale when a wall is between the blast and the player. */
    occludedScale: 0.2,
  },

  /** Kwame's ka-amp tuning (one or the other). */
  tuning: {
    kaCooldownScale: 0.8,
    shieldBonus: 25,
    /** Enemy wind-up when the player hovers above them and heard Bas's advice. */
    lookUpTelegraphScale: 1.5,
  },

  pickups: {
    healthAmount: 50,
    ammoCrateCooldown: 18,
  },

  feel: {
    hitStopKill: 0.05,
    hitStopHeadshotKill: 0.075,
    hitStopScale: 0.04,
    shakeHitTaken: 0.22,
    shakeShieldBreak: 0.3,
    shakeExplosion: 0.6,
    shakeDistanceFalloff: 25,
    damageNumberTime: 0.7,
    hitMarkerTime: 0.16,
    lowHealthFraction: 0.3,
  },

  checkpoints: {
    respawnDelay: 1.6,
  },

  quality: {
    low: {
      pixelRatioMax: 0.85,
      antialias: false,
      shadows: false,
      shadowMapSize: 512,
      bloom: false,
      bloomStrength: 0,
      caustics: false,
      maxPointLights: 4,
      particleScale: 0.5,
      hairCurls: 1200,
      decals: 48,
      reflectionCards: false,
      domeLife: 6,
      fogDensity: 0.024,
    },
    medium: {
      pixelRatioMax: 1,
      antialias: false,
      shadows: true,
      shadowMapSize: 1024,
      bloom: true,
      bloomStrength: 0.62,
      caustics: true,
      maxPointLights: 6,
      particleScale: 1,
      hairCurls: 2300,
      decals: 96,
      reflectionCards: true,
      domeLife: 12,
      fogDensity: 0.02,
    },
    high: {
      // 2x on high-DPI laptop screens with MSAA and bloom is too much for
      // many integrated GPUs; 1.5 keeps it sharp.
      pixelRatioMax: 1.5,
      antialias: true,
      shadows: true,
      shadowMapSize: 2048,
      bloom: true,
      bloomStrength: 0.7,
      caustics: true,
      maxPointLights: 8,
      particleScale: 1.4,
      hairCurls: 3400,
      decals: 160,
      reflectionCards: true,
      domeLife: 20,
      fogDensity: 0.018,
    },
  } as Record<QualityLevel, QualityConfig>,

  budgets: {
    mediumDrawCalls: 500,
    mediumTriangles: 1_500_000,
  },

  audio: {
    masterVolume: 0.8,
    musicVolume: 0.5,
    sfxVolume: 0.9,
    maxDistance: 60,
    refDistance: 4,
  },

  ui: {
    typewriterCps: 55,
    enemyBarRange: 45,
    enemyBarLinger: 4,
    promptFadeTime: 0.3,
  },
};

export interface QualityConfig {
  pixelRatioMax: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  bloomStrength: number;
  caustics: boolean;
  maxPointLights: number;
  particleScale: number;
  hairCurls: number;
  decals: number;
  reflectionCards: boolean;
  domeLife: number;
  fogDensity: number;
}

export const DEG = Math.PI / 180;
