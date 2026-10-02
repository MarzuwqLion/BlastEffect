import * as THREE from 'three';
import { CONFIG, DEG, type EnemyConfig, type LayerMultipliers } from '../config';
import { MASK } from '../core/Physics';
import { emptyResult, type DamageResult, type HitZone } from '../combat/damage';
import { BOSS_BARKS, NAMES, OBJECTIVES } from '../strings';
import { ARENA_Y } from '../level/sections/basin';
import type { Game } from '../game/Game';
import { Enemy } from './Enemy';
import type { LightAnchor } from '../level/LevelBuilder';
import { BossModel } from './BossModel';

const BC = CONFIG.boss;
const AT = BC.attacks;
type Attack = keyof typeof AT;
type Mode = 'dormant' | 'fight' | 'attack' | 'roar' | 'leap' | 'channel' | 'stagger' | 'downed';

const ATTACKS: Attack[] = ['volley', 'slam', 'drag', 'lunge', 'orbs'];
const KA_GREEN = 0x40ff9a;
const UP = new THREE.Vector3(0, 1, 0);
/** Where he stands for the intro and channels during reinforcement waves. */
const DAIS = new THREE.Vector3(0, ARENA_Y + 1, -325.2);
const ARENA = { minX: -21, maxX: 21, minZ: -321, maxZ: -287 };
const EAST_DOOR = new THREE.Vector3(22.6, ARENA_Y, -306);
const WEST_DOOR = new THREE.Vector3(-22.6, ARENA_Y, -306);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _empty = emptyResult();

