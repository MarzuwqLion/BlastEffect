import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, type LayerMultipliers } from '../config';
import { MASK } from '../core/Physics';
import type { Enemy } from '../enemies/Enemy';
import type { Game } from '../game/Game';

const CELL = CONFIG.explosives.cell;
const GREN = CONFIG.explosives.grenade;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/** Something in the level a shot or a power can set off. */
export interface Shootable {
  shot(damage: number, point: THREE.Vector3): void;
}

type CellState = 'idle' | 'fuse' | 'gone';

/**
 * A ka cell: a pressurised canister of the stuff the Crocodile harvests,
 * stacked around his crews' positions. Shoot it (or hit it with a Lance, or
 * catch it in a combo) and it hisses for a moment, then goes up.
 */
export class KaCell implements Shootable {
  private collider: RAPIER.Collider | null = null;
  state: CellState = 'idle';
  private hp: number = CELL.hp;
  private fuseT = 0;
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly owner: Explosives,
    readonly pos: THREE.Vector3,
    readonly section: number,
    readonly index: number,
  ) {
    this.place();
    this.draw();
  }

  private place(): void {
    if (this.collider) return;
    const ph = this.owner.game.physics;
    this.collider = ph.addFixedCylinder(this.pos.x, this.pos.y + 0.56, this.pos.z, 0.56, 0.36, 'metal');
    ph.tag(this.collider, { kind: 'prop', owner: this, surface: 'metal' });
  }

  /** Write this cell's instance transforms and band colour. */
  private draw(glow = 1): void {
    const v = this.owner.visuals;
    if (this.state === 'gone') {
      _m.makeScale(0, 0, 0);
      v.body.setMatrixAt(this.index, _m);
      v.cap.setMatrixAt(this.index * 2, _m);
      v.cap.setMatrixAt(this.index * 2 + 1, _m);
      v.band.setMatrixAt(this.index, _m);
    } else {
      const x = this.pos.x + this.offset.x;
      const z = this.pos.z + this.offset.z;
      v.body.setMatrixAt(this.index, _m.makeTranslation(x, this.pos.y + 0.55, z));
      v.cap.setMatrixAt(this.index * 2, _m.makeTranslation(x, this.pos.y + 1.1, z));
      v.cap.setMatrixAt(this.index * 2 + 1, _m.makeTranslation(x, this.pos.y + 0.04, z));
      v.band.setMatrixAt(this.index, _m.makeTranslation(x, this.pos.y + 0.62, z));
      if (this.state === 'fuse') _c.setRGB(2.5, 2.2, 1.6);
      else _c.setRGB(0.25, 1.4, 1.6).multiplyScalar(glow);
      v.band.setColorAt(this.index, _c);
    }
    v.dirty = true;
  }

  shot(damage: number): void {
    if (this.state !== 'idle') return;
    this.hp -= damage;
    if (this.hp <= 0) this.ignite(CELL.fuse);
  }

  ignite(fuse: number): void {
    if (this.state === 'gone') return;
    if (this.state === 'fuse') {
      this.fuseT = Math.min(this.fuseT, fuse);
      return;
    }
    this.state = 'fuse';
    this.fuseT = fuse;
    this.owner.game.audio.play('powerFizzle', { at: this.pos, volume: 0.9 });
  }

  update(dt: number, t: number, near: boolean): void {
    if (this.state === 'idle') {
      // Slow breathing glow (only worth writing when someone is close).
      if (near) this.draw(0.75 + Math.sin(t * 2 + this.pos.x) * 0.25);
      return;
    }
    if (this.state !== 'fuse') return;
    this.fuseT -= dt;
    // Venting: white-hot band, jets of sparks, a shiver.
    this.offset.set((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05);
    this.draw();
    const fx = this.owner.game.fx.add;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.emit(this.pos.x + Math.cos(a) * 0.36, this.pos.y + 0.9, this.pos.z + Math.sin(a) * 0.36, Math.cos(a) * 3, 1 + Math.random() * 2, Math.sin(a) * 3, 0.6, 2.4, 2.8, 0.06, 0.4, { drag: 2, gravity: 4 });
    }
    if (this.fuseT <= 0) this.blow();
  }

  private blow(): void {
    this.state = 'gone';
    this.draw();
    if (this.collider) {
      this.owner.game.physics.removeCollider(this.collider);
      this.collider = null;
    }
    _v.copy(this.pos).setY(this.pos.y + 0.7);
    this.owner.explode(_v, {
      radius: CELL.radius,
      damage: CELL.damage,
      layers: CELL.layers,
      playerDamage: CELL.playerDamage,
      fling: { speed: CELL.flingSpeed, up: CELL.flingUp },
      shake: CELL.shake,
      hot: 0x50e8ff,
      cool: 0xffc860,
      source: 'kaCell',
    });
  }

  reset(): void {
    this.state = 'idle';
    this.hp = CELL.hp;
    this.fuseT = 0;
    this.offset.set(0, 0, 0);
    this.place();
    this.draw();
  }
}

