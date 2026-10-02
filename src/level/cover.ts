import * as THREE from 'three';
import { CONFIG } from '../config';

export type CoverKind = 'low' | 'high';

/** A piece of cover: an upright box, possibly rotated about Y. */
export interface CoverBox {
  id: number;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  /** Rotation about Y, radians. */
  rot: number;
  cos: number;
  sin: number;
  bottom: number;
  top: number;
  kind: CoverKind;
  section: number;
}

export interface CoverPoint {
  pos: THREE.Vector3;
  /** Direction from the cover to the point (the side it's safe on is +normal). */
  normal: THREE.Vector3;
  kind: CoverKind;
  box: CoverBox;
  /** True if near a corner (high cover can be peeked from here). */
  edge: boolean;
  /** Tangent toward the nearest corner when `edge`. */
  edgeDir: THREE.Vector3;
  claimedBy: unknown;
  avoidUntil: number;
  section: number;
}

/** Result of the player cover probe. */
export interface CoverContact {
  box: CoverBox;
  kind: CoverKind;
  /** Closest point on the cover face, at the player's feet height. */
  surface: THREE.Vector3;
  /** Face normal, pointing toward the player. */
  normal: THREE.Vector3;
  /** Face tangent (right-handed around +Y from the normal). */
  tangent: THREE.Vector3;
  /** Gap between capsule and face. */
  gap: number;
  /** Signed distance along the tangent from the face centre. */
  along: number;
  /** Half length of the face. */
  halfLength: number;
}

const _local = new THREE.Vector3();

export class CoverSystem {
  readonly boxes: CoverBox[] = [];
  readonly points: CoverPoint[] = [];
  private nextId = 1;

  add(cx: number, cz: number, hx: number, hz: number, rot: number, bottom: number, top: number, section: number, kind?: CoverKind): CoverBox {
    const height = top - bottom;
    const box: CoverBox = {
      id: this.nextId++,
      cx, cz, hx, hz, rot,
      cos: Math.cos(rot),
      sin: Math.sin(rot),
      bottom, top,
      kind: kind ?? (height <= CONFIG.cover.lowMaxHeight ? 'low' : 'high'),
      section,
    };
    this.boxes.push(box);
    this.generatePoints(box);
    return box;
  }

  /** World → box-local XZ. */
  private toLocal(box: CoverBox, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const dx = x - box.cx;
    const dz = z - box.cz;
    // Inverse rotation about Y.
    out.x = dx * box.cos - dz * box.sin;
    out.z = dx * box.sin + dz * box.cos;
    out.y = 0;
    return out;
  }

  /** Box-local XZ direction → world. */
  private dirToWorld(box: CoverBox, lx: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    out.x = lx * box.cos + lz * box.sin;
    out.z = -lx * box.sin + lz * box.cos;
    out.y = 0;
    return out;
  }

  private pointToWorld(box: CoverBox, lx: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    this.dirToWorld(box, lx, lz, out);
    out.x += box.cx;
    out.z += box.cz;
    return out;
  }

