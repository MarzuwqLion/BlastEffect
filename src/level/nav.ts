import * as THREE from 'three';
import { RAPIER, MASK, type Physics } from '../core/Physics';

/**
 * Multi-level navigation grid for one section. Each XZ column can hold a
 * few walkable nodes at different heights (street, mezzanine, stairs), found
 * by casting one ray down per column and keeping every upward-facing hit.
 * A* runs over nodes with 8-neighbour links where the height step is small.
 */
export interface NavBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

const MAX_LEVELS = 3;
const STEP = 0.45;
const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  readonly bounds: NavBounds;
  /** Node heights; index = column * MAX_LEVELS + level. NaN = no node. */
  private readonly nodeY: Float32Array;
  /** 1 for nodes next to a wall or drop: paths pay extra to use them. */
  private readonly edge: Uint8Array;
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly from: Int32Array;
  private readonly visit: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 1;
  private readonly heap: Int32Array;
  private heapSize = 0;
  nodeCount = 0;

  constructor(bounds: NavBounds, cell: number) {
    this.bounds = bounds;
    this.cell = cell;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    const n = this.w * this.h * MAX_LEVELS;
    this.nodeY = new Float32Array(n).fill(NaN);
    this.edge = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.visit = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
  }

  /** Rasterize the physics world into nodes, keeping cells a capsule fits in. */
  build(physics: Physics, agentRadius: number, agentHeight: number): void {
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const capsule = new RAPIER.Capsule(Math.max(0.05, agentHeight / 2 - agentRadius - 0.05), agentRadius);
    const halfH = Math.max(0.05, agentHeight / 2 - agentRadius - 0.05);
    const hits: number[] = [];
    const span = this.bounds.maxY - this.bounds.minY;
    const feet = new THREE.Vector3();
    for (let cz = 0; cz < this.h; cz++) {
      for (let cx = 0; cx < this.w; cx++) {
        const x = this.bounds.minX + (cx + 0.5) * this.cell;
        const z = this.bounds.minZ + (cz + 0.5) * this.cell;
        ray.origin.x = x;
        ray.origin.y = this.bounds.maxY;
        ray.origin.z = z;
        hits.length = 0;
        physics.world.intersectionsWithRay(ray, span, true, (hit) => {
          if (hit.normal.y > 0.7) hits.push(this.bounds.maxY - hit.timeOfImpact);
          return true;
        }, undefined, MASK.world);
        if (!hits.length) continue;
        hits.sort((a, b) => b - a);
        let level = 0;
        let lastY = Infinity;
        for (const y of hits) {
          if (level >= MAX_LEVELS) break;
          // Need headroom between this floor and the one above it.
          if (lastY - y < agentHeight * 0.9) {
            lastY = y;
            continue;
          }
          feet.set(x, y + 0.08, z);
          lastY = y;
          if (physics.capsuleBlocked(feet, agentRadius, halfH, MASK.world, capsule)) continue;
          this.nodeY[(cz * this.w + cx) * MAX_LEVELS + level] = y;
          level++;
          this.nodeCount++;
        }
      }
    }
    this.markEdges();
  }

  /** Flag nodes with a missing neighbour (wall, drop, stair side). */
  private markEdges(): void {
    for (let cz = 0; cz < this.h; cz++) {
      for (let cx = 0; cx < this.w; cx++) {
        const col = cz * this.w + cx;
        for (let l = 0; l < MAX_LEVELS; l++) {
          const node = col * MAX_LEVELS + l;
          const y = this.nodeY[node];
          if (Number.isNaN(y)) break;
          let e = 0;
          for (const [dx, dz] of DIRS) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h || this.neighbor(nz * this.w + nx, y) < 0) {
              e = 1;
              break;
            }
          }
          this.edge[node] = e;
        }
      }
    }
  }

  private column(x: number, z: number): number {
    const cx = Math.floor((x - this.bounds.minX) / this.cell);
    const cz = Math.floor((z - this.bounds.minZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }

  /** Nearest node to a world position (searches a small neighbourhood). */
  nearestNode(p: THREE.Vector3, maxRadiusCells = 6): number {
    const cx0 = Math.floor((p.x - this.bounds.minX) / this.cell);
    const cz0 = Math.floor((p.z - this.bounds.minZ) / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxRadiusCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
          const col = cz * this.w + cx;
          for (let l = 0; l < MAX_LEVELS; l++) {
            const y = this.nodeY[col * MAX_LEVELS + l];
            if (Number.isNaN(y)) break;
            const dy = Math.abs(y - p.y);
            if (dy > 1.6) continue;
            const d = dx * dx + dz * dz + dy * dy * 4;
            if (d < bestD) {
              bestD = d;
              best = col * MAX_LEVELS + l;
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  nodePosition(node: number, out: THREE.Vector3): THREE.Vector3 {
    const col = Math.floor(node / MAX_LEVELS);
    const cx = col % this.w;
    const cz = Math.floor(col / this.w);
    out.set(this.bounds.minX + (cx + 0.5) * this.cell, this.nodeY[node], this.bounds.minZ + (cz + 0.5) * this.cell);
    return out;
  }

  /** Is there a node near this position at about this height? */
  walkable(x: number, y: number, z: number): boolean {
    return this.nodeAt(x, y, z) >= 0;
  }

  private nodeAt(x: number, y: number, z: number): number {
    const col = this.column(x, z);
    if (col < 0) return -1;
    for (let l = 0; l < MAX_LEVELS; l++) {
      const ny = this.nodeY[col * MAX_LEVELS + l];
      if (Number.isNaN(ny)) return -1;
      if (Math.abs(ny - y) <= STEP + 0.1) return col * MAX_LEVELS + l;
    }
    return -1;
  }

  private neighbor(col: number, y: number): number {
    for (let l = 0; l < MAX_LEVELS; l++) {
      const ny = this.nodeY[col * MAX_LEVELS + l];
      if (Number.isNaN(ny)) return -1;
      if (Math.abs(ny - y) <= STEP) return col * MAX_LEVELS + l;
    }
    return -1;
  }

  /**
   * A* from `start` to `goal`. Writes a smoothed list of waypoints into `out`
   * (reusing its vectors) and returns the count, or 0 if unreachable.
   */
  findPath(start: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3[], maxExpand = 30000): number {
    const s = this.nearestNode(start);
    const t = this.nearestNode(goal);
    if (s < 0 || t < 0) return 0;
    const gen = ++this.generation;
    this.heapSize = 0;
    const tPos = this.nodePosition(t, _tp);
    this.visit[s] = gen;
    this.g[s] = 0;
    this.f[s] = this.heuristic(s, tPos);
    this.from[s] = -1;
    this.push(s);
    let found = false;
    let expanded = 0;
    let closest = s;
    let closestH = Infinity;
    while (this.heapSize > 0 && expanded < maxExpand) {
      const cur = this.pop();
      if (cur === t) {
        found = true;
        break;
      }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expanded++;
      const h = this.f[cur] - this.g[cur];
      if (h < closestH) {
        closestH = h;
        closest = cur;
      }
      const col = Math.floor(cur / MAX_LEVELS);
      const cx = col % this.w;
      const cz = Math.floor(col / this.w);
      const y = this.nodeY[cur];
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
        const ncol = nz * this.w + nx;
        const nb = this.neighbor(ncol, y);
        if (nb < 0 || this.closed[nb] === gen) continue;
        if (dx !== 0 && dz !== 0) {
          // No corner cutting.
          if (this.neighbor(cz * this.w + nx, y) < 0 || this.neighbor(nz * this.w + cx, y) < 0) continue;
        }
        const ng = this.g[cur] + cost * (this.edge[nb] ? 2.5 : 1);
        if (this.visit[nb] !== gen || ng < this.g[nb]) {
          this.visit[nb] = gen;
          this.g[nb] = ng;
          this.f[nb] = ng + this.heuristic(nb, tPos);
          this.from[nb] = cur;
          this.push(nb);
        }
      }
    }
    const end = found ? t : closest;
    if (end === s) {
      if (out.length < 1) out.push(new THREE.Vector3());
      out[0].copy(goal);
      return found ? 1 : 0;
    }
    // Walk back, then smooth by skipping nodes with a clear straight line.
    const raw = _raw;
    raw.length = 0;
    for (let n = end; n >= 0; n = this.from[n]) raw.push(n);
    raw.reverse();
    let count = 0;
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let next = anchor + 1;
      for (let j = raw.length - 1; j > anchor + 1; j--) {
        if (this.straight(raw[anchor], raw[j])) {
          next = j;
          break;
        }
      }
      if (out.length <= count) out.push(new THREE.Vector3());
      this.nodePosition(raw[next], out[count]);
      count++;
      anchor = next;
    }
    if (found && count > 0) {
      // End exactly on the goal if it is on the grid.
      if (this.nodeAt(goal.x, goal.y, goal.z) >= 0) out[count - 1].copy(goal);
    }
    return count;
  }

  /** Straight walk between two nodes stays on the grid without big steps. */
  private straight(a: number, b: number): boolean {
    const pa = this.nodePosition(a, _pa);
    const pb = this.nodePosition(b, _pb);
    const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const steps = Math.ceil(dist / (this.cell * 0.5));
    let y = pa.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = pa.x + (pb.x - pa.x) * t;
      const z = pa.z + (pb.z - pa.z) * t;
      const col = this.column(x, z);
      if (col < 0) return false;
      const n = this.neighbor(col, y);
      if (n < 0) return false;
      // Hug no edges mid-segment (stair sides, ledges); ends may touch them.
      if (this.edge[n] && i > 1 && i < steps - 1) return false;
      y = this.nodeY[n];
    }
    // Must arrive on b's level, not the floor under or over it.
    return Math.abs(y - pb.y) <= STEP;
  }

  private heuristic(n: number, t: THREE.Vector3): number {
    const p = this.nodePosition(n, _hp);
    return (Math.hypot(p.x - t.x, p.z - t.z) + Math.abs(p.y - t.y)) / this.cell;
  }

  private push(n: number): void {
    const heap = this.heap;
    let i = this.heapSize++;
    heap[i] = n;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.f[heap[parent]] <= this.f[heap[i]]) break;
      const tmp = heap[parent];
      heap[parent] = heap[i];
      heap[i] = tmp;
      i = parent;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap[--this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapSize && this.f[heap[l]] < this.f[heap[m]]) m = l;
        if (r < this.heapSize && this.f[heap[r]] < this.f[heap[m]]) m = r;
        if (m === i) break;
        const tmp = heap[m];
        heap[m] = heap[i];
        heap[i] = tmp;
        i = m;
      }
    }
    return top;
  }

  /** Random node within `radius` of `center`, for wandering and spawns. */
  randomNear(center: THREE.Vector3, radius: number, out: THREE.Vector3, tries = 12): boolean {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      _rp.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
      const n = this.nodeAt(_rp.x, _rp.y, _rp.z);
      if (n >= 0) {
        this.nodePosition(n, out);
        return true;
      }
    }
    return false;
  }
}

const _tp = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _raw: number[] = [];