interface Grenade {
  active: boolean;
  mesh: THREE.Group;
  light: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  beepT: number;
  landed: boolean;
  resting: boolean;
  owner: Enemy | null;
}

export interface BlastOpts {
  radius: number;
  damage: number;
  layers: LayerMultipliers;
  playerDamage: number;
  fling: { speed: number; up: number };
  shake: number;
  hot: number;
  cool: number;
  source: string;
}

/**
 * Explosive ka cells, the grunts' grenades and the blast they share:
 * damage through layers with falloff, flings, chain reactions, and the
 * player caught in it (less so behind a wall).
 */
export class Explosives {
  readonly cells: KaCell[] = [];
  private readonly grenades: Grenade[] = [];
  /** All cells drawn as three instanced meshes (body, caps, glowing band). */
  readonly visuals: { body: THREE.InstancedMesh; cap: THREE.InstancedMesh; band: THREE.InstancedMesh; dirty: boolean };
  /** How long the player has sat in cover (grunts lob a grenade to flush her). */
  coverT = 0;
  private sharedCd = 0;
  private time = 0;
  private hintT = 0;

  constructor(readonly game: Game) {
    const m = game.mats;
    const MAX = 48;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.count = 0;
      im.castShadow = shadow;
      im.receiveShadow = true;
      // Cells are spread over the whole level; the bounds would be stale anyway.
      im.frustumCulled = false;
      game.scene.add(im);
      return im;
    };
    this.visuals = {
      body: mk(new THREE.CylinderGeometry(0.34, 0.34, 1.0, 14), m.darkMetal, MAX, true),
      cap: mk(new THREE.CylinderGeometry(0.38, 0.38, 0.09, 14), m.gold, MAX * 2, true),
      band: mk(new THREE.CylinderGeometry(0.355, 0.355, 0.2, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX, false),
      dirty: true,
    };
    const gGeo = new THREE.SphereGeometry(0.13, 10, 8);
    const gLight = new THREE.SphereGeometry(0.05, 6, 4);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(gGeo, m.darkMetal);
      body.castShadow = true;
      const light = new THREE.Mesh(gLight, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.2), toneMapped: false }));
      light.position.y = 0.11;
      mesh.add(body, light);
      mesh.visible = false;
      game.scene.add(mesh);
      this.grenades.push({ active: false, mesh, light, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, beepT: 0, landed: false, resting: false, owner: null });
    }
  }

  addCell(x: number, y: number, z: number, section: number): KaCell {
    const v = this.visuals;
    const i = this.cells.length;
    if (i >= v.body.instanceMatrix.count) throw new Error('Too many ka cells');
    v.body.count = i + 1;
    v.cap.count = (i + 1) * 2;
    v.band.count = i + 1;
    const c = new KaCell(this, new THREE.Vector3(x, y, z), section, i);
    this.cells.push(c);
    return c;
  }

  /** Checkpoint reload: cells in and after `section` are back, grenades gone. */
  reset(section: number): void {
    for (const c of this.cells) if (c.section >= section) c.reset();
    for (const g of this.grenades) {
      g.active = false;
      g.mesh.visible = false;
    }
    this.coverT = 0;
    this.sharedCd = 0;
  }

  // ---- Grenades ----

  /** Whether a grunt at `from` may lob one now. */
  canThrow(from: THREE.Vector3): boolean {
    const p = this.game.player;
    if (!p.alive || this.sharedCd > 0 || this.coverT < GREN.coverTime) return false;
    if (this.grenades.some((g) => g.active)) return false;
    const d = Math.hypot(p.position.x - from.x, p.position.z - from.z);
    return d >= GREN.minRange && d <= GREN.maxRange;
  }

  /** Lob from `from` to land at `target` after the flight time. */
  throw(from: THREE.Vector3, target: THREE.Vector3, owner: Enemy | null): void {
    const g = this.grenades.find((x) => !x.active);
    if (!g) return;
    this.sharedCd = GREN.sharedCooldown;
    g.active = true;
    g.landed = false;
    g.resting = false;
    g.owner = owner;
    g.fuse = GREN.fuse;
    g.beepT = 0;
    g.pos.copy(from);
    const T = GREN.flight;
    const grav = CONFIG.physics.gravity;
    g.vel.set((target.x - from.x) / T, (target.y - from.y) / T + 0.5 * grav * T, (target.z - from.z) / T);
    g.mesh.position.copy(g.pos);
    g.mesh.visible = true;
  }

  private updateGrenade(g: Grenade, dt: number): void {
    g.fuse -= dt;
    // Beeps quicken toward the end; the light blinks with them.
    g.beepT -= dt;
    const interval = THREE.MathUtils.lerp(0.12, 0.5, Math.max(0, g.fuse / GREN.fuse));
    if (g.beepT <= 0) {
      g.beepT = interval;
      this.game.audio.play('grenadeBeep', { at: g.pos, volume: 0.6 });
      g.light.visible = true;
    } else if (g.beepT < interval * 0.5) {
      g.light.visible = false;
    }
    if (!g.resting) {
      const grav = CONFIG.physics.gravity;
      g.vel.y -= grav * dt;
      const speed = g.vel.length();
      const step = speed * dt;
      if (step > 1e-5) {
        _dir.copy(g.vel).divideScalar(speed);
        if (this.game.physics.raycast(g.pos, _dir, step + 0.13, MASK.world, this.game.scratchHit)) {
          const n = this.game.scratchHit.normal;
          g.pos.copy(this.game.scratchHit.point).addScaledVector(n, 0.13);
          // Bounce: reflect, lose most of the energy, roll a little.
          const vn = g.vel.dot(n);
          g.vel.addScaledVector(n, -1.8 * vn).multiplyScalar(0.4);
          if (Math.abs(vn) > 2) this.game.audio.play('grenadeBounce', { at: g.pos, volume: Math.min(1, Math.abs(vn) / 8) });
          if (!g.landed) {
            g.landed = true;
            this.game.fx.telegraphRing(this.game.scratchHit.point, GREN.radius, Math.max(0.2, g.fuse), 0xff3a20);
            this.game.director.hint('grenade');
          }
          if (n.y > 0.6 && g.vel.length() < 1.2) {
            g.resting = true;
            g.vel.set(0, 0, 0);
          }
        } else {
          g.pos.addScaledVector(g.vel, dt);
        }
        // A red spark trail so the lob reads in the air.
        this.game.fx.add.emit(g.pos.x, g.pos.y, g.pos.z, 0, 0.2, 0, 2.6, 0.35, 0.2, 0.09, 0.25, { endSize: 0.02, drag: 2 });
      }
      g.mesh.rotation.x += dt * 8;
      g.mesh.rotation.z += dt * 5;
    }
    g.mesh.position.copy(g.pos);
    if (g.pos.y < -40) {
      g.active = false;
      g.mesh.visible = false;
      return;
    }
    if (g.fuse <= 0) {
      g.active = false;
      g.mesh.visible = false;
      _v.copy(g.pos).setY(g.pos.y + 0.2);
      this.explode(_v, {
        radius: GREN.radius,
        damage: GREN.damage,
        layers: GREN.layers,
        playerDamage: GREN.playerDamage,
        fling: { speed: 8, up: 5 },
        shake: GREN.shake,
        hot: 0xff7a30,
        cool: 0xffd060,
        source: 'grenade',
      });
    }
  }

  // ---- The blast ----

  explode(center: THREE.Vector3, o: BlastOpts): void {
    const game = this.game;
    const combat = game.combat;
    // Enemies (and the boss's own path for him).
    for (const e of [...game.enemies.active]) {
      if (!e.alive) continue;
      e.chestPoint(_v2);
      const d = _v2.distanceTo(center);
      if (d > o.radius + e.radius) continue;
      if (game.physics.blocked(center, _v2)) continue;
      const k = 1 - Math.min(1, d / o.radius) * 0.5;
      _dir.copy(_v2).sub(center).setY(0);
      if (_dir.lengthSq() < 1e-4) _dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _dir.normalize();
      e.alerted = true;
      const r = combat.damage(e, o.damage * k, o.layers, 'body', _v2, _dir, { impulse: o.fling.speed * k, source: o.source });
      if (!e.alive || r.killed) continue;
      if (!e.isProtected && e.kind !== 'boss') {
        _v3.copy(_dir).multiplyScalar(o.fling.speed * k * (e.kind === 'heavy' ? 0.4 : 1)).setY(o.fling.up * k);
        e.fling(_v3, 5);
      } else {
        e.stagger(0.8);
      }
    }
    // The player.
    const p = game.player;
    if (p.alive && o.playerDamage > 0) {
      p.aimPoint(_v2);
      const d = _v2.distanceTo(center);
      if (d < o.radius) {
        const occluded = game.physics.blocked(center, _v2);
        const k = (1 - (d / o.radius) * 0.6) * (occluded ? CONFIG.explosives.occludedScale : 1);
        p.takeDamage(o.playerDamage * k, center);
        if (!occluded) {
          _v3.copy(p.position).sub(center).setY(0);
          if (_v3.lengthSq() > 1e-4) _v3.normalize().multiplyScalar(7 * k);
          p.addKnockback(_v3.x, 4 * k, _v3.z);
        }
      }
    }
    // Chain reaction.
    for (const c of this.cells) {
      if (c.state !== 'idle') continue;
      _v2.copy(c.pos).setY(c.pos.y + 0.6);
      if (_v2.distanceTo(center) > o.radius * 0.9) continue;
      // Its own casing is in the way of the ray; anything else shields it.
      if (game.physics.blocked(center, _v2, game.scratchHit) && game.scratchHit.tag?.owner !== c) continue;
      c.ignite(CELL.chainFuse + Math.random() * 0.1);
    }
    game.fx.explosion(center, o.radius, o.hot, o.cool);
    game.audio.play('explosion', { at: center, volume: 1 });
    const dist = p.position.distanceTo(center);
    game.rig.addShake(o.shake * Math.max(0.25, 1 - dist / 35));
    game.input.rumble(Math.max(0.2, 1 - dist / 25), 0.35);
    game.time.hitStop(0.05);
    game.events.emit('explosion');
  }

  /** A combo or another blast nearby sets cells off. */
  igniteNear(center: THREE.Vector3, radius: number): void {
    for (const c of this.cells) {
      if (c.state !== 'idle') continue;
      if (c.pos.distanceTo(center) < radius + 0.5) c.ignite(CELL.chainFuse + Math.random() * 0.15);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.game.player;
    if (p.alive && p.inCover && p.combatActive) this.coverT += dt;
    else this.coverT = Math.max(0, this.coverT - dt * 2);
    this.sharedCd = Math.max(0, this.sharedCd - dt);
    const cur = this.game.director.current;
    const cam = this.game.rig.camera.position;
    for (const c of this.cells) if (c.state !== 'gone' && Math.abs(c.section - cur) <= 1) c.update(dt, this.time, c.pos.distanceToSquared(cam) < 40 * 40);
    const v = this.visuals;
    if (v.dirty) {
      v.dirty = false;
      v.body.instanceMatrix.needsUpdate = true;
      v.cap.instanceMatrix.needsUpdate = true;
      v.band.instanceMatrix.needsUpdate = true;
      if (v.band.instanceColor) v.band.instanceColor.needsUpdate = true;
    }
    // First time a cell is in plain view nearby: explain it.
    this.hintT -= dt;
    if (this.hintT <= 0 && p.alive) {
      this.hintT = 0.5;
        for (const c of this.cells) {
        if (c.state !== 'idle' || c.section !== cur || c.pos.distanceTo(p.position) > 16) continue;
        _v.copy(c.pos).setY(c.pos.y + 0.7);
        if (this.game.physics.blocked(cam, _v, this.game.scratchHit) && this.game.scratchHit.tag?.owner !== c) continue;
        this.game.director.hint('kaCell');
        this.hintT = 1e9;
        break;
      }
    }
    for (const g of this.grenades) if (g.active) this.updateGrenade(g, dt);
  }
}
