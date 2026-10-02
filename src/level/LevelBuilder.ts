import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from '../core/Physics';
import type { CoverKind } from './cover';
import type { Game } from '../game/Game';

export interface BoxOpts {
  mat: THREE.Material;
  collide?: boolean;
  visible?: boolean;
  cover?: boolean | CoverKind;
  rotY?: number;
  surface?: SurfaceKind;
  shadow?: boolean;
}

/** A prop prototype: one or more geometry/material parts, instanced. */
export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
}

export interface LightAnchor {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  section: number;
  flicker: number;
}

export interface Door {
  id: string;
  mesh: THREE.Object3D;
  colliders: import('@dimforge/rapier3d-compat').Collider[];
  open: boolean;
  t: number;
  closedY: number;
  travel: number;
  /** Visual "locked" light. */
  lamp: THREE.Mesh | null;
}

export interface Trigger {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface Pickup {
  kind: 'ammo' | 'health';
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  section: number;
  cooldown: number;
  used: boolean;
  /** Only available with a flag (side route supplies). */
  flag?: string;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const CHUNK = 60;

/**
 * Builds one section's static geometry. Visible parts are merged per
 * material and per spatial chunk to keep draw calls low; repeated props are
 * instanced. Boxes get Rapier colliders and can register as cover.
 */
export class LevelBuilder {
  readonly group = new THREE.Group();
  private readonly buckets = new Map<string, { mat: THREE.Material; geoms: THREE.BufferGeometry[]; shadow: boolean }>();
  private readonly instances = new Map<PropPart, THREE.Matrix4[]>();
  readonly lights: LightAnchor[] = [];
  readonly doors: Door[] = [];
  readonly triggers: Trigger[] = [];
  readonly pickups: Pickup[] = [];
  readonly anims: ((t: number, dt: number) => void)[] = [];

  constructor(readonly game: Game, readonly section: number) {
    this.group.name = `section-${section}`;
  }

  private addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4, shadow = true): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    _p.setFromMatrixPosition(matrix);
    const chunk = Math.floor(_p.z / CHUNK);
    const unlit = (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    const key = `${mat.uuid}:${chunk}`;
    shadow = shadow && !unlit;
    let b = this.buckets.get(key);
    if (!b) {
      b = { mat, geoms: [], shadow };
      this.buckets.set(key, b);
    } else if (shadow) {
      b.shadow = true;
    }
    b.geoms.push(g);
  }

  /** Box with its base at y (not centred). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, o: BoxOpts): void {
    const rot = o.rotY ?? 0;
    if (o.visible !== false) {
      _q.setFromAxisAngle(UP, rot);
      _m.compose(_p.set(x, y + h / 2, z), _q, _s.set(1, 1, 1));
      this.addGeometry(new THREE.BoxGeometry(w, h, d), o.mat, _m, o.shadow !== false);
    }
    if (o.collide !== false) {
      this.game.physics.addFixedBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rot ? _q.setFromAxisAngle(UP, rot).clone() : null, o.surface ?? 'stone');
    }
    if (o.cover) {
      this.game.cover.add(x, z, w / 2, d / 2, rot, y, y + h, this.section, typeof o.cover === 'string' ? o.cover : undefined);
    }
  }

  /** Invisible collider box. */
  blocker(x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0): void {
    this.game.physics.addFixedBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rotY ? _q.setFromAxisAngle(UP, rotY).clone() : null);
  }

