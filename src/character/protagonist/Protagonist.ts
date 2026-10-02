import * as THREE from 'three';
import { CONFIG, type QualityLevel } from '../../config';
import { MASK, makeRayHit } from '../../core/Physics';
import type { Game } from '../../game/Game';
import type { Avatar, AvatarEvent, AvatarState, PowerId, WeaponId } from '../types';
import { RigBuilder, paletteMaterial } from '../rigKit';
import { addBones, ANKLE_HEIGHT } from './skeleton';
import { buildBody, PALETTE } from './body';
import { createHair } from './hair';
import { createRifle, createSmg, type WeaponModel } from './weapons';
import { buildClip, splitClip, LOWER_CLIPS, UPPER_CLIPS } from './clips';

import { setWorldQuaternion, solveTwoBone } from './ik';

/** A weapon pose in the aim frame (chest frame without the blade twist). */
interface Stance {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Extra chest yaw (negative turns her right, bringing the left shoulder forward). */
  blade: number;
}

function stance(x: number, y: number, z: number, dir: [number, number, number], blade: number, roll = 0, upHint?: [number, number, number]): Stance {
  const f = new THREE.Vector3(...dir).normalize();
  const up = upHint ? new THREE.Vector3(...upHint) : new THREE.Vector3(0, 1, 0);
  if (!upHint && Math.abs(f.dot(up)) > 0.95) up.set(0, 0, -1);
  // Basis with +Z = forward (muzzle), +Y = up.
  const xAxis = new THREE.Vector3().crossVectors(up, f).normalize();
  const yAxis = new THREE.Vector3().crossVectors(f, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, f);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return { pos: new THREE.Vector3(x, y, z), quat: q, blade };
}

type StanceName = 'aim' | 'low' | 'hip' | 'sprint' | 'coverLow' | 'coverHigh' | 'swap' | 'reload' | 'melee';

const STANCES: Record<WeaponId, Record<StanceName, Stance>> = {
  smg: {
    aim: stance(-0.095, 0.1, 0.3, [0, 0, 1], -0.35),
    low: stance(-0.11, -0.22, 0.25, [0.45, -0.42, 0.79], -0.12, -0.25),
    hip: stance(-0.11, -0.06, 0.32, [0.02, 0.0, 1], -0.25),
    sprint: stance(-0.07, -0.1, 0.22, [0.55, -0.42, 0.72], 0, -0.3),
    coverLow: stance(-0.09, 0.0, 0.27, [0.15, 0.55, 0.82], -0.15),
    coverHigh: stance(-0.09, 0.06, 0.22, [0.08, 0.85, 0.52], -0.1),
    swap: stance(-0.15, -0.33, 0.14, [0.1, -0.85, 0.5], 0),
    reload: stance(-0.05, -0.04, 0.3, [0.35, 0.28, 0.9], -0.2, 0.5),
    melee: stance(-0.03, 0.05, 0.42, [0.65, 0.05, 0.75], -0.3),
  },
  rifle: {
    aim: stance(-0.1, 0.1, 0.36, [0, 0, 1], -0.62),
    low: stance(-0.11, -0.14, 0.24, [0.55, -0.4, 0.73], -0.3, -0.25),
    hip: stance(-0.11, -0.05, 0.33, [0.04, 0.02, 1], -0.45),
    sprint: stance(-0.07, -0.06, 0.2, [0.62, -0.4, 0.68], -0.1, -0.3),
    coverLow: stance(-0.09, 0.02, 0.24, [0.2, 0.62, 0.76], -0.25),
    coverHigh: stance(-0.09, 0.06, 0.2, [0.1, 0.9, 0.42], -0.2),
    swap: stance(-0.15, -0.3, 0.14, [0.1, -0.85, 0.5], -0.1),
    reload: stance(-0.05, -0.02, 0.3, [0.35, 0.28, 0.9], -0.35, 0.5),
    melee: stance(-0.03, 0.05, 0.42, [0.65, 0.05, 0.75], -0.4),
  },
};

