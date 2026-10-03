import * as THREE from 'three';
import { CONFIG, DEG, type EnemyConfig, type LayerMultipliers } from '../config';
import { G, groups, MASK, RAPIER } from '../core/Physics';
import { applyDamage, defensesFor, emptyResult, hasProtection, type DamageResult, type Defenses, type HitZone } from '../combat/damage';
import { canPrime } from '../combat/combo';
import type { CoverPoint } from '../level/cover';
import type { Game } from '../game/Game';
import { EnemyModel, type EnemyKind, type EnemyVisual } from './EnemyModel';

const GREN = CONFIG.explosives.grenade;

export type EnemyState =
  | 'inactive' | 'spawning' | 'idle' | 'move' | 'cover'
  | 'telegraph' | 'fire' | 'stagger' | 'lifted' | 'falling'
  | 'flung' | 'getup' | 'stomp' | 'throw' | 'dead';

const AI = CONFIG.ai;
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _move = { x: 0, y: 0, z: 0 };
const _result = emptyResult();
const UP = new THREE.Vector3(0, 1, 0);

let nextId = 1;

/**
 * A crew member. Kinematic capsule + head (and weak point) hitboxes while
 * active; switches to a dynamic body when flung or killed. AI is a state
 * machine driven by periodic decisions (`think`) and per-frame actions.
 */
export class Enemy {
  readonly id = nextId++;
  readonly model: EnemyVisual;
  defenses: Defenses;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly head: RAPIER.Collider;
  readonly weak: RAPIER.Collider | null;
  protected readonly controller: RAPIER.KinematicCharacterController;
  readonly radius: number;
  readonly height: number;
  protected readonly halfHeight: number;
  protected readonly centerY: number;

  active = false;
  alive = false;
  state: EnemyState = 'inactive';
  stateT = 0;
  section = 0;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  grounded = true;

  // AI.
  alerted = false;
  protected thinkT = 0;
  coverPoint: CoverPoint | null = null;
  protected readonly goal = new THREE.Vector3();
  protected hasGoal = false;
  protected readonly path: THREE.Vector3[] = [];
  protected pathCount = 0;
  protected pathIdx = 0;
  protected repathT = 0;
  protected attackCd = 1;
  hasToken = false;
  protected burstLeft = 0;
  protected burstT = 0;
  telegraphT = 0;
  /** Length of the current wind-up (longer against a diver's trick, see tryAttack). */
  private telegraphTotal = 1;
  protected los = false;
  protected distToPlayer = 99;
  protected spawnGrace = 0;
  protected stompCd = 0;
  /** Grunts' grenade: own cooldown, and whether this throw has left the hand. */
  protected grenadeCd = 0;
  private thrown = false;
  protected moveSpeed = 2;
  protected aimBlend = 0;
  protected crouchBlend = 0;
  protected peek = 0;
  protected readonly aimTarget = new THREE.Vector3();

  // Effects.
  primedT = 0;
  liftT = 0;
  protected liftBaseY = 0;
  protected staggerT = 0;
  protected flungT = 0;
  protected deadT = 0;
  protected hitFlash = 0;
  protected readonly hitFlashColor = new THREE.Vector3(1, 1, 1);
  /** Seconds the HUD bar stays visible after damage/targeting. */
  barT = 0;
  lastDamageLayer: 'shield' | 'armor' | 'health' = 'health';
  shieldBubble: THREE.Mesh | null = null;
  protected shieldHitT = 0;
  /** Recently shot from this direction (for reactions). */
  protected underFireT = 0;