  /** Arbitrary geometry at a transform, merged. Optional box collider from its bounds. */
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, rotY = 0, scale = 1, collide: 'box' | 'cylinder' | false = false, shadow = true): void {
    _q.setFromAxisAngle(UP, rotY);
    _m.compose(pos, _q, _s.set(scale, scale, scale));
    this.addGeometry(geo, mat, _m, shadow);
    if (collide) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const size = bb.getSize(new THREE.Vector3()).multiplyScalar(scale);
      const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(scale).applyQuaternion(_q).add(pos);
      if (collide === 'cylinder') this.game.physics.addFixedCylinder(c.x, c.y, c.z, size.y / 2, Math.max(size.x, size.z) / 2);
      else this.game.physics.addFixedBox(c.x, c.y, c.z, size.x / 2, size.y / 2, size.z / 2, rotY ? _q.clone() : null);
    }
  }

  /** Geometry with a full matrix. */
  meshMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4, shadow = true): void {
    this.addGeometry(geo, mat, matrix, shadow);
  }

  /**
   * Sloped walkway from (x, y0, z0) to (x, y1, z1) along Z, width w. Visual
   * steps if `steps` > 0, with a smooth invisible ramp collider so the
   * character controllers walk it cleanly.
   */
  stairs(x: number, z0: number, z1: number, y0: number, y1: number, w: number, mat: THREE.Material, steps = 0, rotY = 0, pivotX = x, pivotZ = z0): void {
    const len = Math.abs(z1 - z0);
    const dir = Math.sign(z1 - z0) || 1;
    const rise = y1 - y0;
    const slope = Math.atan2(rise, len);
    const hyp = Math.hypot(len, rise);
    const rot = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
    const local = (lx: number, ly: number, lz: number): THREE.Vector3 =>
      new THREE.Vector3(lx - pivotX, ly, lz - pivotZ).applyQuaternion(rot).add(new THREE.Vector3(pivotX, 0, pivotZ));
    // Collider: a thin slab along the slope.
    const thick = 0.3;
    const qSlope = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dir * slope);
    const q = rot.clone().multiply(qSlope);
    const center = local(x, (y0 + y1) / 2 - (thick / 2) * Math.cos(slope), (z0 + z1) / 2);
    this.game.physics.addFixedBox(center.x, center.y, center.z, w / 2, thick / 2, hyp / 2, q);
    if (steps > 0) {
      const sh = rise / steps;
      const sd = len / steps;
      for (let i = 0; i < steps; i++) {
        const sz = z0 + dir * (i + 0.5) * sd;
        const top = y0 + sh * (i + 1);
        const p = local(x, 0, sz);
        _q.copy(rot);
        _m.compose(_p.set(p.x, (y0 + top) / 2 - 0.05, p.z), _q, _s.set(1, 1, 1));
        this.addGeometry(new THREE.BoxGeometry(w, top - y0 + 0.1, sd), mat, _m);
      }
    } else {
      _m.compose(center, q, _s.set(1, 1, 1));
      this.addGeometry(new THREE.BoxGeometry(w, thick, hyp), mat, _m);
    }
  }

  /** Register a prop instance. */
  instance(parts: PropPart[], x: number, y: number, z: number, rotY = 0, scale = 1, scaleY = scale): void {
    _q.setFromAxisAngle(UP, rotY);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(scale, scaleY, scale));
    for (const part of parts) {
      let list = this.instances.get(part);
      if (!list) {
        list = [];
        this.instances.set(part, list);
      }
      list.push(m);
    }
  }

  light(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number, flicker = 0): void {
    this.lights.push({ pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, section: this.section, flicker });
  }

  /**
   * A gate that slides down into the floor when opened. Closed doors block
   * movement and shots; a lamp shows red (locked) or green (open).
   */
  door(id: string, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0): Door {
    const mats = this.game.mats;
    const group = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.darkMetal);
    slab.position.y = h / 2;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    // Gold bands and a glyph strip.
    for (const yy of [0.15, h - 0.15]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d + 0.04), mats.gold);
      band.position.y = yy;
      group.add(band);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.7, d + 0.06), mats.neonRed);
    strip.position.y = h / 2;
    group.add(strip);
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    this.group.add(group);
    const col = this.game.physics.addFixedBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rotY ? _q.setFromAxisAngle(UP, rotY).clone() : null, 'metal');
    const door: Door = { id, mesh: group, colliders: [col], open: false, t: 0, closedY: y, travel: h + 0.1, lamp: strip };
    this.doors.push(door);
    return door;
  }

  pickup(kind: 'ammo' | 'health', x: number, y: number, z: number, flag?: string): Pickup {
    const mats = this.game.mats;
    const mesh = new THREE.Group();
    if (kind === 'ammo') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.6), mats.darkMetal);
      box.position.y = 0.28;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 0.64), mats.gold);
      lid.position.y = 0.58;
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.62), mats.neonGold);
      glow.position.y = 0.36;
      mesh.add(box, lid, glow);
      this.game.physics.addFixedBox(x, y + 0.3, z, 0.5, 0.3, 0.3, null, 'metal');
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), mats.neonWhite);
      box.position.y = 0.35;
      const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.37), mats.neonRed);
      cross1.position.y = 0.35;
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.37), mats.neonRed);
      cross2.position.y = 0.35;
      mesh.add(box, cross1, cross2);
    }
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const p: Pickup = { kind, pos: new THREE.Vector3(x, y, z), mesh, section: this.section, cooldown: 0, used: false, flag };
    this.pickups.push(p);
    this.light(x, y + 0.8, z, kind === 'ammo' ? 0xffc04a : 0xff6060, 2.5, 4);
    return p;
  }

  trigger(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Trigger {
    const t = {
      id,
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
    };
    this.triggers.push(t);
    return t;
  }

  /** Merge buckets and create instanced meshes. */
  finalize(): THREE.Group {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geoms, false);
      for (const g of b.geoms) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    }
    this.buckets.clear();
    for (const [part, list] of this.instances) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = part.castShadow ?? true;
      im.receiveShadow = true;
      this.group.add(im);
    }
    this.instances.clear();
    this.group.updateMatrixWorld(true);
    return this.group;
  }
}