  private generatePoints(box: CoverBox): void {
    const spacing = CONFIG.ai.coverPointSpacing;
    const off = CONFIG.ai.coverOffset;
    const faces: [number, number, number][] = [
      // normal x, normal z, half length along the tangent
      [1, 0, box.hz],
      [-1, 0, box.hz],
      [0, 1, box.hx],
      [0, -1, box.hx],
    ];
    for (const [nx, nz, half] of faces) {
      if (half < 0.35) continue;
      const count = Math.max(1, Math.floor((half * 2) / spacing));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : -half + 0.4 + ((half * 2 - 0.8) * i) / (count - 1);
        // Tangent is (-nz, nx) in local space.
        const lx = nx * (nx !== 0 ? box.hx + off : 0) + -nz * t;
        const lz = nz * (nz !== 0 ? box.hz + off : 0) + nx * t;
        const pos = this.pointToWorld(box, lx, lz, new THREE.Vector3());
        pos.y = box.bottom;
        const normal = this.dirToWorld(box, nx, nz, new THREE.Vector3());
        const edgeDist = half - Math.abs(t);
        const edge = edgeDist < CONFIG.cover.edgePeekDistance;
        const sign = t >= 0 ? 1 : -1;
        const edgeDir = this.dirToWorld(box, -nz * sign, nx * sign, new THREE.Vector3());
        this.points.push({ pos, normal, kind: box.kind, box, edge, edgeDir, claimedBy: null, avoidUntil: 0, section: box.section });
      }
    }
  }

  /**
   * Finds the cover face nearest to a player capsule at `feet`. Returns null
   * if nothing is within `maxGap`.
   */
  probe(feet: THREE.Vector3, radius: number, maxGap: number, out: CoverContact): CoverContact | null {
    let best: CoverBox | null = null;
    let bestGap = maxGap;
    let bestLx = 0;
    let bestLz = 0;
    let bestNx = 0;
    let bestNz = 0;
    for (const box of this.boxes) {
      // Must stand on roughly the same floor and the cover must rise above the waist.
      if (feet.y < box.bottom - 0.5 || feet.y > box.bottom + 0.6) continue;
      if (box.top - feet.y < 0.85) continue;
      const l = this.toLocal(box, feet.x, feet.z, _local);
      const cx = Math.max(-box.hx, Math.min(box.hx, l.x));
      const cz = Math.max(-box.hz, Math.min(box.hz, l.z));
      const dx = l.x - cx;
      const dz = l.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1e-4) continue; // inside the box
      const gap = dist - radius;
      if (gap > bestGap) continue;
      // Pick the face: the axis with the larger outside distance.
      let nx = 0;
      let nz = 0;
      if (Math.abs(dx) >= Math.abs(dz)) nx = Math.sign(dx);
      else nz = Math.sign(dz);
      // Only count it as cover if the player is beside the face, not past a corner.
      if (nx !== 0 && Math.abs(l.z) > box.hz + radius * 0.6) continue;
      if (nz !== 0 && Math.abs(l.x) > box.hx + radius * 0.6) continue;
      best = box;
      bestGap = gap;
      bestLx = nx !== 0 ? Math.sign(nx) * box.hx : cx;
      bestLz = nz !== 0 ? Math.sign(nz) * box.hz : cz;
      bestNx = nx;
      bestNz = nz;
    }
    if (!best) return null;
    out.box = best;
    out.kind = best.top - feet.y <= CONFIG.cover.lowMaxHeight ? 'low' : 'high';
    this.pointToWorld(best, bestLx, bestLz, out.surface);
    out.surface.y = feet.y;
    this.dirToWorld(best, bestNx, bestNz, out.normal);
    out.tangent.set(-out.normal.z, 0, out.normal.x);
    out.gap = bestGap;
    // Position along the face relative to its centre.
    const faceCx = best.cx + out.normal.x * (bestNx !== 0 ? best.hx : best.hz);
    const faceCz = best.cz + out.normal.z * (bestNx !== 0 ? best.hx : best.hz);
    out.along = (feet.x - faceCx) * out.tangent.x + (feet.z - faceCz) * out.tangent.z;
    out.halfLength = bestNx !== 0 ? best.hz : best.hx;
    return out;
  }

  /** True if `box` sits between a point and a threat (XZ only). */
  protects(point: CoverPoint, threat: THREE.Vector3): boolean {
    const dx = threat.x - point.pos.x;
    const dz = threat.z - point.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return -(dx * point.normal.x + dz * point.normal.z) / len > 0.55;
  }

  clearClaims(): void {
    for (const p of this.points) {
      p.claimedBy = null;
      p.avoidUntil = 0;
    }
  }
}

export function makeContact(): CoverContact {
  return {
    box: null as unknown as CoverBox,
    kind: 'low',
    surface: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    gap: 0,
    along: 0,
    halfLength: 0,
  };
}
