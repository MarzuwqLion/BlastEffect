import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { HitZone } from '../combat/damage';

export { RAPIER };

/** Collision group bits. Every collider also lists QUERY in its filter so scene queries can see it. */
export const G = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  ENEMY: 1 << 2,
  HITBOX: 1 << 3,
  DEBRIS: 1 << 4,
  QUERY: 1 << 15,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Query masks: what a given scene query is allowed to hit. */
export const MASK = {
  /** Player bullets and powers. */
  playerShot: groups(G.QUERY, G.WORLD | G.ENEMY | G.HITBOX | G.DEBRIS),
  /** Line of sight and camera: static world only. */
  world: groups(G.QUERY, G.WORLD),
  /** Enemy bolts: world geometry (the player is tested analytically). */
  enemyShot: groups(G.QUERY, G.WORLD),
  enemies: groups(G.QUERY, G.ENEMY | G.HITBOX | G.DEBRIS),
  playerMove: groups(G.QUERY, G.WORLD | G.ENEMY),
  enemyMove: groups(G.QUERY, G.WORLD | G.PLAYER | G.ENEMY),
};

export type SurfaceKind = 'stone' | 'metal' | 'glass' | 'flesh' | 'shield' | 'armor';

export interface ColliderTag {
  kind: 'world' | 'enemy' | 'player' | 'boss';
  /** The owning gameplay object (an Enemy for enemy colliders). */
  owner?: unknown;
  zone?: HitZone;
  surface?: SurfaceKind;
}

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider | null;
  tag: ColliderTag | null;
}

export function makeRayHit(): RayHit {
  return { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, tag: null };
}

const _q = new THREE.Quaternion();

export class Physics {
  readonly world: RAPIER.World;
  private readonly tags = new Map<number, ColliderTag>();
  private readonly ray: RAPIER.Ray;
  private readonly ball = new Map<number, RAPIER.Ball>();
  private readonly fixedBody: RAPIER.RigidBody;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -CONFIG.physics.gravity, z: 0 });
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.fixedBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  step(dt: number): void {
    this.world.timestep = Math.min(Math.max(dt, CONFIG.physics.minStep), CONFIG.physics.maxStep);
    this.world.step();
  }

  tag(collider: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(collider.handle, tag);
  }

  untag(collider: RAPIER.Collider): void {
    this.tags.delete(collider.handle);
  }

  getTag(collider: RAPIER.Collider | null | undefined): ColliderTag | null {
    if (!collider) return null;
    return this.tags.get(collider.handle) ?? null;
  }

  removeCollider(collider: RAPIER.Collider): void {
    this.tags.delete(collider.handle);
    this.world.removeCollider(collider, false);
  }

  addFixedBox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    rotation?: THREE.Quaternion | null,
    surface: SurfaceKind = 'stone',
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(G.WORLD, 0xffff))
      .setFriction(0.6);
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const c = this.world.createCollider(desc, this.fixedBody);
    this.tags.set(c.handle, { kind: 'world', surface });
    return c;
  }

  addFixedCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number, surface: SurfaceKind = 'stone'): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(G.WORLD, 0xffff));
    const c = this.world.createCollider(desc, this.fixedBody);
    this.tags.set(c.handle, { kind: 'world', surface });
    return c;
  }

  setFixedRotation(collider: RAPIER.Collider, q: THREE.Quaternion): void {
    collider.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  /**
   * Casts a ray and fills `out`. `dir` must be normalized. Returns false when
   * nothing is hit within `maxDist`.
   */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    mask: number,
    out: RayHit,
    exclude?: RAPIER.Collider | null,
    predicate?: (c: RAPIER.Collider) => boolean,
  ): boolean {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, mask, exclude ?? undefined, undefined, predicate);
    if (!hit) return false;
    out.distance = hit.timeOfImpact;
    out.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    out.collider = hit.collider;
    out.tag = this.tags.get(hit.collider.handle) ?? null;
    return true;
  }

  /** True if the segment a→b is blocked by static world geometry. */
  blocked(a: THREE.Vector3, b: THREE.Vector3, hit?: RayHit): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return false;
    this.ray.origin.x = a.x;
    this.ray.origin.y = a.y;
    this.ray.origin.z = a.z;
    this.ray.dir.x = dx / len;
    this.ray.dir.y = dy / len;
    this.ray.dir.z = dz / len;
    if (hit) {
      const h = this.world.castRayAndGetNormal(this.ray, len, true, undefined, MASK.world);
      if (!h) return false;
      hit.distance = h.timeOfImpact;
      hit.point.set(a.x + this.ray.dir.x * h.timeOfImpact, a.y + this.ray.dir.y * h.timeOfImpact, a.z + this.ray.dir.z * h.timeOfImpact);
      hit.normal.set(h.normal.x, h.normal.y, h.normal.z);
      hit.collider = h.collider;
      hit.tag = this.tags.get(h.collider.handle) ?? null;
      return true;
    }
    return this.world.castRay(this.ray, len, true, undefined, MASK.world) !== null;
  }

  /** Sphere sweep; returns distance travelled before contact, or maxDist. */
  sphereCast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    radius: number,
    maxDist: number,
    mask: number,
    out?: RayHit,
    exclude?: RAPIER.Collider | null,
  ): number {
    let shape = this.ball.get(radius);
    if (!shape) {
      shape = new RAPIER.Ball(radius);
      this.ball.set(radius, shape);
    }
    const hit = this.world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      dir,
      shape,
      0,
      maxDist,
      true,
      undefined,
      mask,
      exclude ?? undefined,
    );
    if (!hit) return maxDist;
    if (out) {
      out.distance = hit.time_of_impact;
      out.point.copy(origin).addScaledVector(dir, hit.time_of_impact);
      out.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      out.collider = hit.collider;
      out.tag = this.tags.get(hit.collider.handle) ?? null;
    }
    return hit.time_of_impact;
  }

  /** Calls `cb` for every collider overlapping the sphere. */
  overlapSphere(center: THREE.Vector3, radius: number, mask: number, cb: (c: RAPIER.Collider, tag: ColliderTag | null) => void): void {
    let shape = this.ball.get(radius);
    if (!shape) {
      shape = new RAPIER.Ball(radius);
      this.ball.set(radius, shape);
    }
    this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      cb(c, this.tags.get(c.handle) ?? null);
      return true;
    }, undefined, mask);
  }

  /** True if a capsule standing at `feet` overlaps static geometry. */
  capsuleBlocked(feet: THREE.Vector3, radius: number, halfHeight: number, mask: number, shape: RAPIER.Capsule): boolean {
    let blocked = false;
    this.world.intersectionsWithShape(
      { x: feet.x, y: feet.y + halfHeight + radius, z: feet.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        blocked = true;
        return false;
      },
      undefined,
      mask,
    );
    void radius;
    return blocked;
  }
}

export function toRapierQuat(q: THREE.Quaternion): RAPIER.Rotation {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function yawQuat(yaw: number): THREE.Quaternion {
  return _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
}