const BOSS_CFG: EnemyConfig = {
  id: 'boss',
  shield: BC.shield,
  armor: BC.armor,
  health: BC.health,
  walkSpeed: BC.walkSpeed,
  runSpeed: BC.walkSpeed * BC.enragedSpeed,
  radius: BC.radius,
  height: BC.height,
  preferredRangeMin: BC.rangeMin,
  preferredRangeMax: BC.rangeMax,
  weapon: {
    boltDamage: AT.volley.damage,
    boltSpeed: AT.volley.speed,
    burstCount: AT.volley.bolts,
    burstInterval: 0,
    spread: AT.volley.spreadDeg,
    telegraph: AT.volley.telegraph,
    cooldownMin: AT.volley.cooldown,
    cooldownMax: AT.volley.cooldown,
    range: 60,
  },
  thinkInterval: 0.25,
  repositionChance: 0,
  staggerResist: 1,
  mass: 900,
  hasWeakPoint: true,
  weakRadius: BC.weakRadius,
  score: 5000,
};

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function additive(uniforms: Record<string, { value: unknown }>, vertex: string, fragment: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

const UV_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * The Crocodile. A slow, heavy brawler who fights with ka powers stolen from
 * the implants he harvests: a fan of bolts (volley), a ground shockwave you
 * jump over (slam), a tether that yanks you out of cover (drag), a charge
 * along a telegraphed line that stuns him if it ends in a wall (lunge) and
 * homing orbs. Three layers, three phases; each broken layer sends him back
 * to his dais to channel while his crew comes through the side doors.
 */
export class Crocodile extends Enemy {
  readonly croc: BossModel;
  mode: Mode = 'dormant';
  modeT = 0;
  phase = 1;
  current: Attack | null = null;
  invulnerable = true;
  readonly reinforcements: Enemy[] = [];
  /** Counts for tests and the debug overlay. */
  readonly stats = { attacks: { volley: 0, slam: 0, drag: 0, lunge: 0, orbs: 0 } as Record<Attack, number>, staggers: 0, wallHits: 0 };

  private atkT = 0;
  private atkTele = 0;
  private fired = 0;
  private queued: Attack | null = null;
  private readonly cds: Record<Attack, number> = { volley: 0, slam: 0, drag: 0, lunge: 0, orbs: 0 };
  private gapT = 2;
  private moveT = 0;
  private recentDamage = 0;
  private staggerCd = 0;
  private stunT = 0;
  private doorCloseT = -1;
  private speedNow = 0;
  private readonly lastPos = new THREE.Vector3();

  // Slam ring.
  private ringActive = false;
  private ringR = 0;
  private ringHit = false;
  private readonly ringCenter = new THREE.Vector3();
  private readonly ringMesh: THREE.Mesh;
  // Lunge.
  private readonly lungeDir = new THREE.Vector3(0, 0, 1);
  private lungeLen = 0;
  private lungeDist = 0;
  private lungeHit = false;
  private charging = false;
  private readonly stripe: THREE.Mesh;
  // Drag tether.
  private tetherT = 0;
  // Invulnerable channel bubble.
  private readonly bubble: THREE.Mesh;
  private bubbleHit = 0;
  private readonly leapFrom = new THREE.Vector3();
  /** A green light rides with him so he reads at range in a dark arena. */
  private readonly glow: LightAnchor = { pos: new THREE.Vector3(0, -200, 0), color: new THREE.Color(KA_GREEN), intensity: 3, distance: 8, section: 5, flicker: 0 };

  constructor(game: Game) {
    const model = new BossModel();
    super(game, 'boss', BOSS_CFG, model);
    this.croc = model;
    game.lights.addAnchors([this.glow]);

    const ringMat = additive(
      { uColor: { value: new THREE.Color(KA_GREEN) }, uAlpha: { value: 1 } },
      UV_VERT,
      /* glsl */ `varying vec2 vUv; uniform vec3 uColor; uniform float uAlpha;
        void main(){ float a = pow(1.0 - vUv.y, 2.0) * uAlpha * 0.55; gl_FragColor = vec4(uColor * 1.4, a); }`,
    );
    this.ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 72, 1, true).translate(0, 0.45, 0), ringMat);
    this.ringMesh.visible = false;
    this.ringMesh.renderOrder = 4;
    game.scene.add(this.ringMesh);

    const stripeMat = additive(
      { uColor: { value: new THREE.Color(KA_GREEN) }, uProgress: { value: 0 }, uTime: { value: 0 } },
      UV_VERT,
      /* glsl */ `varying vec2 vUv; uniform vec3 uColor; uniform float uProgress; uniform float uTime;
        void main(){
          float edge = smoothstep(0.4, 0.5, abs(vUv.x - 0.5));
          float fill = step(vUv.y, uProgress) * 0.25;
          float chev = step(0.75, fract(vUv.y * 9.0 - abs(vUv.x - 0.5) * 2.0 - uTime * 2.0)) * 0.35 * step(vUv.y, uProgress);
          gl_FragColor = vec4(uColor * 2.0, (edge * 0.8 + fill + chev) * (0.4 + uProgress * 0.6));
        }`,
    );
    this.stripe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), stripeMat);
    this.stripe.visible = false;
    this.stripe.renderOrder = 4;
    game.scene.add(this.stripe);

    const bubbleMat = additive(
      { uTime: { value: 0 }, uHit: { value: 0 } },
      /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime; uniform float uHit;
        void main(){
          float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          float glyph = step(0.92, fract(vP.y * 6.0 - uTime * 0.6)) * 0.25;
          gl_FragColor = vec4(vec3(0.25, 1.0, 0.6) * (0.8 + uHit * 1.5), f * 0.45 + glyph * f + uHit * 0.2);
        }`,
    );
    bubbleMat.side = THREE.FrontSide;
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), bubbleMat);
    this.bubble.scale.set(2.1, 2.3, 2.1);
    this.bubble.position.y = 1.6;
    this.bubble.visible = false;
    this.bubble.renderOrder = 5;
    this.model.root.add(this.bubble);
  }

  private get tempo(): number {
    return BC.phaseTempo[this.phase - 1];
  }

  /** Put him on the dais for the intro, full defenses, not yet fighting. */
  place(): void {
    const pp = this.game.player.position;
    const yaw = Math.atan2(-(pp.x - DAIS.x), -(pp.z - DAIS.z));
    this.spawn(DAIS, yaw, 5, { alerted: true });
    this.setState('idle');
    this.model.setDissolve(0);
    this.mode = 'dormant';
    this.modeT = 0;
    this.phase = 1;
    this.invulnerable = true;
    this.current = null;
    this.queued = null;
    this.ringActive = false;
    this.ringMesh.visible = false;
    this.stripe.visible = false;
    this.bubble.visible = false;
    this.reinforcements.length = 0;
    this.croc.action = 'none';
    this.croc.kaLevel = 0.4;
    for (const a of ATTACKS) this.cds[a] = 0;
    this.cds.lunge = 4;
    this.cds.drag = 3;
    this.lastPos.copy(this.position);
    this.syncHitboxes();
  }

  /** The fight begins (end of the intro dialogue). */
  engage(): void {
    this.mode = 'fight';
    this.modeT = 0;
    this.invulnerable = false;
    this.gapT = 1.4;
    this.moveT = 0;
    this.setState('move');
    this.weakPointBonus = this.game.director.flags.has('intel_weakpoint') ? BC.weakPointBonusMarked : 1;
  }

  // ---- Damage ----

  override applyHit(base: number, layers: LayerMultipliers, zone: HitZone, dir: THREE.Vector3 | null, opts: { stagger?: number; source?: string } = {}): DamageResult {
    if (!this.alive) return emptyResult(_empty);
    if (this.invulnerable) {
      this.bubbleHit = 1;
      return emptyResult(_empty);
    }
    const hadShield = this.defenses.shield > 0;
    const hadArmor = this.defenses.armor > 0;
    const r = super.applyHit(base, layers, zone, dir, opts);
    if (r.total <= 0 || r.killed) return r;
    this.recentDamage += r.total;
    if (hadShield && this.defenses.shield <= 0) this.enterTransition(2);
    else if (hadArmor && this.defenses.armor <= 0) this.enterTransition(3);
    else if (this.recentDamage >= BC.staggerDamageThreshold) {
      this.recentDamage = 0;
      this.bossStagger(BC.staggerTime, false);
    }
    return r;
  }

  /** Small staggers (melee, shots) don't move him; combos do. */
  override stagger(t: number): void {
    if (t < 1 || !this.alive) return;
    this.bossStagger(Math.min(t, BC.staggerTime), false);
  }

  override lift(): void {
    // Too heavy: Pull primes him in place (handled by Powers).
  }

  override fling(): void {
    // Nothing moves him.
  }

  override die(_dir: THREE.Vector3 | null, _impulse: number): void {
    if (!this.alive) return;
    this.alive = false;
    this.releaseToken();
    this.primedT = 0;
    this.head.setEnabled(false);
    this.weak?.setEnabled(false);
    if (this.shieldBubble) this.shieldBubble.visible = false;
    this.cancelAttack();
    this.ringActive = false;
    this.ringMesh.visible = false;
    this.bubble.visible = false;
    this.invulnerable = true;
    this.mode = 'downed';
    this.modeT = 0;
    this.croc.action = 'downed';
    this.croc.actionT = 0;
    this.setState('dead');
    this.velocity.set(0, 0, 0);
    this.game.audio.play('bossRoar', { at: this.position, volume: 0.6 });
    this.game.enemies.onDeath(this);
  }

  // ---- Update ----

  override update(dt: number): void {
    if (!this.active) return;
    this.stateT += dt;
    this.modeT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.shieldHitT = Math.max(0, this.shieldHitT - dt * 4);
    this.bubbleHit = Math.max(0, this.bubbleHit - dt * 5);
    this.barT = Math.max(0, this.barT - dt);
    if (this.primedT > 0) this.primedT = Math.max(0, this.primedT - dt);
    this.recentDamage = Math.max(0, this.recentDamage - (dt * BC.staggerDamageThreshold) / BC.staggerWindow);
    this.staggerCd -= dt;
    for (const a of ATTACKS) this.cds[a] -= dt;
    const pp = this.game.player.position;
    this.distToPlayer = Math.hypot(pp.x - this.position.x, pp.z - this.position.z);
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = BOSS_CFG.thinkInterval;
      this.updateLos();
    }

    let physics = true;
    switch (this.mode) {
      case 'dormant':
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.faceToward(pp, 1.5, dt);
        break;
      case 'fight':
        this.updateFight(dt);
        break;
      case 'attack':
        this.updateAttack(dt);
        break;
      case 'roar':
        this.velocity.multiplyScalar(0.8);
        this.croc.actionT = this.modeT / BC.transitionTime;
        if (this.modeT >= BC.transitionTime) this.startLeap();
        break;
      case 'leap':
        physics = false;
        this.updateLeap();
        break;
      case 'channel':
        this.updateChannel(dt);
        break;
      case 'stagger':
        this.velocity.multiplyScalar(0.85);
        this.croc.actionT = this.modeT / this.stunT;
        if (this.modeT >= this.stunT) {
          this.mode = 'fight';
          this.modeT = 0;
          this.setState('move');
          this.gapT = Math.max(this.gapT, 0.8);
        }
        break;
      case 'downed':
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.croc.actionT = this.modeT;
        break;
    }
    this.updateRing(dt);
    if (physics) this.moveKinematic(dt, this.mode === 'downed' || this.mode === 'dormant');
    this.speedNow = Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z) / Math.max(dt, 1e-4);
    this.lastPos.copy(this.position);
    this.updateLooks(dt);
  }

  /** Dialogue: no AI, just breathe and talk. */
  idle(dt: number): void {
    if (!this.active) return;
    this.modeT += dt;
    if (this.mode === 'downed') this.croc.actionT = this.modeT;
    this.updateLooks(dt);
  }

  private updateFight(dt: number): void {
    const p = this.game.player;
    if (this.frozen || !p.alive) {
      this.velocity.x *= 0.8;
      this.velocity.z *= 0.8;
      return;
    }
    this.moveT -= dt;
    if (this.moveT <= 0) {
      this.moveT = 2.4 + Math.random() * 1.6;
      this.pickSpot();
    }
    this.followPath(dt);
    this.faceToward(p.position, BC.turnRate, dt);
    this.gapT -= dt;
    if (this.gapT <= 0) {
      const a = this.chooseAttack();
      if (a) this.beginAttack(a);
      else this.gapT = 0.35;
    }
  }

  /** A spot on the ground floor at his preferred range, roughly where he is. */
  private pickSpot(): void {
    const pp = this.game.player.position;
    const nav = this.game.director.nav;
    if (!nav) return;
    const min = this.phase === 3 ? BC.rangeMin * 0.7 : BC.rangeMin;
    const want = Math.min(BC.rangeMax, Math.max(min, this.distToPlayer - 2));
    const base = Math.atan2(this.position.x - pp.x, this.position.z - pp.z);
    for (let i = 0; i < 8; i++) {
      const ang = base + (Math.random() - 0.5) * 1.6;
      const r = want + (Math.random() - 0.5) * 4;
      _v.set(
        Math.min(ARENA.maxX, Math.max(ARENA.minX, pp.x + Math.sin(ang) * r)),
        ARENA_Y,
        Math.min(ARENA.maxZ, Math.max(ARENA.minZ, pp.z + Math.cos(ang) * r)),
      );
      if (nav.randomNear(_v, 1.5, _v2, 4) && _v2.y < ARENA_Y + 0.6) {
        this.setGoal(_v2);
        this.moveSpeed = this.phase === 3 ? BOSS_CFG.runSpeed : BOSS_CFG.walkSpeed;
        return;
      }
    }
  }

  private chooseAttack(): Attack | null {
    const p = this.game.player;
    const dy = p.position.y - this.position.y;
    const ground = Math.abs(dy) < 1.2;
    let a: Attack | null = null;
    if (this.queued) {
      a = this.queued;
      this.queued = null;
    } else {
      const cand: Attack[] = [];
      const weights: number[] = [];
      let total = 0;
      const add = (k: Attack, w: number): void => {
        if (this.cds[k] > 0 || w <= 0) return;
        cand.push(k);
        weights.push(w);
        total += w;
      };
      const d = this.distToPlayer;
      if (this.los) add('volley', 2);
      add('orbs', this.los ? 1.2 : 3);
      if (ground && d < AT.slam.triggerRange) add('slam', 4);
      if (this.phase >= 2) {
        if (this.los && d > 7 && d < AT.drag.range) add('drag', dy > 1.5 ? 5 : 1.8);
        if (this.los && ground && d > 5 && d < AT.lunge.maxDistance - 2) add('lunge', 2.2);
      }
      if (total <= 0) return null;
      let r = Math.random() * total;
      for (let i = 0; i < cand.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          a = cand[i];
          break;
        }
      }
      a ??= cand[cand.length - 1];
    }
    if (!this.game.enemies.tokens.request(this)) return null;
    this.hasToken = true;
    return a;
  }

  private beginAttack(a: Attack, telegraph?: number): void {
    this.current = a;
    this.mode = 'attack';
    this.modeT = 0;
    this.atkT = 0;
    this.fired = 0;
    this.charging = false;
    this.tetherT = 0;
    this.atkTele = Math.max(CONFIG.ai.minTelegraph, telegraph ?? AT[a].telegraph * (this.phase === 3 ? 0.9 : 1));
    this.croc.action = a;
    this.croc.actionT = 0;
    this.stats.attacks[a]++;
    this.setState('telegraph');
    this.hasGoal = false;
    const at = this.position;
    switch (a) {
      case 'volley':
        this.game.audio.play('enemyCharge', { at, volume: 0.9 });
        break;
      case 'slam':
        this.game.fx.telegraphRing(this.position, AT.slam.radius, this.atkTele, KA_GREEN);
        this.game.audio.play('heavyWindup', { at });
        break;
      case 'drag':
        this.game.audio.play('enemyCharge', { at });
        break;
      case 'lunge':
        this.aimLunge();
        this.stripe.visible = true;
        this.game.audio.play('bossCharge', { at });
        break;
      case 'orbs':
        this.game.audio.play('bossOrb', { at });
        if (Math.random() < 0.3) this.game.hud.bark(NAMES.boss, pick(BOSS_BARKS.orbs));
        break;
    }
  }

  private endAttack(): void {
    const a = this.current;
    if (a) this.cds[a] = AT[a].cooldown * this.tempo;
    this.cancelAttack();
    this.mode = 'fight';
    this.modeT = 0;
    this.setState('move');
    this.gapT = (BC.attackGapMin + Math.random() * (BC.attackGapMax - BC.attackGapMin)) * this.tempo;
    if (this.queued) this.gapT = 0;
    this.moveT = Math.min(this.moveT, 0.3);
  }

  private cancelAttack(): void {
    this.current = null;
    this.charging = false;
    this.tetherT = 0;
    this.stripe.visible = false;
    this.releaseToken();
    this.game.fx.clearTelegraph(this);
    if (this.croc.action !== 'downed') this.croc.action = 'none';
  }

  private updateAttack(dt: number): void {
    const p = this.game.player;
    this.atkT += dt;
    const tele = this.atkTele;
    const prog = Math.min(1, this.atkT / tele);
    if (!this.charging) {
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }
    switch (this.current) {
      case 'volley': {
        this.faceToward(p.position, BC.turnRate * 1.4, dt);
        if (this.fired === 0) {
          this.croc.actionT = prog * 0.8;
          this.handsCenter(_v);
          p.aimPoint(_v2);
          this.game.fx.telegraphLine(this, _v, _v2, prog, 'green');
          if (prog >= 1) {
            this.game.fx.clearTelegraph(this);
            this.fireVolley(0);
            this.fired = 1;
          }
        } else {
          this.croc.actionT = 0.8 + Math.min(0.2, (this.atkT - tele) * 0.5);
          if (this.phase === 3 && this.fired === 1 && this.atkT > tele + 0.35) {
            this.fireVolley(0.5);
            this.fired = 2;
          }
          if (this.atkT > tele + (this.phase === 3 ? 0.9 : 0.6)) this.endAttack();
        }
        break;
      }
      case 'slam': {
        if (this.fired === 0) {
          this.croc.actionT = prog * 0.75;
          if (prog >= 1) {
            this.fired = 1;
            this.slamImpact();
          }
        } else {
          this.croc.actionT = Math.min(1, 0.75 + (this.atkT - tele) * 2);
          if (this.atkT > tele + 0.8) this.endAttack();
        }
        break;
      }
      case 'drag':
        this.updateDrag(dt, prog);
        break;
      case 'lunge':
        this.updateLunge(dt, prog);
        break;
      case 'orbs': {
        this.faceToward(p.position, BC.turnRate, dt);
        this.croc.actionT = prog;
        if (this.fired === 0) {
          // Orbs gather over his head while he raises his hands.
          this.croc.headWorld(_v);
          if (Math.random() < 0.6) this.game.fx.sparkle(_v.set(_v.x + (Math.random() - 0.5) * 2, _v.y + 0.6 + Math.random(), _v.z + (Math.random() - 0.5) * 2), KA_GREEN);
          if (prog >= 1) {
            this.fired = 1;
            this.fireOrbs();
          }
        } else if (this.atkT > tele + 0.6) {
          this.endAttack();
        }
        break;
      }
      default:
        this.endAttack();
    }
  }

  private handsCenter(out: THREE.Vector3): THREE.Vector3 {
    this.croc.handWorld(out, 1);
    this.croc.handWorld(_v3, -1);
    return out.add(_v3).multiplyScalar(0.5);
  }

  private fireVolley(offset: number): void {
    const p = this.game.player;
    const muzzle = this.handsCenter(_v);
    p.aimPoint(_v2);
    const travel = muzzle.distanceTo(_v2) / AT.volley.speed;
    _v2.addScaledVector(p.velocity, travel * 0.4);
    const dir = _v2.sub(muzzle).normalize();
    const n = AT.volley.bolts + (this.phase === 3 ? 1 : 0);
    const spread = AT.volley.spreadDeg * DEG;
    for (let i = 0; i < n; i++) {
      const ang = ((i + offset) / (n - 1) - 0.5) * spread;
      _q.setFromAxisAngle(UP, ang);
      _v3.copy(dir).applyQuaternion(_q);
      this.game.bolts.spawn(muzzle, _v3, AT.volley.speed, AT.volley.damage, KA_GREEN, this, { size: 1.7, life: 3 });
    }
    this.croc.kickRecoil(1);
    this.game.fx.sparkle(muzzle, KA_GREEN);
    this.game.audio.play('bossVolley', { at: muzzle });
  }

  private slamImpact(): void {
    const g = this.game;
    this.ringActive = true;
    this.ringR = 0.6;
    this.ringHit = false;
    this.ringCenter.copy(this.position);
    this.ringMesh.position.copy(this.position);
    this.ringMesh.visible = true;
    g.fx.shockwave(this.position, 4, KA_GREEN);
    g.audio.play('bossSlam', { at: this.position });
    const dist = g.player.position.distanceTo(this.position);
    g.rig.addShake(Math.max(0.15, 0.7 - dist / 25));
    g.input.rumble(0.6, 0.25);
  }

  private updateRing(dt: number): void {
    if (!this.ringActive) return;
    const S = AT.slam;
    this.ringR += S.ringSpeed * dt;
    const k = this.ringR / S.radius;
    this.ringMesh.scale.set(this.ringR, 1 - k * 0.5, this.ringR);
    (this.ringMesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 1 - k * 0.7;
    const p = this.game.player;
    if (!this.ringHit && p.alive) {
      const d = Math.hypot(p.position.x - this.ringCenter.x, p.position.z - this.ringCenter.z);
      const onFloor = p.grounded && Math.abs(p.position.y - this.ringCenter.y) < 1.0;
      if (onFloor && Math.abs(d - this.ringR) < S.ringWidth * 0.5 + CONFIG.player.radius) {
        this.ringHit = true;
        p.takeDamage(S.damage, this.ringCenter);
        _v.copy(p.position).sub(this.ringCenter).setY(0);
        if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
        _v.normalize().multiplyScalar(S.knockback);
        p.addKnockback(_v.x, 6, _v.z);
      }
    }
    if (this.ringR >= S.radius) {
      this.ringActive = false;
      this.ringMesh.visible = false;
    }
  }

  private updateDrag(dt: number, prog: number): void {
    const g = this.game;
    const p = g.player;
    const D = AT.drag;
    this.croc.handWorld(_v, -1);
    p.aimPoint(_v2);
    if (this.tetherT <= 0 && this.fired === 0) {
      this.faceToward(p.position, BC.turnRate * 1.4, dt);
      this.croc.actionT = prog * 0.6;
      g.fx.telegraphLine(this, _v, _v2, prog, 'green');
      if (prog >= 1) {
        this.fired = 1;
        const blocked = g.physics.blocked(_v, _v2);
        if (blocked || !p.alive || this.distToPlayer > D.range || p.dashT > 0) {
          // She was behind cover (or dodged): the tether snaps.
          g.fx.clearTelegraph(this);
          g.fx.powerFizzle(_v, KA_GREEN);
          this.endAttack();
          return;
        }
        this.tetherT = D.duration;
        p.takeDamage(D.damage, this.position);
        g.audio.play('bossDrag', { at: this.position });
        g.rig.addShake(0.25);
        if (Math.random() < 0.5) g.hud.bark(NAMES.boss, pick(BOSS_BARKS.drag));
      }
      return;
    }
    if (this.tetherT > 0) {
      this.tetherT -= dt;
      this.croc.actionT = 0.6 + (1 - this.tetherT / D.duration) * 0.4;
      g.fx.telegraphLine(this, _v, _v2, 1, 'green');
      p.pullToward(this.position, D.pullSpeed, dt);
      if (this.tetherT <= 0 || p.dashT > 0 || !p.alive) {
        this.tetherT = 0;
        g.fx.clearTelegraph(this);
        // Reeled in close: follow up with a quick slam.
        if (this.distToPlayer < 6.5 && this.cds.slam < 2) this.queued = 'slam';
        this.endAttack();
      }
    }
  }

  private aimLunge(): void {
    const pp = this.game.player.position;
    this.lungeDir.set(pp.x - this.position.x, 0, pp.z - this.position.z);
    if (this.lungeDir.lengthSq() < 1e-4) this.lungeDir.set(0, 0, 1);
    this.lungeDir.normalize();
    // Length: up to the first wall or column (that is where he stops, stunned).
    _v.set(this.position.x, this.position.y + 0.6, this.position.z);
    const hit = this.game.physics.raycast(_v, this.lungeDir, AT.lunge.maxDistance, MASK.world, this.game.scratchHit);
    this.lungeLen = hit ? Math.max(1, this.game.scratchHit.distance - this.radius * 0.5) : AT.lunge.maxDistance;
    this.stripe.position.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.stripe.rotation.y = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    this.stripe.scale.set(AT.lunge.width, 1, this.lungeLen);
  }

  private updateLunge(dt: number, prog: number): void {
    const g = this.game;
    const L = AT.lunge;
    const u = (this.stripe.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = g.time.now;
    if (!this.charging && this.fired === 0) {
      // Track her for the first part of the wind-up, then commit.
      if (prog < 0.6) this.aimLunge();
      u.uProgress.value = prog;
      this.croc.actionT = prog;
      this.faceDir(this.lungeDir, 8, dt);
      if (prog >= 1) {
        this.charging = true;
        this.fired = 1;
        this.lungeDist = 0;
        this.lungeHit = false;
        g.audio.play('dash', { at: this.position, volume: 1 });
      }
      return;
    }
    if (this.charging) {
      const step = L.speed * dt;
      // Wall or column ahead: crash and stun.
      _v.set(this.position.x, this.position.y + 0.6, this.position.z);
      if (g.physics.raycast(_v, this.lungeDir, this.radius + step + 0.1, MASK.world, g.scratchHit)) {
        this.charging = false;
        this.stripe.visible = false;
        this.velocity.set(0, this.velocity.y, 0);
        this.stats.wallHits++;
        g.fx.dust(this.position, 1.4);
        g.fx.shockwave(_v.addScaledVector(this.lungeDir, this.radius), 2.5, 0xffb060);
        g.audio.play('stomp', { at: this.position });
        g.rig.addShake(Math.max(0.1, 0.5 - this.distToPlayer / 30));
        if (Math.random() < 0.5) g.hud.bark(NAMES.boss, pick(BOSS_BARKS.lungeWall));
        this.endAttack();
        this.bossStagger(L.wallStagger, true);
        return;
      }
      this.velocity.x = this.lungeDir.x * L.speed;
      this.velocity.z = this.lungeDir.z * L.speed;
      this.lungeDist += step;
      this.croc.actionT = 1;
      g.fx.dust(this.position, 0.3);
      const p = g.player;
      if (!this.lungeHit && p.alive) {
        const dx = p.position.x - this.position.x;
        const dz = p.position.z - this.position.z;
        const along = dx * this.lungeDir.x + dz * this.lungeDir.z;
        const side = Math.abs(dx * this.lungeDir.z - dz * this.lungeDir.x);
        if (along > -0.5 && along < this.radius + step + 0.4 && side < L.width * 0.5 + CONFIG.player.radius && Math.abs(p.position.y - this.position.y) < 1.8) {
          this.lungeHit = true;
          p.takeDamage(L.damage, this.position);
          const sgn = dx * this.lungeDir.z - dz * this.lungeDir.x >= 0 ? 1 : -1;
          p.addKnockback(this.lungeDir.x * 9 + this.lungeDir.z * sgn * 7, 5, this.lungeDir.z * 9 - this.lungeDir.x * sgn * 7);
          g.rig.addShake(0.4);
          g.audio.play('meleeHit', { at: p.position });
        }
      }
      if (this.lungeDist >= this.lungeLen || this.lungeDist >= L.maxDistance) {
        this.charging = false;
        this.stripe.visible = false;
        this.velocity.set(0, this.velocity.y, 0);
        this.atkT = this.atkTele; // recovery starts now
      }
      return;
    }
    // Recovery.
    this.velocity.x *= 0.7;
    this.velocity.z *= 0.7;
    this.croc.actionT = Math.max(0, 1 - (this.atkT - this.atkTele) * 1.4);
    if (this.atkT > this.atkTele + 0.7) {
      if (this.phase === 3 && this.distToPlayer < AT.slam.triggerRange && this.cds.slam < 1.5) this.queued = 'slam';
      this.endAttack();
    }
  }

  private fireOrbs(): void {
    const O = AT.orbs;
    const n = O.count + (this.phase === 3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.yaw;
      _v.set(this.position.x + Math.cos(ang) * 1.3, this.position.y + this.height + 0.4, this.position.z + Math.sin(ang) * 1.3);
      _v2.set(Math.cos(ang), 0.8, Math.sin(ang)).normalize();
      this.game.bolts.spawn(_v, _v2, O.speed, O.damage, KA_GREEN, this, { size: 3, homing: O.homing, life: O.life });
    }
    this.game.audio.play('bossOrb', { at: this.position });
  }

  /** Staggered: attack cancelled, open for a moment. */
  private bossStagger(t: number, force: boolean): void {
    if (!this.alive) return;
    if (this.mode !== 'fight' && this.mode !== 'attack') return;
    if (!force && this.staggerCd > 0) return;
    this.staggerCd = BC.staggerCooldown;
    this.cancelAttack();
    this.queued = null;
    this.mode = 'stagger';
    this.modeT = 0;
    this.stunT = t;
    this.croc.action = 'stagger';
    this.croc.actionT = 0;
    this.stats.staggers++;
    this.setState('stagger');
    this.staggerT = t;
    this.game.audio.play('impactHeavy', { at: this.position });
  }

  // ---- Phase transitions ----

  private enterTransition(next: number): void {
    const g = this.game;
    this.phase = next;
    this.cancelAttack();
    this.queued = null;
    this.mode = 'roar';
    this.modeT = 0;
    this.invulnerable = true;
    this.hasGoal = false;
    this.setState('idle');
    this.croc.action = 'roar';
    this.croc.actionT = 0;
    this.croc.kaLevel = next === 2 ? 0.7 : 1;
    g.audio.play('bossRoar', { at: this.position });
    g.audio.play('phaseChange');
    g.rig.addShake(0.45);
    g.time.hitStop(0.12);
    g.input.rumble(0.8, 0.5);
    g.fx.shockwave(this.position, 7, KA_GREEN);
    const p = g.player;
    const d = p.position.distanceTo(this.position);
    if (d < 7) {
      _v.copy(p.position).sub(this.position).setY(0).normalize().multiplyScalar(11 * (1 - d / 9));
      p.addKnockback(_v.x, 4, _v.z);
    }
    g.hud.bark(NAMES.boss, next === 2 ? BOSS_BARKS.phase2 : BOSS_BARKS.phase3);
    g.events.emit('bossPhase', next);
  }

  private startLeap(): void {
    this.mode = 'leap';
    this.modeT = 0;
    this.leapFrom.copy(this.position);
    this.croc.action = 'lunge';
    this.croc.actionT = 0.5;
    this.game.audio.play('jump', { at: this.position, volume: 1 });
    this.game.fx.dust(this.position, 1);
  }

  private updateLeap(): void {
    const t = Math.min(1, this.modeT / BC.leapTime);
    const e = t * t * (3 - 2 * t);
    this.position.lerpVectors(this.leapFrom, DAIS, e);
    this.position.y += 4.5 * 4 * t * (1 - t);
    _v.copy(DAIS).sub(this.leapFrom).setY(0);
    if (_v.lengthSq() > 0.01 && t < 0.7) this.faceDir(_v.normalize(), 6, 1 / 60);
    else this.faceToward(this.game.player.position, 3, 1 / 60);
    this.croc.actionT = 0.6 + t * 0.4;
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.centerOffset, z: this.position.z });
    this.body.setNextKinematicRotation(_q.setFromAxisAngle(UP, this.yaw));
    if (t >= 1) {
      this.position.copy(DAIS);
      this.velocity.set(0, 0, 0);
      const g = this.game;
      g.fx.shockwave(DAIS, 4, KA_GREEN);
      g.audio.play('stomp', { at: DAIS });
      g.rig.addShake(0.3);
      const p = g.player;
      const d = Math.hypot(p.position.x - DAIS.x, p.position.z - DAIS.z);
      if (d < 3.5) {
        _v.copy(p.position).sub(DAIS).setY(0);
        if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
        _v.normalize().multiplyScalar(12);
        p.addKnockback(_v.x, 5, _v.z);
      }
      this.startChannel();
    }
  }

  private startChannel(): void {
    const g = this.game;
    this.mode = 'channel';
    this.modeT = 0;
    this.croc.action = 'channel';
    this.croc.actionT = 0;
    this.bubble.visible = true;
    this.reinforcements.length = 0;
    const list = BC.reinforcements[this.phase - 2] ?? [];
    g.director.openDoor('basinEast');
    g.director.openDoor('basinWest');
    list.forEach((kind, i) => {
      const door = i % 2 === 0 ? EAST_DOOR : WEST_DOOR;
      const row = Math.floor(i / 2);
      _v.set(door.x - Math.sign(door.x) * row * 1.6, door.y, door.z + (row % 2 === 0 ? 1.4 : -1.4) * (row > 0 ? 1 : 0));
      const yaw = Math.atan2(-(0 - _v.x), -(-306 - _v.z));
      const e = g.enemies.spawn(kind, _v, yaw, 5, { alerted: true, delay: 0.6 + i * 0.5 });
      g.fx.spawnIn(_v, e.height);
      this.reinforcements.push(e);
    });
    this.doorCloseT = 4.5;
    g.director.setObjective(OBJECTIVES.bossWave);
  }

  private updateChannel(dt: number): void {
    const g = this.game;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.faceToward(g.player.position, 1.2, dt);
    this.croc.actionT = this.modeT;
    if (this.doorCloseT > 0) {
      this.doorCloseT -= dt;
      if (this.doorCloseT <= 0) {
        g.director.closeDoor('basinEast');
        g.director.closeDoor('basinWest');
      }
    }
    let alive = 0;
    for (const e of this.reinforcements) if (e.alive) alive++;
    if ((alive === 0 && this.modeT > 3) || this.modeT > BC.channelMax) this.endChannel();
  }

  private endChannel(): void {
    const g = this.game;
    this.bubble.visible = false;
    this.invulnerable = false;
    this.mode = 'fight';
    this.modeT = 0;
    this.croc.action = 'none';
    this.setState('move');
    this.gapT = 1.2;
    this.moveT = 0;
    this.recentDamage = 0;
    if (this.doorCloseT > 0) {
      g.director.closeDoor('basinEast');
      g.director.closeDoor('basinWest');
      this.doorCloseT = -1;
    }
    g.director.setObjective(OBJECTIVES.boss, 'boss');
    g.hud.bark(NAMES.boss, BOSS_BARKS.resume);
    g.audio.play('phaseChange', { volume: 0.6 });
  }

  // ---- Facing, visuals, hitboxes ----

  private faceToward(target: THREE.Vector3, rate: number, dt: number): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    if (dx * dx + dz * dz < 0.01) return;
    const want = Math.atan2(-dx, -dz);
    const d = wrapAngle(want - this.yaw);
    const maxStep = rate * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }

  private faceDir(dir: THREE.Vector3, rate: number, dt: number): void {
    _v3.set(this.position.x + dir.x, 0, this.position.z + dir.z);
    this.faceToward(_v3, rate, dt);
  }

  private updateLooks(dt: number): void {
    const t = this.game.time.now;
    this.model.setFlash(this.hitFlashColor.x, this.hitFlashColor.y, this.hitFlashColor.z, this.hitFlash * 0.7);
    if (this.primed) {
      this.model.setGlow(0.25, 0.95, 1.0, 0.6 + Math.sin(t * 10) * 0.25);
    } else if (this.mode === 'attack' && !this.fired && this.atkTele > 0) {
      this.model.setGlow(0.3, 1, 0.6, Math.min(1, this.atkT / this.atkTele) * 0.32);
    } else if (this.mode === 'roar' || this.mode === 'channel') {
      this.model.setGlow(0.3, 1, 0.6, 0.16 + Math.sin(t * 6) * 0.06);
    } else if (this.mode === 'stagger') {
      this.model.setGlow(1, 0.8, 0.3, 0.25);
    } else {
      this.model.setGlow(0, 0, 0, 0);
    }
    if (this.mode === 'channel') this.croc.kaLevel = 1.3;
    else if (this.mode === 'downed') this.croc.kaLevel = Math.max(0, 0.6 - this.modeT * 0.2);
    else this.croc.kaLevel = this.phase === 1 ? 0.45 : this.phase === 2 ? 0.75 : 1;
    if (this.shieldBubble && this.shieldBubble.visible) {
      const u = (this.shieldBubble.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uHit.value = this.shieldHitT;
      u.uAlpha.value = 0.35 + 0.5 * (this.defenses.shield / Math.max(1, this.defenses.shieldMax));
    }
    if (this.bubble.visible) {
      const u = (this.bubble.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uHit.value = this.bubbleHit;
    }
    this.syncModel();
    // In front of his chest, so his face and armour read from where she stands.
    this.croc.chestWorld(this.glow.pos);
    this.glow.pos.x -= Math.sin(this.yaw) * 1.3;
    this.glow.pos.z -= Math.cos(this.yaw) * 1.3;
    this.glow.intensity = this.mode === 'downed' ? 1.5 : this.mode === 'channel' ? 4 : 2.5 + this.phase * 0.5;
    if (this.shieldBubble) this.shieldBubble.visible = this.defenses.shield > 0 && this.mode !== 'dormant' && this.mode !== 'downed';
    const pp = this.game.player.position;
    const dy = pp.y + 1.2 - (this.position.y + this.height * 0.85);
    const pitch = this.mode === 'downed' ? 0 : Math.atan2(dy, Math.max(1.5, this.distToPlayer));
    const moving = this.mode === 'fight' || (this.mode === 'attack' && this.charging);
    this.croc.bossPose(dt, moving ? Math.min(this.speedNow, 6) : 0, pitch);
    this.syncHitboxes();
  }

  /** Head and weak point hitboxes follow the animated model. */
  private syncHitboxes(): void {
    _q.setFromAxisAngle(UP, -this.yaw);
    const cy = this.position.y + this.centerOffset;
    if (this.weak) {
      this.croc.weakWorld(_v);
      _v.set(_v.x - this.position.x, _v.y - cy, _v.z - this.position.z).applyQuaternion(_q);
      this.weak.setTranslationWrtParent({ x: _v.x, y: _v.y, z: _v.z });
    }
    this.croc.headCenterWorld(_v);
    _v.set(_v.x - this.position.x, _v.y - cy, _v.z - this.position.z).applyQuaternion(_q);
    this.head.setTranslationWrtParent({ x: _v.x, y: _v.y, z: _v.z });
  }

  /** Remove from play (checkpoint reload). */
  reset(): void {
    this.deactivate();
    this.glow.pos.set(0, -200, 0);
    this.mode = 'dormant';
    this.ringActive = false;
    this.ringMesh.visible = false;
    this.stripe.visible = false;
    this.bubble.visible = false;
    this.reinforcements.length = 0;
    this.doorCloseT = -1;
  }
}

/**
 * Fight orchestration around the Crocodile: placing him for the intro,
 * starting the fight, the downed beat and the outro dialogue, and checkpoint
 * resets.
 */
export class Boss {
  readonly croc: Crocodile;
  enemy: Crocodile | null = null;
  active = false;
  private outroStarted = false;
  private downedHandled = false;
  /** Seconds the fight has run (tests, debug). */
  fightTime = 0;

  constructor(private readonly game: Game) {
    this.croc = new Crocodile(game);
  }

  /** Before the intro dialogue: he is waiting on the dais. */
  prepare(): void {
    this.croc.place();
    this.game.enemies.register(this.croc);
    this.enemy = this.croc;
    this.outroStarted = false;
    this.downedHandled = false;
    this.fightTime = 0;
  }

  /** The intro's last line: fight. */
  start(): void {
    if (!this.enemy) this.prepare();
    this.active = true;
    this.croc.engage();
    this.game.hud.setBoss(this.croc);
  }

  reset(): void {
    this.croc.reset();
    this.enemy = null;
    this.active = false;
    this.outroStarted = false;
    this.downedHandled = false;
    this.game.hud.setBoss(null);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.croc.croc.headWorld(out);
  }

  setTalking(t: boolean): void {
    this.croc.croc.talking = t;
  }

  update(dt: number): void {
    const g = this.game;
    if (!this.enemy) return;
    if (g.state === 'dialogue') {
      this.croc.idle(dt);
      return;
    }
    if (!this.active) return;
    if (this.croc.alive) this.fightTime += dt;
    if (this.croc.mode === 'downed') {
      if (!this.downedHandled) {
        this.downedHandled = true;
        this.onDowned();
      }
      if (!this.outroStarted && this.croc.modeT > 2.6 && g.state === 'playing' && g.player.alive) {
        this.outroStarted = true;
        this.active = false;
        g.startDialogue('bossOutro', null);
      }
    }
  }

  private onDowned(): void {
    const g = this.game;
    g.hud.setBoss(null);
    g.hud.bark(NAMES.boss, BOSS_BARKS.downed);
    g.bolts.clear();
    // His crew loses its nerve.
    for (const e of g.enemies.active) {
      if (e === this.croc || !e.alive) continue;
      _v.copy(e.position).sub(this.croc.position).setY(0).normalize();
      e.die(_v, 3);
    }
    g.director.onBossDowned();
  }
}