  constructor(protected readonly game: Game, readonly kind: EnemyKind | 'boss', readonly cfg: EnemyConfig, model?: EnemyVisual) {
    this.model = model ?? new EnemyModel(kind as EnemyKind);
    this.defenses = defensesFor(cfg);
    this.radius = cfg.radius;
    this.height = cfg.height;
    const capsuleTop = cfg.height * 0.8;
    this.halfHeight = Math.max(0.1, capsuleTop / 2 - cfg.radius);
    this.centerY = this.halfHeight + cfg.radius;
    const world = game.physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100 - this.id * 5, 0).setLinearDamping(0.25).setAngularDamping(1.5).setCcdEnabled(true),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight, cfg.radius)
        .setCollisionGroups(groups(G.ENEMY, G.WORLD | G.PLAYER | G.ENEMY | G.DEBRIS | G.QUERY))
        .setDensity(cfg.mass / (Math.PI * cfg.radius * cfg.radius * (this.halfHeight * 2 + cfg.radius * 4 / 3)))
        .setFriction(0.8)
        .setRestitution(0.1),
      this.body,
    );
    const headR = 0.15 * (cfg.height / 1.8);
    this.head = world.createCollider(
      RAPIER.ColliderDesc.ball(headR)
        .setTranslation(0, cfg.height - headR - this.centerY + 0.02, 0.03)
        .setCollisionGroups(groups(G.HITBOX, G.QUERY))
        .setDensity(0.0001),
      this.body,
    );
    if (cfg.hasWeakPoint) {
      const wl = this.model.weakLocal;
      const wy = wl ? wl.y - this.centerY : 0.4;
      // Body space faces the other way from model space (see FLIP).
      const wz = cfg.weakRadius && wl ? -wl.z : 0.36 * (cfg.height / 2.35);
      this.weak = world.createCollider(
        RAPIER.ColliderDesc.ball(cfg.weakRadius ?? 0.2 * (cfg.height / 2.35))
          .setTranslation(0, wy, wz)
          .setCollisionGroups(groups(G.HITBOX, G.QUERY))
          .setDensity(0.0001),
        this.body,
      );
    } else {
      this.weak = null;
    }
    game.physics.tag(this.collider, { kind: 'enemy', owner: this, zone: 'body', surface: 'armor' });
    game.physics.tag(this.head, { kind: 'enemy', owner: this, zone: 'head', surface: 'armor' });
    if (this.weak) game.physics.tag(this.weak, { kind: 'enemy', owner: this, zone: 'weak', surface: 'armor' });
    this.body.setEnabled(false);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle(50 * DEG);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setSlideEnabled(true);
    for (let i = 0; i < 24; i++) this.path.push(new THREE.Vector3());
    this.model.root.visible = false;
    game.scene.add(this.model.root);
    if (cfg.shield > 0) this.createShieldBubble();
  }

  /** Tests: hold position and never attack. */
  frozen = false;

  /** Extra multiplier on weak point hits (the boss raises it with intel). */
  weakPointBonus = 1;

  get weakPointActive(): boolean {
    return this.weak !== null && this.alive;
  }

  /** The boss is too big to lift; Pull primes it in place instead. */
  get canBeLifted(): boolean {
    return this.kind !== 'boss';
  }

  get centerOffset(): number {
    return this.centerY;
  }

  get isProtected(): boolean {
    return hasProtection(this.defenses);
  }

  get canBePrimed(): boolean {
    return canPrime(this.defenses) && this.alive;
  }

  get primed(): boolean {
    return this.primedT > 0 && this.alive;
  }

  /** Point to aim powers and bars at. */
  chestPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.state === 'flung' || this.state === 'dead' || this.state === 'lifted') {
      const t = this.body.translation();
      return out.set(t.x, t.y, t.z);
    }
    return out.set(this.position.x, this.position.y + this.height * 0.62, this.position.z);
  }

  topPoint(out: THREE.Vector3): THREE.Vector3 {
    this.chestPoint(out);
    out.y += this.height * 0.5;
    return out;
  }

  private createShieldBubble(): void {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uHit: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uHit; uniform float uAlpha;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
          // Hex-ish shimmer bands.
          float bands = 0.5 + 0.5 * sin(vP.y * 28.0 + uTime * 3.0) * sin(atan(vP.z, vP.x) * 10.0 + uTime);
          float a = (f * 0.55 + bands * 0.05 + uHit * 0.35) * uAlpha;
          gl_FragColor = vec4(vec3(0.3, 0.7, 1.0) * (1.0 + uHit * 2.0), a);
        }`,
    });
    this.shieldBubble = new THREE.Mesh(geo, mat);
    this.shieldBubble.scale.set(this.radius * 1.9, this.height * 0.62, this.radius * 1.9);
    this.shieldBubble.position.y = this.height * 0.52;
    this.shieldBubble.renderOrder = 5;
    this.model.root.add(this.shieldBubble);
  }

  // ---- Lifecycle ----

  spawn(pos: THREE.Vector3, yaw: number, section: number, opts: { alerted?: boolean; delay?: number } = {}): void {
    this.active = true;
    this.alive = true;
    this.section = section;
    this.defenses = defensesFor(this.cfg);
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.alerted = opts.alerted ?? true;
    this.setState('spawning');
    this.stateT = -(opts.delay ?? 0);
    this.attackCd = 0.8 + Math.random() * 1.2;
    this.spawnGrace = AI.spawnGrace + (opts.delay ?? 0);
    this.thinkT = Math.random() * 0.3;
    this.hasGoal = false;
    this.pathCount = 0;
    this.coverPoint = null;
    this.primedT = 0;
    this.liftT = 0;
    this.staggerT = 0;
    this.hasToken = false;
    this.barT = 0;
    this.stompCd = 2;
    this.grenadeCd = 5 + Math.random() * 5;
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setEnabled(true);
    this.setPhysicsMode('kinematic');
    this.body.setTranslation({ x: pos.x, y: pos.y + this.centerY, z: pos.z }, true);
    this.body.setRotation(_q.setFromAxisAngle(UP, yaw), true);
    this.head.setEnabled(true);
    this.weak?.setEnabled(true);
    this.model.root.visible = true;
    this.model.setDissolve(0.99);
    this.model.setFlash(1, 1, 1, 0);
    this.model.setGlow(0, 0, 0, 0);
    if (this.shieldBubble) this.shieldBubble.visible = this.defenses.shield > 0;
    this.syncModel();
  }

  deactivate(): void {
    this.active = false;
    this.alive = false;
    this.state = 'inactive';
    this.releaseToken();
    this.releaseCover();
    // Park the body out of the world before disabling it: scene queries can
    // still report disabled colliders, which would leave invisible blockers
    // where enemies dissolved.
    this.setPhysicsMode('kinematic');
    this.body.setTranslation({ x: 0, y: -100 - this.id * 5, z: 0 }, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setEnabled(false);
    this.model.root.visible = false;
  }

  protected setState(s: EnemyState): void {
    if (this.state === 'telegraph' || this.state === 'fire') {
      if (s !== 'fire' && s !== 'telegraph') this.game.fx.clearTelegraph(this);
    }
    this.state = s;
    this.stateT = 0;
  }

  protected setPhysicsMode(mode: 'kinematic' | 'dynamic'): void {
    if (mode === 'kinematic') {
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.collider.setCollisionGroups(groups(G.ENEMY, G.WORLD | G.PLAYER | G.ENEMY | G.DEBRIS | G.QUERY));
    } else {
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.collider.setCollisionGroups(groups(G.DEBRIS, G.WORLD | G.ENEMY | G.DEBRIS | G.QUERY));
      this.body.wakeUp();
    }
  }

  releaseToken(): void {
    if (this.hasToken) {
      this.game.enemies.tokens.release(this);
      this.hasToken = false;
    }
  }

  protected releaseCover(): void {
    if (this.coverPoint && this.coverPoint.claimedBy === this) this.coverPoint.claimedBy = null;
    this.coverPoint = null;
  }

  // ---- Damage ----

  /**
   * Apply damage through the layers. Returns the shared result object
   * (copy what you need before the next call).
   */
  applyHit(base: number, layers: LayerMultipliers, zone: HitZone, dir: THREE.Vector3 | null, opts: { stagger?: number; source?: string } = {}): DamageResult {
    if (!this.alive) return emptyResult(_result);
    const hadShield = this.defenses.shield > 0;
    const r = applyDamage(this.defenses, base, layers, _result);
    if (r.total <= 0) return r;
    this.barT = CONFIG.ui.enemyBarLinger;
    this.lastDamageLayer = r.firstLayer ?? 'health';
    this.alerted = true;
    this.underFireT = 1.5;
    this.hitFlash = 1;
    if (r.firstLayer === 'shield') this.hitFlashColor.set(0.3, 0.6, 1);
    else if (r.firstLayer === 'armor') this.hitFlashColor.set(1, 0.8, 0.2);
    else this.hitFlashColor.set(1, 0.35, 0.25);
    if (hadShield) this.shieldHitT = 1;
    if (r.shieldBroken && this.shieldBubble) {
      this.shieldBubble.visible = false;
      this.game.fx.shieldBreak(this.chestPoint(_v));
      this.game.audio.play('shieldBreak', { at: this.position });
    }
    if (r.armorBroken) {
      this.game.fx.armorBreak(this.chestPoint(_v));
      this.game.audio.play('armorBreak', { at: this.position });
    }
    if (dir) {
      const side = Math.sign(dir.x * Math.cos(this.yaw) - dir.z * Math.sin(this.yaw)) || 1;
      this.model.react(side, Math.min(1, r.total / 40));
    }
    if (r.killed) return r;
    const stagger = opts.stagger ?? 0;
    if (stagger > 0 && !this.isProtected && this.canInterrupt()) {
      const resist = this.cfg.staggerResist;
      if (Math.random() > resist * 0.8) this.stagger(stagger * (1 - resist * 0.5));
    }
    return r;
  }

  protected canInterrupt(): boolean {
    return this.state !== 'lifted' && this.state !== 'flung' && this.state !== 'dead' && this.state !== 'getup';
  }

  stagger(t: number): void {
    if (!this.alive || !this.canInterrupt()) return;
    this.releaseToken();
    this.setState('stagger');
    this.staggerT = t;
  }

  /** Pull: lift helplessly. Caller checks canBePrimed. */
  lift(duration: number, primeGrace: number): void {
    if (!this.alive) return;
    this.releaseToken();
    this.releaseCover();
    if (this.state === 'flung') {
      this.setPhysicsMode('kinematic');
      const t = this.body.translation();
      this.position.set(t.x, t.y - this.centerY, t.z);
    }
    this.setState('lifted');
    this.game.director.bark(this.kind, 'primed', 0.5);
    this.liftT = duration;
    this.liftBaseY = this.position.y;
    this.primedT = duration + primeGrace;
    this.velocity.set(0, 0, 0);
  }

  /** Physics fling (Throw, combo, death). */
  fling(vel: THREE.Vector3, spin = 4): void {
    this.releaseToken();
    this.releaseCover();
    if (this.state !== 'flung' && this.state !== 'dead') {
      this.body.setTranslation({ x: this.position.x, y: this.position.y + this.centerY + 0.05, z: this.position.z }, true);
      this.body.setRotation(_q.setFromAxisAngle(UP, this.yaw), true);
    }
    this.setPhysicsMode('dynamic');
    this.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    _v.set(vel.z, 0, -vel.x).normalize().multiplyScalar(spin);
    this.body.setAngvel({ x: _v.x + (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: _v.z }, true);
    if (this.alive) {
      this.setState('flung');
      this.flungT = 0;
    }
  }

  die(dir: THREE.Vector3 | null, impulse: number): void {
    if (!this.alive) return;
    this.alive = false;
    this.releaseToken();
    this.releaseCover();
    this.primedT = 0;
    this.head.setEnabled(false);
    this.weak?.setEnabled(false);
    if (this.shieldBubble) this.shieldBubble.visible = false;
    const v = _v2.set(0, 0, 0);
    if (dir) v.copy(dir).setY(0).normalize().multiplyScalar(impulse);
    v.y = 2 + impulse * 0.35;
    if (this.state === 'flung' || this.state === 'dead') {
      const lv = this.body.linvel();
      v.x += lv.x;
      v.y += Math.max(0, lv.y);
      v.z += lv.z;
    }
    this.fling(v, 3 + impulse * 0.4);
    this.setState('dead');
    this.deadT = 0;
    this.game.enemies.onDeath(this);
  }

  // ---- Update ----

  update(dt: number): void {
    if (!this.active) return;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.shieldHitT = Math.max(0, this.shieldHitT - dt * 4);
    this.barT = Math.max(0, this.barT - dt);
    this.underFireT = Math.max(0, this.underFireT - dt);
    if (this.primedT > 0) this.primedT = Math.max(0, this.primedT - dt);
    this.attackCd -= dt;
    this.spawnGrace -= dt;
    this.stompCd -= dt;
    this.grenadeCd -= dt;

    switch (this.state) {
      case 'spawning':
        this.updateSpawning(dt);
        break;
      case 'dead':
        this.updateDead(dt);
        return;
      case 'flung':
        this.updateFlung(dt);
        break;
      case 'lifted':
        this.updateLifted(dt);
        break;
      case 'falling':
        this.velocity.x *= 0.9;
        this.velocity.z *= 0.9;
        this.moveKinematic(dt, true);
        if (this.grounded) {
          this.setState('stagger');
          this.staggerT = 0.5;
          this.game.fx.dust(this.position, 0.6);
        }
        break;
      case 'stagger':
        this.staggerT -= dt;
        this.velocity.multiplyScalar(0.85);
        this.moveKinematic(dt, true);
        if (this.staggerT <= 0) this.setState(this.coverPoint ? 'cover' : 'move');
        break;
      case 'getup':
        this.moveKinematic(dt, true);
        if (this.stateT > AI.getUpTime) this.setState('move');
        break;
      default:
        this.updateAI(dt);
        break;
    }
    this.updateVisuals(dt);
  }

  private updateSpawning(dt: number): void {
    if (this.stateT < 0) {
      this.model.setDissolve(1);
      return;
    }
    const t = Math.min(1, this.stateT / 0.6);
    this.model.setDissolve(1 - t);
    this.moveKinematic(dt, true);
    if (t >= 1) {
      this.model.setDissolve(0);
      this.setState(this.alerted ? 'move' : 'idle');
      this.thinkT = 0;
    }
  }

  private updateDead(dt: number): void {
    this.deadT += dt;
    this.syncFromBody();
    this.poseModel(dt);
    if (this.deadT > AI.corpseTime) {
      const d = Math.min(1, (this.deadT - AI.corpseTime) / 1.2);
      this.model.setDissolve(d);
      if (d >= 1) this.deactivate();
    }
  }

  private updateFlung(dt: number): void {
    this.flungT += dt;
    this.syncFromBody();
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (this.flungT > AI.flungRecoverTime && speed < 1.5) {
      // Get back up where we landed.
      const t = this.body.translation();
      _v.set(t.x, t.y + 0.5, t.z);
      const down = _v2.set(0, -1, 0);
      const hit = this.game.physics.raycast(_v, down, 6, MASK.world, this.game.scratchHit);
      this.position.set(t.x, hit ? this.game.scratchHit.point.y : t.y - this.centerY, t.z);
      this.setPhysicsMode('kinematic');
      this.body.setTranslation({ x: this.position.x, y: this.position.y + this.centerY, z: this.position.z }, true);
      this.body.setRotation(_q.setFromAxisAngle(UP, this.yaw), true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.velocity.set(0, 0, 0);
      this.setState('getup');
      this.game.fx.dust(this.position, 0.5);
    }
    if (this.flungT > 6) {
      // Stuck somewhere odd; recover anyway.
      this.flungT = AI.flungRecoverTime;
    }
  }

  private updateLifted(dt: number): void {
    this.liftT -= dt;
    const cfg = CONFIG.powers.pull;
    const targetY = this.liftBaseY + cfg.liftHeight + Math.sin(this.stateT * 2.2) * 0.12;
    this.position.y += (targetY - this.position.y) * Math.min(1, dt / cfg.liftRise * 2);
    this.yaw += dt * 0.6;
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.centerY, z: this.position.z });
    this.body.setNextKinematicRotation(_q.setFromAxisAngle(UP, this.yaw));
    if (this.liftT <= 0) {
      this.setState('falling');
      this.velocity.set(0, 0, 0);
    }
  }

  /** Copy the dynamic body's transform into position (feet) and the model. */
  protected syncFromBody(): void {
    const t = this.body.translation();
    this.position.set(t.x, t.y - this.centerY, t.z);
  }

  protected updateAI(dt: number): void {
    if (this.frozen) {
      this.velocity.set(0, this.velocity.y, 0);
      this.moveKinematic(dt, true);
      return;
    }
    const player = this.game.player;
    const pp = player.position;
    this.distToPlayer = Math.hypot(pp.x - this.position.x, pp.z - this.position.z);

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.cfg.thinkInterval * (0.8 + Math.random() * 0.4);
      this.updateLos();
      if (!this.alerted && (this.los && this.distToPlayer < AI.alertRadius)) this.alerted = true;
      if (this.alerted && player.alive && this.state !== 'telegraph' && this.state !== 'fire' && this.state !== 'stomp' && this.state !== 'throw') this.think();
    }

    switch (this.state) {
      case 'idle':
        this.velocity.x *= 0.8;
        this.velocity.z *= 0.8;
        break;
      case 'move':
      case 'cover':
        this.followPath(dt);
        this.tryAttack();
        break;
      case 'telegraph':
        this.updateTelegraph(dt);
        break;
      case 'fire':
        this.updateFire(dt);
        break;
      case 'stomp':
        this.updateStomp(dt);
        break;
      case 'throw':
        this.updateThrow(dt);
        break;
    }
    this.moveKinematic(dt, false);
    this.updateFacing(dt);
  }

  protected updateLos(): void {
    this.eyePoint(_v);
    this.game.player.aimPoint(_v2);
    this.los = !this.game.physics.blocked(_v, _v2);
  }

  protected eyePoint(out: THREE.Vector3): THREE.Vector3 {
    // Eyes at full height even when crouched: enemies peek to look.
    return out.set(this.position.x, this.position.y + this.height * 0.9, this.position.z);
  }

  /** Decide where to go. Overridden per type. */
  protected think(): void {
    switch (this.kind) {
      case 'grunt':
        this.thinkGrunt();
        break;
      case 'trooper':
        this.thinkTrooper();
        break;
      case 'heavy':
        this.thinkHeavy();
        break;
      default:
        break;
    }
  }

  private thinkGrunt(): void {
    const player = this.game.player;
    const pp = player.position;
    const cp = this.coverPoint;
    const compromised = cp ? !this.game.cover.protects(cp, pp) : true;
    const tooClose = this.distToPlayer < AI.closeRangeFlee;
    const hurt = this.defenses.health < this.cfg.health * AI.retreatHealthFraction;
    let want = compromised || tooClose || (!this.hasGoal && !cp);
    if (!want && Math.random() < this.cfg.repositionChance) want = true;
    if (!want && hurt && this.underFireT > 0 && Math.random() < AI.retreatChance * 0.3) want = true;
    if (want) {
      if (cp) cp.avoidUntil = this.game.time.now + AI.coverCooldown;
      const min = tooClose || hurt ? this.cfg.preferredRangeMin + 4 : this.cfg.preferredRangeMin;
      if (!this.pickCover(min, this.cfg.preferredRangeMax + (hurt ? 6 : 0))) this.pickOpenSpot(min, this.cfg.preferredRangeMax);
    }
  }

  private thinkTrooper(): void {
    const player = this.game.player;
    // Push forward and flank: pick points around the player on the side
    // her cover does not protect.
    const atGoal = !this.hasGoal || this.position.distanceTo(this.goal) < 1;
    if (!atGoal && Math.random() > this.cfg.repositionChance * 0.5 && this.distToPlayer > 4) return;
    const pp = player.position;
    let best = -Infinity;
    const out = _v3;
    let found = false;
    const baseAngle = Math.atan2(this.position.x - pp.x, this.position.z - pp.z);
    const nav = this.game.director.nav;
    for (let i = 0; i < 10; i++) {
      const ang = baseAngle + (Math.random() - 0.5) * 2 * (AI.flankAngleDeg * DEG + 0.5);
      const r = this.cfg.preferredRangeMin + Math.random() * (this.cfg.preferredRangeMax - this.cfg.preferredRangeMin);
      _v.set(pp.x + Math.sin(ang) * r, pp.y, pp.z + Math.cos(ang) * r);
      if (!nav || !nav.randomNear(_v, 1.2, _v2, 3)) continue;
      let score = 0;
      if (player.inCover) {
        const n = player.cover.normal;
        const dx = _v2.x - pp.x;
        const dz = _v2.z - pp.z;
        const l = Math.hypot(dx, dz) || 1;
        // Positive when the point is on the open side of the player's cover.
        score += ((dx * n.x + dz * n.z) / l) * 6;
      }
      score -= _v2.distanceTo(this.position) * 0.15;
      score -= this.crowding(_v2) * 3;
      score += Math.random();
      if (score > best) {
        best = score;
        out.copy(_v2);
        found = true;
      }
    }
    if (found) {
      this.releaseCover();
      this.setGoal(out);
      this.moveSpeed = this.cfg.runSpeed;
      if (this.state === 'cover') this.setState('move');
      if (player.inCover) this.game.director.bark(this.kind, 'flank', 0.4);
    }
  }

  private thinkHeavy(): void {
    const pp = this.game.player.position;
    if (this.distToPlayer < CONFIG.heavyStomp.range && this.stompCd <= 0 && this.alerted) {
      this.releaseToken();
      this.setState('stomp');
      this.stompCd = CONFIG.heavyStomp.cooldown;
      this.game.fx.telegraphRing(this.position, CONFIG.heavyStomp.range, CONFIG.heavyStomp.telegraph, 0xff7020);
      this.game.audio.play('heavyWindup', { at: this.position });
      return;
    }
    const want = this.distToPlayer > this.cfg.preferredRangeMax || !this.los || (!this.hasGoal && Math.random() < 0.3);
    if (want) {
      // Advance on the player, offset to the side a little.
      const ang = Math.atan2(this.position.x - pp.x, this.position.z - pp.z) + (Math.random() - 0.5) * 0.8;
      const r = Math.max(this.cfg.preferredRangeMin, Math.min(this.distToPlayer - 4, 16));
      _v.set(pp.x + Math.sin(ang) * r, pp.y, pp.z + Math.cos(ang) * r);
      const nav = this.game.director.nav;
      if (nav && nav.randomNear(_v, 2, _v2, 4)) {
        this.setGoal(_v2);
        this.moveSpeed = this.cfg.walkSpeed;
      }
    }
  }

  /** How many other enemies are near a point. */
  protected crowding(p: THREE.Vector3): number {
    let n = 0;
    for (const e of this.game.enemies.active) {
      if (e === this || !e.alive) continue;
      const g = e.hasGoal ? e.goal : e.position;
      if (Math.hypot(g.x - p.x, g.z - p.z) < 2.5) n++;
    }
    return n;
  }

  protected pickCover(minR: number, maxR: number): boolean {
    const pp = this.game.player.position;
    const points = this.game.cover.points;
    const nav = this.game.director.nav;
    let best: CoverPoint | null = null;
    let bestScore = -Infinity;
    const now = this.game.time.now;
    const ideal = (minR + maxR) * 0.5;
    for (const p of points) {
      if (p.section !== this.section) continue;
      if (p.claimedBy && p.claimedBy !== this) continue;
      if (p.avoidUntil > now) continue;
      if (Math.abs(p.pos.y - this.position.y) > 2.5) continue;
      const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
      if (d < minR || d > maxR + 6) continue;
      if (!this.game.cover.protects(p, pp)) continue;
      if (nav && !nav.walkable(p.pos.x, p.pos.y, p.pos.z)) continue;
      let score = 10 - Math.abs(d - ideal) * 0.35;
      score -= Math.hypot(p.pos.x - this.position.x, p.pos.z - this.position.z) * 0.22;
      score -= this.crowding(p.pos) * 4;
      if (p.kind === 'low') score += 1;
      score += Math.random() * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return false;
    this.releaseCover();
    best.claimedBy = this;
    this.coverPoint = best;
    this.setGoal(best.pos);
    this.moveSpeed = this.cfg.runSpeed;
    if (this.state === 'cover') this.setState('move');
    return true;
  }

  protected pickOpenSpot(minR: number, maxR: number): void {
    const pp = this.game.player.position;
    const nav = this.game.director.nav;
    if (!nav) return;
    const ang = Math.atan2(this.position.x - pp.x, this.position.z - pp.z) + (Math.random() - 0.5) * 1.2;
    const r = minR + Math.random() * (maxR - minR);
    _v.set(pp.x + Math.sin(ang) * r, this.position.y, pp.z + Math.cos(ang) * r);
    if (nav.randomNear(_v, 3, _v2, 6)) {
      this.releaseCover();
      this.setGoal(_v2);
      this.moveSpeed = this.cfg.runSpeed * 0.8;
    }
  }

  protected setGoal(p: THREE.Vector3): void {
    this.goal.copy(p);
    this.hasGoal = true;
    this.repathT = 0;
    this.pathCount = 0;
    this.pathIdx = 0;
    if (this.state === 'idle' || this.state === 'cover') this.setState('move');
  }

  protected followPath(dt: number): void {
    const desired = _v.set(0, 0, 0);
    if (this.hasGoal) {
      this.repathT -= dt;
      const nav = this.game.director.nav;
      if (this.repathT <= 0 && nav) {
        this.repathT = 1.5 + Math.random();
        this.pathCount = nav.findPath(this.position, this.goal, this.path);
        this.pathIdx = 0;
        if (this.pathCount === 0) {
          // Unreachable: drop the goal.
          this.hasGoal = false;
          this.releaseCover();
        }
      }
      if (this.pathIdx < this.pathCount) {
        const wp = this.path[this.pathIdx];
        desired.set(wp.x - this.position.x, 0, wp.z - this.position.z);
        const d = desired.length();
        const last = this.pathIdx === this.pathCount - 1;
        if (d < (last ? 0.25 : 0.55)) {
          this.pathIdx++;
        } else {
          const speed = last ? Math.min(this.moveSpeed, d * 3) : this.moveSpeed;
          desired.multiplyScalar(speed / d);
        }
      }
      if (this.pathIdx >= this.pathCount && this.pathCount > 0) {
        this.hasGoal = false;
        desired.set(0, 0, 0);
        if (this.coverPoint) this.setState('cover');
      }
    }
    // Separation from other enemies.
    for (const e of this.game.enemies.active) {
      if (e === this || !e.alive || e.state === 'dead') continue;
      const dx = this.position.x - e.position.x;
      const dz = this.position.z - e.position.z;
      const d2 = dx * dx + dz * dz;
      const min = AI.separation;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / min) * 2.5;
        desired.x += (dx / d) * push;
        desired.z += (dz / d) * push;
      }
    }
    const k = Math.min(1, dt * 8);
    this.velocity.x += (desired.x - this.velocity.x) * k;
    this.velocity.z += (desired.z - this.velocity.z) * k;
  }

  protected tryAttack(): void {
    if (!this.alerted || this.attackCd > 0 || this.spawnGrace > 0) return;
    if (this.kind === 'grunt' && this.grenadeCd <= 0 && this.game.explosives.canThrow(this.position)) {
      if (Math.random() < GREN.chance) {
        // She's dug in: lob one over to flush her out.
        this.grenadeCd = GREN.cooldown;
        this.releaseToken();
        this.thrown = false;
        this.setState('throw');
        this.game.director.bark(this.kind, 'grenade', 1);
        this.game.audio.play('enemyCharge', { at: this.position, volume: 0.5 });
        return;
      }
      this.grenadeCd = 2;
    }
    const player = this.game.player;
    if (!player.alive || !this.los) return;
    if (this.distToPlayer > this.cfg.weapon.range) return;
    if (!this.game.enemies.tokens.request(this)) {
      this.attackCd = 0.3 + Math.random() * 0.4;
      return;
    }
    this.hasToken = true;
    this.setState('telegraph');
    let wind = Math.max(this.cfg.weapon.telegraph, AI.minTelegraph);
    // Bas's advice: the crew are bad at looking up. Hovering above them
    // buys a slower wind-up.
    if (player.hovering && player.position.y - this.position.y > 1.5 && this.game.director.flags.has('heard_grandmother')) wind *= CONFIG.tuning.lookUpTelegraphScale;
    this.telegraphT = wind;
    this.telegraphTotal = wind;
    this.game.audio.play(this.kind === 'heavy' ? 'heavyWindup' : 'enemyCharge', { at: this.position, volume: 0.7 });
  }

  private updateTelegraph(dt: number): void {
    this.telegraphT -= dt;
    // Keep strafing slowly while winding up (troopers move more).
    const moveK = this.kind === 'trooper' ? 0.5 : 0.1;
    this.velocity.x *= 1 - Math.min(1, dt * 6) * (1 - moveK);
    this.velocity.z *= 1 - Math.min(1, dt * 6) * (1 - moveK);
    this.game.player.aimPoint(this.aimTarget);
    const total = this.telegraphTotal;
    this.game.fx.telegraphLine(this, this.model.muzzleWorld(_v), this.aimTarget, 1 - this.telegraphT / total);
    if (this.kind === 'heavy') this.model.spinUp(dt * 30 * (1 - this.telegraphT / total));
    if (this.stateT > 0.25 && Math.floor(this.stateT * 4) !== Math.floor((this.stateT - dt) * 4)) this.updateLos();
    if (!this.los && this.stateT > 0.3) {
      // Lost sight: abort and try again soon.
      this.game.director.bark(this.kind, 'lost', 0.15);
      this.releaseToken();
      this.attackCd = 0.6;
      this.setState(this.coverPoint ? 'cover' : 'move');
      return;
    }
    if (this.telegraphT <= 0) {
      this.setState('fire');
      this.burstLeft = this.cfg.weapon.burstCount;
      this.burstT = 0;
    }
  }

  private updateFire(dt: number): void {
    this.burstT -= dt;
    this.velocity.multiplyScalar(this.kind === 'trooper' ? 0.95 : 0.8);
    if (this.kind === 'heavy') this.model.spinUp(dt * 30);
    while (this.burstT <= 0 && this.burstLeft > 0) {
      this.burstT += this.cfg.weapon.burstInterval;
      this.burstLeft--;
      this.fireBolt();
    }
    if (this.burstLeft <= 0) {
      this.releaseToken();
      this.attackCd = this.cfg.weapon.cooldownMin + Math.random() * (this.cfg.weapon.cooldownMax - this.cfg.weapon.cooldownMin);
      this.setState(this.coverPoint && !this.hasGoal ? 'cover' : 'move');
    }
  }

  protected fireBolt(): void {
    const w = this.cfg.weapon;
    const muzzle = this.model.muzzleWorld(_v);
    const player = this.game.player;
    player.aimPoint(this.aimTarget);
    // Slight lead on the player's velocity.
    const travel = muzzle.distanceTo(this.aimTarget) / w.boltSpeed;
    this.aimTarget.addScaledVector(player.velocity, travel * 0.5);
    const dir = _v2.copy(this.aimTarget).sub(muzzle).normalize();
    const spread = w.spread * DEG;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * Math.tan(spread);
    _v3.crossVectors(dir, UP).normalize();
    _v4.crossVectors(_v3, dir).normalize();
    dir.addScaledVector(_v3, Math.cos(a) * r).addScaledVector(_v4, Math.sin(a) * r).normalize();
    this.game.bolts.spawn(muzzle, dir, w.boltSpeed, w.boltDamage, this.kind === 'heavy' ? 0xff8a3a : 0xff4a2a, this);
    this.model.kickRecoil(this.kind === 'heavy' ? 0.3 : 0.7);
    this.game.fx.enemyMuzzle(muzzle, dir);
    this.game.audio.play(this.kind === 'heavy' ? 'heavyShot' : this.kind === 'trooper' ? 'trooperShot' : 'gruntShot', { at: muzzle, volume: 0.55 });
  }

  private updateThrow(dt: number): void {
    this.velocity.multiplyScalar(0.8);
    if (!this.thrown && this.stateT >= GREN.windup) {
      this.thrown = true;
      const p = this.game.player.position;
      _v2.set(p.x + (Math.random() - 0.5) * 1.2, p.y + 0.15, p.z + (Math.random() - 0.5) * 1.2);
      this.model.headWorld(_v).y += 0.35;
      this.game.explosives.throw(_v, _v2, this);
      this.game.audio.play('meleeSwing', { at: this.position, volume: 0.6 });
    }
    if (this.stateT >= GREN.windup + 0.4) {
      this.attackCd = Math.max(this.attackCd, 1.2);
      this.setState(this.coverPoint && !this.hasGoal ? 'cover' : 'move');
    }
  }

  private updateStomp(dt: number): void {
    const S = CONFIG.heavyStomp;
    this.velocity.multiplyScalar(0.8);
    if (this.stateT >= S.telegraph) {
      // Slam.
      this.game.fx.shockwave(this.position, S.range, 0xff7020);
      this.game.audio.play('stomp', { at: this.position });
      const p = this.game.player;
      const d = p.position.distanceTo(this.position);
      if (d < S.range && Math.abs(p.position.y - this.position.y) < 1.5) {
        p.takeDamage(S.damage * (1 - (d / S.range) * 0.4), this.position);
        _v.copy(p.position).sub(this.position).setY(0).normalize().multiplyScalar(S.knockback);
        p.addKnockback(_v.x, 5, _v.z);
      }
      const dist = this.game.player.position.distanceTo(this.position);
      this.game.rig.addShake(Math.max(0, 0.5 - dist / 30));
      this.setState('move');
      this.attackCd = Math.max(this.attackCd, 1);
    }
  }

  protected moveKinematic(dt: number, gravityOnly: boolean): void {
    if (gravityOnly) {
      this.velocity.x *= 0.9;
      this.velocity.z *= 0.9;
    }
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1;
    else this.velocity.y -= CONFIG.physics.gravity * dt;
    _move.x = this.velocity.x * dt;
    _move.y = this.velocity.y * dt;
    _move.z = this.velocity.z * dt;
    this.controller.computeColliderMovement(this.collider, _move, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, MASK.enemyMove);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    if (this.position.y < -40) {
      this.die(null, 0);
      this.deactivate();
      return;
    }
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.centerY, z: this.position.z });
    this.body.setNextKinematicRotation(_q.setFromAxisAngle(UP, this.yaw));
  }

  protected updateFacing(dt: number): void {
    let target = this.yaw;
    const pp = this.game.player.position;
    const facePlayer = this.alerted && (this.los || this.state === 'telegraph' || this.state === 'fire' || this.state === 'throw' || this.state === 'cover' || this.distToPlayer < 15);
    if (facePlayer) {
      target = Math.atan2(-(pp.x - this.position.x), -(pp.z - this.position.z));
    } else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.5) {
      target = Math.atan2(-this.velocity.x, -this.velocity.z);
    }
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const rate = this.kind === 'heavy' ? 3 : 8;
    this.yaw += d * Math.min(1, dt * rate);
  }

  protected updateVisuals(dt: number): void {
    // Aim blend: raised while telegraphing/firing or alert and seeing the player.
    const aimTarget = this.state === 'telegraph' || this.state === 'fire' ? 1 : this.alerted && this.los ? 0.6 : 0.1;
    this.aimBlend += (aimTarget - this.aimBlend) * Math.min(1, dt * 8);
    const inCover = this.state === 'cover' && this.coverPoint;
    const exposed = this.state === 'telegraph' || this.state === 'fire';
    let crouchT = 0;
    if (inCover && this.coverPoint!.kind === 'low' && !exposed) crouchT = 1;
    if (this.state === 'cover' && this.coverPoint?.kind === 'low' && exposed) crouchT = 0;
    if ((this.state === 'telegraph' || this.state === 'fire') && this.coverPoint?.kind === 'low' && this.position.distanceTo(this.coverPoint.pos) < 0.8) crouchT = 0;
    this.crouchBlend += (crouchT - this.crouchBlend) * Math.min(1, dt * 7);

    // Hit flash / prime glow / telegraph glow.
    const f = this.hitFlash;
    this.model.setFlash(this.hitFlashColor.x, this.hitFlashColor.y, this.hitFlashColor.z, f * 0.9);
    if (this.primed) {
      const pulse = 0.6 + Math.sin(this.game.time.now * 10) * 0.25;
      this.model.setGlow(0.25, 0.95, 1.0, pulse);
    } else if (this.state === 'telegraph') {
      const total = this.telegraphTotal;
      this.model.setGlow(1, 0.35, 0.1, (1 - this.telegraphT / total) * 0.9);
    } else if (this.state === 'stomp') {
      this.model.setGlow(1, 0.45, 0.1, Math.min(1, this.stateT / CONFIG.heavyStomp.telegraph));
    } else {
      this.model.setGlow(0, 0, 0, 0);
    }
    if (this.shieldBubble && this.shieldBubble.visible) {
      const u = (this.shieldBubble.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = this.game.time.now;
      u.uHit.value = this.shieldHitT;
      u.uAlpha.value = 0.4 + 0.6 * (this.defenses.shield / Math.max(1, this.defenses.shieldMax));
    }
    this.syncModel();
    this.poseModel(dt);
  }

  protected syncModel(): void {
    const root = this.model.root;
    if (this.state === 'flung' || this.state === 'dead') {
      const t = this.body.translation();
      const r = this.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      root.quaternion.copy(_q).multiply(FLIP);
      _v.set(0, -this.centerY, 0).applyQuaternion(_q);
      root.position.set(t.x + _v.x, t.y + _v.y, t.z + _v.z);
    } else {
      root.position.copy(this.position);
      root.quaternion.setFromAxisAngle(UP, this.yaw).multiply(FLIP);
    }
  }

  protected poseModel(dt: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const fwd = -this.velocity.x * s - this.velocity.z * c;
    const side = this.velocity.x * c - this.velocity.z * s;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const mode = this.state === 'dead' ? 'dead'
      : this.state === 'flung' ? 'flung'
      : this.state === 'lifted' ? 'lifted'
      : this.state === 'stagger' || this.state === 'getup' ? 'stagger'
      : this.state === 'stomp' ? 'stomp'
      : this.state === 'throw' ? 'throw'
      : 'normal';
    let pitch = 0;
    if (this.alerted) {
      const pp = this.game.player.position;
      const dy = pp.y + 1.2 - (this.position.y + this.height * 0.75);
      pitch = Math.atan2(dy, Math.max(1, this.distToPlayer));
    }
    this.model.pose(dt, {
      speed,
      strafe: speed > 0.1 ? side / speed : 0,
      back: fwd < -0.3,
      aim: this.aimBlend,
      crouch: this.crouchBlend,
      pitch,
      mode,
      modeT: this.state === 'stomp' ? Math.min(1, this.stateT / CONFIG.heavyStomp.telegraph) : this.state === 'throw' ? this.stateT / GREN.windup : this.stateT,
      spin: 0,
    });
  }
}