/** Hand orientation relative to the gun (columns: hand X, Y, Z in gun space). */
function handBasis(x: [number, number, number], y: [number, number, number]): THREE.Quaternion {
  const X = new THREE.Vector3(...x).normalize();
  const Y = new THREE.Vector3(...y).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
const GRIP_R = handBasis([1, 0, 0], [0, 0.4, -0.92]);
const FORE_L: Record<WeaponId, THREE.Quaternion> = {
  smg: handBasis([1, 0, 0], [0, 0.35, -0.94]),
  rifle: handBasis([0, -1, 0], [0.7, 0, -0.7]),
};
/** Grip contact offset: where the hand bone sits relative to the gun origin. */
const GRIP_OFFSET = new THREE.Vector3(-0.004, 0.045, -0.035);
const FORE_OFFSET: Record<WeaponId, THREE.Vector3> = {
  smg: new THREE.Vector3(0.004, 0.03, -0.02),
  rifle: new THREE.Vector3(0.035, -0.03, -0.01),
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _hit = makeRayHit();
const _down = new THREE.Vector3(0, -1, 0);

function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * Math.min(1, rate * dt);
}

interface OneShot {
  action: THREE.AnimationAction;
  t: number;
  dur: number;
  peak: number;
}

/**
 * Imani. Built entirely in code from docs/protagonist.md: rigid-skinned
 * armour on a bone hierarchy (one draw call for the body), a sculpted face,
 * an instanced afro, and her two weapons. Keyframe clips are blended with
 * AnimationMixer in a lower-body and an upper-body layer; procedural
 * layers add aim offset, weapon-driven arm IK, recoil, breathing, foot
 * planting, look-at and blinking. Gameplay only uses the Avatar interface.
 */
export class Protagonist implements Avatar {
  readonly object = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly B: Record<string, THREE.Bone> = {};
  private readonly bindQuat = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly hipsBind = new THREE.Vector3();
  private readonly hair: THREE.InstancedMesh;
  private readonly smg: WeaponModel;
  private readonly rifle: WeaponModel;
  private readonly holder = new THREE.Object3D();
  private readonly pivot = new THREE.Object3D();
  private readonly backSlot = new THREE.Object3D();
  private readonly hipSlot = new THREE.Object3D();
  private inHand: WeaponId = 'smg';
  private readonly mixer: THREE.AnimationMixer;
  private readonly lower: Record<string, THREE.AnimationAction> = {};
  private readonly upper: Record<string, THREE.AnimationAction> = {};
  private readonly lowerW: Record<string, number> = {};
  private readonly upperW: Record<string, number> = {};

  // Smoothed parameters.
  private phase = 0;
  private idleT = 0;
  private moveT = 0;
  private sprintT = 0;
  private aimT = 0;
  private hipT = 0;
  private airT = 0;
  private hoverT = 0;
  private crouchT = 0;
  private coverHighT = 0;
  private dashT = 0;
  private deathW = 0;
  private deathT = 0;
  private dead = false;
  private hipsYaw = 0;
  private lean = new THREE.Vector2();
  private landDip = 0;
  private landVel = 0;
  private recoil = 0;
  private recoilWeapon: WeaponId = 'smg';
  private oneShot: OneShot | null = null;
  private castW = 0;
  private hitSide = 0;
  private reloadT = -1;
  private reloadDur = 1;
  private swapT = -1;
  private swapTo: WeaponId = 'smg';
  private meleeT = -1;
  private time = 0;
  private blinkT = 2;
  private blink = 0;
  private talking = false;
  private talkW = 0;
  private lookTarget: THREE.Vector3 | null = null;
  private lookW = 0;
  private pelvisDrop = 0;
  private opacity = 1;
  private readonly footPre = [new THREE.Quaternion(), new THREE.Quaternion()];
  private lastAmmo = -1;
  private stance: Stance = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), blade: 0 };

  constructor(private readonly game: Game, quality: QualityLevel) {
    const rig = new RigBuilder();
    addBones(rig);
    buildBody(rig);
    this.material = paletteMaterial(PALETTE, { camoBlue: 0x1f4fd6, camoYellow: 0xf2c418, camoScale: 30 });
    const built = rig.build(this.material);
    this.mesh = built.mesh;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    for (const b of built.skeleton.bones) {
      this.B[b.name] = b;
      this.bindQuat.set(b, b.quaternion.clone());
    }
    this.hipsBind.copy(this.B.hips.position);
    this.object.add(this.mesh);

    // Hair on the head bone.
    this.hair = createHair(CONFIG.quality.high.hairCurls);
    this.B.head.add(this.hair);
    this.setQuality(quality);

    // Weapons: the one in hand rides the pivot in the aim frame; the other is slung.
    this.smg = createSmg();
    this.rifle = createRifle();
    this.B.chest.add(this.holder);
    this.holder.add(this.pivot);
    this.pivot.add(this.smg.group);
    // Rifle slung down her left side and back (as in the reference): stock by
    // her left hip, barrel rising past her left shoulder well above her head.
    this.backSlot.position.set(0.135, -0.03, -0.155);
    this.backSlot.quaternion.copy(stance(0, 0, 0, [0.1, 1, -0.07], 0, 0, [0.15, 0, -1]).quat);
    this.B.chest.add(this.backSlot);
    this.backSlot.add(this.rifle.group);
    // SMG slung across the lower back when the rifle is out.
    this.hipSlot.position.set(-0.02, 0.02, -0.15);
    this.hipSlot.quaternion.copy(stance(0, 0, 0, [1, -0.12, 0], 0, 0, [0, 0, -1]).quat);
    this.B.hips.add(this.hipSlot);

    // Animation clips → mixer actions, split into layers.
    this.mixer = new THREE.AnimationMixer(this.mesh);
    for (const def of Object.values(LOWER_CLIPS)) {
      const { lower, upper } = splitClip(buildClip(def));
      this.lower[def.name] = this.makeAction(lower);
      if (upper.tracks.length) this.upper[def.name] = this.makeAction(upper);
    }
    for (const def of Object.values(UPPER_CLIPS)) {
      const { upper } = splitClip(buildClip(def));
      this.upper[def.name] = this.makeAction(upper);
    }
    this.object.rotation.y = Math.PI;
  }

  private makeAction(clip: THREE.AnimationClip): THREE.AnimationAction {
    const a = this.mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.timeScale = 0;
    a.play();
    a.setEffectiveWeight(0);
    return a;
  }

  setQuality(level: QualityLevel): void {
    this.hair.count = Math.min(this.hair.userData.maxCount as number, CONFIG.quality[level].hairCurls);
  }

  // ---- Avatar interface ----

  trigger(e: AvatarEvent): void {
    switch (e.type) {
      case 'fire':
        this.recoil = Math.min(1.4, this.recoil + (e.weapon === 'rifle' ? 1 : 0.45));
        this.recoilWeapon = e.weapon;
        break;
      case 'reload':
        this.reloadT = 0;
        this.reloadDur = e.duration;
        break;
      case 'swap':
        this.swapT = 0;
        this.swapTo = e.to;
        this.reloadT = -1;
        break;
      case 'melee':
        this.meleeT = 0;
        this.startOneShot('melee', 0.5, 1);
        break;
      case 'cast':
        this.startOneShot(e.power === 'pull' ? 'castPull' : e.power === 'throw' ? 'castThrow' : 'castCharge', e.power === 'charge' ? 0.55 : 0.7, 1);
        this.castPower = e.power;
        break;
      case 'hit':
        if (!this.oneShot || this.oneShot.action === this.upper.hit) {
          this.hitSide = Math.random() < 0.5 ? -1 : 1;
          this.startOneShot('hit', 0.4, 0.7);
        }
        break;
      case 'death':
        this.dead = true;
        this.deathT = 0;
        break;
      case 'revive':
        this.dead = false;
        this.deathW = 0;
        this.deathT = 0;
        this.oneShot = null;
        this.reloadT = -1;
        this.swapT = -1;
        this.meleeT = -1;
        break;
      case 'jump':
        this.landVel -= 0.4;
        break;
      case 'land':
        this.landVel -= 1.2 * (0.3 + e.impact);
        break;
    }
  }

  private castPower: PowerId = 'pull';

  private startOneShot(name: string, dur: number, peak: number): void {
    const a = this.upper[name];
    if (!a) return;
    this.oneShot = { action: a, t: 0, dur, peak };
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const w = this.inHand === 'smg' ? this.smg : this.rifle;
    w.muzzle.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(w.muzzle.matrixWorld);
  }

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.chest.updateWorldMatrix(true, false);
    return out.set(0, 0.08, 0.05).applyMatrix4(this.B.chest.matrixWorld);
  }

  jetWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
    this.B.chest.updateWorldMatrix(true, false);
    return out.set(side * 0.075, -0.06, -0.18).applyMatrix4(this.B.chest.matrixWorld);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.B.head.updateWorldMatrix(true, false);
    return out.set(0, 0.095, 0.03).applyMatrix4(this.B.head.matrixWorld);
  }

  handWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
    const b = side < 0 ? this.B.handL : this.B.handR;
    b.updateWorldMatrix(true, false);
    return out.set(0, -0.06, 0.02).applyMatrix4(b.matrixWorld);
  }

  lookAt(target: THREE.Vector3 | null): void {
    this.lookTarget = target ? target.clone() : null;
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  setOpacity(o: number): void {
    if (Math.abs(o - this.opacity) < 0.01) return;
    this.opacity = o;
    const u = this.material.userData.uniforms as { uOpacity: { value: number } };
    u.uOpacity.value = o;
    const transparent = o < 0.99;
    if (this.material.transparent !== transparent) this.material.transparent = transparent;
    const hm = this.hair.material as THREE.Material;
    if (hm.transparent !== transparent) {
      hm.transparent = transparent;
      hm.needsUpdate = true;
    }
    hm.opacity = o;
  }

  // ---- Per frame ----

  update(dt: number, s: AvatarState): void {
    this.time += dt;
    this.object.rotation.y = s.yaw + Math.PI;
    this.updateParams(dt, s);
    this.applyClips(dt, s);
    this.applyProcedural(dt, s);
    this.object.updateMatrixWorld(true);
    this.updateWeapons(dt, s);
    this.solveArms(s);
    this.solveFeet(s);
    this.applyFace(dt);
    if (s.ammo !== this.lastAmmo && this.smg.setAmmo) {
      this.lastAmmo = s.ammo;
      if (s.weapon === 'smg') this.smg.setAmmo(s.ammo);
    }
  }

  private updateParams(dt: number, s: AvatarState): void {
    const moving = s.grounded ? Math.min(1, s.speed / 1.6) : 0;
    this.moveT = approach(this.moveT, moving, 10, dt);
    this.sprintT = approach(this.sprintT, s.sprinting ? 1 : 0, 6, dt);
    const aiming = s.aiming && s.alive;
    this.aimT = approach(this.aimT, aiming ? 1 : 0, 14, dt);
    this.hipT = approach(this.hipT, s.weaponOut && (s.firing || s.charging) ? 1 : 0, 12, dt);
    this.airT = approach(this.airT, !s.grounded && s.airTime > 0.08 ? 1 : 0, 9, dt);
    this.hoverT = approach(this.hoverT, s.hovering ? 1 : 0, 6, dt);
    this.crouchT = approach(this.crouchT, s.cover === 'low' && s.coverOut < 0.5 ? 1 : 0, 9, dt);
    this.coverHighT = approach(this.coverHighT, s.cover === 'high' && s.coverOut < 0.5 ? 1 : 0, 8, dt);
    this.dashT = approach(this.dashT, s.dashing || s.charging ? 1 : 0, s.dashing ? 25 : 8, dt);
    this.deathW = approach(this.deathW, this.dead ? 1 : 0, 8, dt);
    if (this.dead) this.deathT = Math.min(1.4, this.deathT + dt);
    this.talkW = approach(this.talkW, this.talking ? 1 : 0, 4, dt);
    this.lookW = approach(this.lookW, this.lookTarget ? 1 : 0, 3, dt);

    // Lower body faces the direction of travel (within limits); backwards uses a reversed gait.
    const mx = -s.localVelX;
    const mz = s.localVelZ;
    let dir = 1;
    let yawTarget = 0;
    if (s.speed > 0.5 && s.grounded) {
      const ang = Math.atan2(mx, mz);
      if (Math.abs(ang) <= 1.75) {
        yawTarget = THREE.MathUtils.clamp(ang, -1.1, 1.1) * 0.8;
      } else {
        dir = -1;
        let back = ang - Math.PI * Math.sign(ang);
        back = THREE.MathUtils.clamp(back, -1.1, 1.1);
        yawTarget = back * 0.8;
      }
    }
    this.hipsYaw = approach(this.hipsYaw, yawTarget, 8, dt);
    const stride = THREE.MathUtils.lerp(3.4, 4.8, this.sprintT) * THREE.MathUtils.lerp(1, 0.45, this.crouchT);
    this.phase += ((s.speed * dt) / stride) * dir;
    this.phase -= Math.floor(this.phase);
    this.idleT += dt;

    // Landing dip spring.
    this.landVel += (-this.landDip * 120 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;
    this.recoil = Math.max(0, this.recoil - dt * (this.recoilWeapon === 'rifle' ? 5 : 9));
    // Dash/charge lean toward the motion (model space: her left is +X).
    const lx = s.dashing ? -s.dashLocalX : 0;
    const lz = s.dashing ? s.dashLocalZ : s.charging ? 1 : 0;
    this.lean.x = approach(this.lean.x, lx * 0.35, 12, dt);
    this.lean.y = approach(this.lean.y, lz * 0.35, 12, dt);

    // One-shot envelope.
    if (this.oneShot) {
      this.oneShot.t += dt;
      if (this.oneShot.t >= this.oneShot.dur) this.oneShot = null;
    }
    const castActive = this.oneShot && (this.oneShot.action === this.upper.castPull || this.oneShot.action === this.upper.castThrow || this.oneShot.action === this.upper.castCharge);
    this.castW = approach(this.castW, castActive ? 1 : 0, castActive ? 20 : 8, dt);
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      if (this.reloadT >= 1) this.reloadT = -1;
    }
    if (this.swapT >= 0) {
      this.swapT += dt / CONFIG.weapons.swapTime;
      if (this.swapT >= 0.5 && this.inHand !== this.swapTo) this.setInHand(this.swapTo);
      if (this.swapT >= 1) this.swapT = -1;
    } else if (this.inHand !== s.weapon) {
      this.setInHand(s.weapon);
    }
    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.5;
      if (this.meleeT >= 1) this.meleeT = -1;
    }
    // Blinks.
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = 2.2 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
  }

  private setInHand(w: WeaponId): void {
    this.inHand = w;
    const inHand = w === 'smg' ? this.smg : this.rifle;
    const away = w === 'smg' ? this.rifle : this.smg;
    this.pivot.add(inHand.group);
    inHand.group.position.set(0, 0, 0);
    inHand.group.quaternion.identity();
    (w === 'smg' ? this.backSlot : this.hipSlot).add(away.group);
    away.group.position.set(0, 0, 0);
    away.group.quaternion.identity();
  }

  private setW(map: Record<string, number>, name: string, w: number): void {
    map[name] = (map[name] ?? 0) + w;
  }

  private applyClips(dt: number, s: AvatarState): void {
    // Reset non-animated bones to bind each frame (procedural layers add on top).
    for (const [b, q] of this.bindQuat) b.quaternion.copy(q);
    this.B.hips.position.copy(this.hipsBind);

    const lw = this.lowerW;
    const uw = this.upperW;
    for (const k in lw) lw[k] = 0;
    for (const k in uw) uw[k] = 0;
    const ground = 1 - this.airT;
    const stand = 1 - this.crouchT;
    const move = this.moveT;
    // Lower layer.
    this.setW(lw, 'idle', ground * stand * (1 - move));
    this.setW(lw, 'run', ground * stand * move * (1 - this.sprintT));
    this.setW(lw, 'sprint', ground * stand * move * this.sprintT);
    this.setW(lw, 'crouch', ground * this.crouchT * (1 - move));
    this.setW(lw, 'crouchWalk', ground * this.crouchT * move);
    this.setW(lw, 'air', this.airT * (1 - this.hoverT));
    this.setW(lw, 'hover', this.airT * this.hoverT);
    // Dash overrides most of the lower body briefly.
    for (const k in lw) lw[k] *= 1 - this.dashT * 0.75;
    this.setW(lw, 'dash', this.dashT * 0.75);
    for (const k in lw) lw[k] *= 1 - this.deathW;
    this.setW(lw, 'death', this.deathW);

    // Upper layer.
    const aim = Math.max(this.aimT, this.hipT * 0.6);
    const relaxed = 1 - aim;
    this.setW(uw, 'upIdle', relaxed * (1 - move) * stand * (1 - this.coverHighT));
    this.setW(uw, 'upRun', relaxed * move * (1 - this.sprintT) * stand * (1 - this.coverHighT));
    this.setW(uw, 'upSprint', relaxed * move * this.sprintT * stand);
    this.setW(uw, 'upCrouch', relaxed * this.crouchT);
    this.setW(uw, 'upCoverHigh', relaxed * this.coverHighT * stand);
    this.setW(uw, 'upAim', aim);
    // Talking replaces the idle posture in dialogue.
    if (this.talkW > 0) {
      for (const k in uw) uw[k] *= 1 - this.talkW * 0.7;
      this.setW(uw, 'upTalk', this.talkW * 0.7);
    }
    // One-shots (cast, hit, melee) blend over the base.
    if (this.oneShot) {
      const o = this.oneShot;
      const env = Math.min(1, o.t / 0.08, (o.dur - o.t) / 0.15) * o.peak;
      for (const k in uw) uw[k] *= 1 - env;
      const name = o.action.getClip().name.replace(':upper', '');
      this.setW(uw, name, env);
      o.action.time = Math.min(o.t, o.dur - 1e-3) * (o.action.getClip().duration / o.dur);
    }
    for (const k in uw) uw[k] *= 1 - this.deathW;
    this.setW(uw, 'death', this.deathW * 0.5);
    this.setW(uw, 'upDeath', this.deathW * 0.5);

    // Apply weights and times.
    for (const [name, a] of Object.entries(this.lower)) {
      const w = lw[name] ?? 0;
      a.enabled = w > 1e-3;
      a.setEffectiveWeight(w);
      const d = a.getClip().duration;
      if (name === 'run' || name === 'sprint' || name === 'crouchWalk') a.time = this.phase * d;
      else if (name === 'air') a.time = THREE.MathUtils.clamp(0.5 - s.vy / 16, 0, 0.999) * d;
      else if (name === 'death') a.time = Math.min(this.deathT, d - 1e-3);
      else if (name === 'dash') a.time = 0;
      else a.time = this.idleT % d;
    }
    for (const [name, a] of Object.entries(this.upper)) {
      const w = uw[name] ?? 0;
      a.enabled = w > 1e-3;
      a.setEffectiveWeight(w);
      const d = a.getClip().duration;
      if (name === 'upRun' || name === 'upSprint') a.time = this.phase * d;
      else if (name === 'death' || name === 'upDeath') a.time = Math.min(this.deathT, d - 1e-3);
      else if (this.oneShot && a === this.oneShot.action) {
        // set above
      } else a.time = this.idleT % d;
    }
    this.mixer.update(0);
    void dt;
  }

  private addRot(bone: THREE.Bone, x: number, y: number, z: number): void {
    _q.setFromEuler(_e.set(x, y, z, 'XYZ'));
    bone.quaternion.multiply(_q);
  }

  /** Rotate a bone about a model-space axis (pre-multiplied in parent space for root-level bones). */
  private premulY(bone: THREE.Bone, angle: number): void {
    _q.setFromAxisAngle(UP, angle);
    bone.quaternion.premultiply(_q);
  }

  private applyProcedural(dt: number, s: AvatarState): void {
    const B = this.B;
    const alive = 1 - this.deathW;
    // Lower body turns toward travel; upper body counter-rotates to keep facing the aim.
    this.premulY(B.hips, this.hipsYaw * alive);
    this.addRot(B.spine, 0, -this.hipsYaw * 0.55 * alive, 0);
    this.addRot(B.chest, 0, -this.hipsYaw * 0.45 * alive, 0);
    // Dash / charge lean.
    if (this.lean.lengthSq() > 1e-5) {
      _v.set(this.lean.y, 0, -this.lean.x);
      const ang = _v.length();
      _q.setFromAxisAngle(_v.normalize(), ang);
      B.hips.quaternion.premultiply(_q);
    }
    // Landing dip and pelvis drop from foot planting.
    B.hips.position.y += Math.min(0, this.landDip) * 0.3 + this.pelvisDrop;

    // Aim offset: pitch and yaw spread up the spine to the head.
    const weaponUp = Math.max(this.aimT, this.hipT, s.weaponOut ? 0.6 : 0.35);
    const pitch = THREE.MathUtils.clamp(s.aimPitch, -1.1, 1.2) * alive;
    const yaw = THREE.MathUtils.clamp(s.aimYawOffset, -1.4, 1.4) * alive * (s.weaponOut || s.aiming ? 1 : 0.5);
    const pw = weaponUp;
    this.addRot(B.spine, -pitch * 0.22 * pw, yaw * 0.3, 0);
    this.addRot(B.chest, -pitch * 0.33 * pw, yaw * 0.35, 0);
    this.addRot(B.neck, -pitch * (0.2 + (1 - pw) * 0.25), yaw * 0.15, 0);
    this.addRot(B.head, -pitch * (0.15 + (1 - pw) * 0.25), yaw * 0.2, 0);
    // Blade the torso for the weapon in hand (left shoulder forward).
    this.addRot(B.chest, 0, this.stance.blade * alive, 0);
    // Breathing (harder when hurt) and recoil kick.
    const breath = Math.sin(this.time * (1.7 + s.hurt * 1.6)) * (0.012 + s.hurt * 0.015);
    this.addRot(B.chest, breath - this.recoil * 0.035, 0, 0);
    this.addRot(B.neck, -breath * 0.6, 0, 0);
    if (this.oneShot && this.oneShot.action === this.upper.hit) this.addRot(B.spine, 0, 0, this.hitSide * 0.12 * (1 - this.oneShot.t / this.oneShot.dur));

    // Dialogue look-at: turn neck and head toward the target.
    if (this.lookW > 0.001 && this.lookTarget) {
      this.object.updateMatrixWorld(true);
      this.headWorld(_v);
      _v2.copy(this.lookTarget).sub(_v);
      // Into the chest's frame.
      B.chest.getWorldQuaternion(_q2);
      _v2.applyQuaternion(_q2.invert());
      const ty = THREE.MathUtils.clamp(Math.atan2(_v2.x, _v2.z), -1.0, 1.0);
      const tp = THREE.MathUtils.clamp(-Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)), -0.5, 0.5);
      this.addRot(B.neck, tp * 0.4 * this.lookW, ty * 0.45 * this.lookW, 0);
      this.addRot(B.head, tp * 0.6 * this.lookW, ty * 0.55 * this.lookW, -0.06 * this.lookW);
    }
    void dt;
  }

  private blendStance(out: Stance, b: Stance, w: number): void {
    if (w <= 1e-4) return;
    out.pos.lerp(b.pos, w);
    out.quat.slerp(b.quat, w);
    out.blade += (b.blade - out.blade) * w;
  }

  private updateWeapons(dt: number, s: AvatarState): void {
    const set = STANCES[this.inHand];
    const st = this.stance;
    st.pos.copy(set.low.pos);
    st.quat.copy(set.low.quat);
    st.blade = set.low.blade;
    this.blendStance(st, set.hip, this.hipT);
    this.blendStance(st, set.sprint, this.sprintT * this.moveT);
    this.blendStance(st, set.coverLow, this.crouchT * (1 - this.aimT));
    this.blendStance(st, set.coverHigh, this.coverHighT * (1 - this.aimT));
    this.blendStance(st, set.aim, this.aimT);
    if (this.reloadT >= 0) this.blendStance(st, set.reload, Math.sin(Math.min(1, this.reloadT) * Math.PI) * 1.2 > 1 ? 1 : Math.sin(Math.min(1, this.reloadT) * Math.PI) * 1.2);
    if (this.swapT >= 0) this.blendStance(st, set.swap, Math.sin(this.swapT * Math.PI));
    if (this.meleeT >= 0) this.blendStance(st, set.melee, Math.sin(this.meleeT * Math.PI));
    // During a Surge, the gun tucks in.
    if (this.castW > 0 && this.castPower === 'charge') this.blendStance(st, set.low, this.castW * 0.6);

    // Holder cancels the blade so the gun points along the aim.
    this.holder.quaternion.setFromAxisAngle(UP, -st.blade * (1 - this.deathW));
    this.pivot.position.copy(st.pos);
    this.pivot.quaternion.copy(st.quat);
    // Recoil: back along the barrel and muzzle climb.
    const r = this.recoil;
    const kick = this.recoilWeapon === 'rifle' ? 0.09 : 0.035;
    this.pivot.translateZ(-r * kick);
    this.pivot.rotateX(-r * (this.recoilWeapon === 'rifle' ? 0.16 : 0.07));
    this.holder.updateMatrixWorld(true);

    // Reload: the magazine drops out and a fresh one goes in.
    const w = this.inHand === 'smg' ? this.smg : this.rifle;
    const rt = this.reloadT;
    w.magMesh.visible = !(rt > 0.3 && rt < 0.62);
    void dt;
    void s;
  }

  private solveArms(s: AvatarState): void {
    const B = this.B;
    const w = this.inHand === 'smg' ? this.smg : this.rifle;
    const alive = 1 - this.deathW;
    const sprintFree = this.sprintT * this.moveT * (1 - this.aimT) * (1 - this.hipT);
    const leftIk = alive * (1 - this.castW) * (1 - sprintFree * 0.95);
    const rightIk = alive;
    w.group.updateWorldMatrix(true, true);
    w.group.getWorldQuaternion(_q);

    // Right hand on the grip.
    if (rightIk > 0.01) {
      const fk = this.captureArm('R');
      _v.copy(GRIP_OFFSET).applyMatrix4(w.group.matrixWorld);
      this.armPole('R', _v2);
      solveTwoBone(B.upperArmR, B.foreArmR, B.handR, _v, _v2, -1);
      _q2.copy(_q).multiply(GRIP_R);
      setWorldQuaternion(B.handR, _q2);
      this.blendArm('R', fk, rightIk);
      this.curl(B.fingersR, 1.35 * rightIk, 1);
      this.addRot(B.thumbR, 0, 0, 0.6 * rightIk);
    }

    // Left hand: foregrip, or the magazine/pouch during a reload.
    let target: THREE.Vector3;
    const foreQ = FORE_L[this.inHand];
    if (this.reloadT >= 0) {
      const rt = this.reloadT;
      // 0-0.3 to the mag, 0.3-0.55 to the belt pouch, 0.55-0.8 back to the mag well, then the foregrip.
      const mag = _v3.setFromMatrixPosition(w.mag.matrixWorld);
      const pouch = _v.set(0.12, 0.03, 0.12).applyMatrix4(B.hips.matrixWorld);
      const fore = _v2.copy(FORE_OFFSET[this.inHand]).applyMatrix4(w.fore.matrixWorld);
      let p: THREE.Vector3;
      if (rt < 0.25) p = fore.lerp(mag, smooth(rt / 0.25));
      else if (rt < 0.5) p = mag.clone().lerp(pouch, smooth((rt - 0.25) / 0.25));
      else if (rt < 0.75) p = pouch.clone().lerp(mag, smooth((rt - 0.5) / 0.25));
      else p = mag.clone().lerp(fore, smooth((rt - 0.75) / 0.25));
      target = this.leftTarget.copy(p);
    } else {
      target = this.leftTarget.copy(FORE_OFFSET[this.inHand]).applyMatrix4(w.fore.matrixWorld);
    }
    if (leftIk > 0.01) {
      const fk = this.captureArm('L');
      this.armPole('L', _v2);
      solveTwoBone(B.upperArmL, B.foreArmL, B.handL, target, _v2, -1);
      _q2.copy(_q).multiply(foreQ);
      setWorldQuaternion(B.handL, _q2);
      this.blendArm('L', fk, leftIk);
      this.curl(B.fingersL, 1.05 * leftIk, -1);
    }
    void s;
  }

  private readonly leftTarget = new THREE.Vector3();
  private readonly fkStore = { L: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], R: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()] };

  private captureArm(side: 'L' | 'R'): THREE.Quaternion[] {
    const st = this.fkStore[side];
    st[0].copy(this.B[`upperArm${side}`].quaternion);
    st[1].copy(this.B[`foreArm${side}`].quaternion);
    st[2].copy(this.B[`hand${side}`].quaternion);
    return st;
  }

  private blendArm(side: 'L' | 'R', fk: THREE.Quaternion[], w: number): void {
    if (w >= 0.999) return;
    const bones = [this.B[`upperArm${side}`], this.B[`foreArm${side}`], this.B[`hand${side}`]];
    bones.forEach((b, i) => {
      _q2.copy(fk[i]).slerp(b.quaternion, w);
      b.quaternion.copy(_q2);
    });
    bones[0].updateWorldMatrix(false, true);
  }

  /** Elbow hint: down, out and slightly back from the shoulder, in the chest frame. */
  private armPole(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    const s = side === 'L' ? 1 : -1;
    const aimLift = this.aimT * 0.25;
    return out.set(s * 0.55, -0.45 + aimLift, -0.25).applyMatrix4(this.B.chest.matrixWorld);
  }

  private curl(bone: THREE.Bone, amount: number, sign: 1 | -1): void {
    // Right fingers curl about +Z, left about -Z.
    this.addRot(bone, 0, 0, amount * (sign > 0 ? 1 : -1));
  }

  /** Foot planting: lower the pelvis and IK the legs onto uneven ground when standing. */
  private solveFeet(s: AvatarState): void {
    const B = this.B;
    const plant = s.grounded && !this.dead ? (1 - this.moveT * 0.7) * (1 - this.airT) : 0;
    let drop = 0;
    const deltas = [0, 0];
    const sides = ['L', 'R'] as const;
    if (plant > 0.05) {
      const rootY = this.object.position.y;
      sides.forEach((side, i) => {
        const foot = B[`foot${side}`];
        _v.setFromMatrixPosition(foot.matrixWorld);
        const lift = _v.y - (rootY + ANKLE_HEIGHT);
        _v2.set(_v.x, rootY + 0.5, _v.z);
        if (this.game.physics.raycast(_v2, _down, 1.1, MASK.world, _hit)) {
          const groundY = _hit.point.y;
          const d = THREE.MathUtils.clamp(groundY - rootY, -0.4, 0.4);
          deltas[i] = d;
          void lift;
        }
      });
      drop = Math.min(0, deltas[0], deltas[1]);
    }
    this.pelvisDrop += (drop * plant - this.pelvisDrop) * 0.25;
    if (plant <= 0.05) return;
    sides.forEach((side, i) => {
      const d = deltas[i] - this.pelvisDrop;
      if (Math.abs(d) < 0.01) return;
      const thigh = B[`thigh${side}`];
      const shin = B[`shin${side}`];
      const foot = B[`foot${side}`];
      foot.getWorldQuaternion(this.footPre[i]);
      _v.setFromMatrixPosition(foot.matrixWorld);
      _v.y += d * plant;
      // Knee hint: forward of the knee.
      _v2.set(0, 0, 0.6).applyMatrix4(shin.matrixWorld);
      solveTwoBone(thigh, shin, foot, _v, _v2, 1);
      setWorldQuaternion(foot, this.footPre[i]);
    });
  }

  private applyFace(dt: number): void {
    const B = this.B;
    // Upper lids: open sits at 0; a blink rotates them down over the eyes.
    const lid = this.dead ? 0.8 : Math.min(1, this.blink * 1.6) * 0.8;
    B.lidL.quaternion.setFromAxisAngle(_v.set(1, 0, 0), lid);
    B.lidR.quaternion.copy(B.lidL.quaternion);
    // Talking: a soft jaw flap.
    const t = this.time;
    const talk = this.talkW * Math.max(0, Math.sin(t * 13) * Math.sin(t * 4.3 + 1)) * 0.11;
    B.jaw.quaternion.setFromAxisAngle(_v.set(1, 0, 0), talk);
    void dt;
  }
}

function smooth(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

void _m;
