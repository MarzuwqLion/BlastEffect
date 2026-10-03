import * as THREE from 'three';
import { CONFIG } from '../config';
import { MASK, makeRayHit } from '../core/Physics';
import type { Game } from '../game/Game';
import type { Shootable } from '../combat/Explosives';

const MAX = 256;

interface Bolt {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
  color: THREE.Color;
  size: number;
  homing: number;
  whizzed: boolean;
  owner: unknown;
}

const _hit = makeRayHit();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _to = new THREE.Vector3();

/**
 * Pooled enemy projectiles: visible, dodgeable glowing bolts. They sweep
 * against static geometry with rays and against the player's hurt capsule
 * analytically, so cover really blocks them. One instanced draw call.
 */
export class Bolts {
  private readonly bolts: Bolt[] = [];
  readonly mesh: THREE.InstancedMesh;

  constructor(private readonly game: Game) {
    const geo = new THREE.CapsuleGeometry(0.5, 1, 3, 8);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    game.scene.add(this.mesh);
    for (let i = 0; i < MAX; i++) {
      this.bolts.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), damage: 0, life: 0,
        color: new THREE.Color(), size: 1, homing: 0, whizzed: false, owner: null,
      });
    }
  }

  spawn(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, color: number, owner: unknown, opts: { size?: number; homing?: number; life?: number } = {}): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.pos.copy(pos);
    b.vel.copy(dir).multiplyScalar(speed);
    b.damage = damage;
    b.life = opts.life ?? 2.5;
    b.color.setHex(color).multiplyScalar(3);
    b.size = opts.size ?? 1;
    b.homing = opts.homing ?? 0;
    b.whizzed = false;
    b.owner = owner;
  }

  clear(): void {
    for (const b of this.bolts) b.active = false;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const player = this.game.player;
    const pr = CONFIG.player.radius + CONFIG.ai.boltRadiusPlayer;
    // Player hurt capsule axis.
    _a.set(player.position.x, player.position.y + CONFIG.player.radius, player.position.z);
    _b.set(player.position.x, player.position.y + player.hurtHeight - CONFIG.player.radius, player.position.z);
    let n = 0;
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      if (b.homing > 0 && player.alive) {
        player.aimPoint(_to).sub(b.pos).normalize();
        const speed = b.vel.length();
        _dir.copy(b.vel).divideScalar(speed);
        _dir.lerp(_to, Math.min(1, b.homing * dt)).normalize();
        b.vel.copy(_dir).multiplyScalar(speed);
      }
      const speed = b.vel.length();
      const dist = speed * dt;
      _dir.copy(b.vel).divideScalar(speed);
      const hitWorld = this.game.physics.raycast(b.pos, _dir, dist, MASK.enemyShot, _hit);
      const maxT = hitWorld ? _hit.distance : dist;
      let hitPlayer = false;
      if (player.alive) {
        const t = segmentCapsule(b.pos, _dir, maxT, _a, _b, pr + 0.05 * (b.size - 1));
        if (t >= 0) {
          hitPlayer = true;
          _p.copy(b.pos).addScaledVector(_dir, t);
          player.takeDamage(b.damage, b.pos);
          this.game.fx.boltImpact(_p, _dir, b.color);
          b.active = false;
          continue;
        }
        // Near miss.
        if (!b.whizzed) {
          const t2 = segmentCapsule(b.pos, _dir, maxT, _a, _b, 1.1);
          if (t2 >= 0) {
            b.whizzed = true;
            this.game.audio.play('whizz', { volume: 0.5 });
          }
        }
      }
      if (hitWorld && !hitPlayer) {
        this.game.fx.boltImpact(_hit.point, _hit.normal, b.color);
        // Stray fire can set off a ka cell the player is hiding behind.
        if (_hit.tag?.kind === 'prop' && _hit.tag.owner) (_hit.tag.owner as Shootable).shot(b.damage * 0.5, _hit.point);
        b.active = false;
        continue;
      }
      b.pos.addScaledVector(_dir, dist);
      // Draw: stretched along velocity.
      // Homing orbs stay round; fast bolts stretch along their velocity.
      const len = b.homing > 0 ? 0.07 * b.size * 1.8 : Math.min(1.1, 0.25 + speed * 0.012) * b.size;
      _q.setFromUnitVectors(_z, _dir);
      _s.set(0.07 * b.size, 0.07 * b.size, len);
      _m.compose(b.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, b.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get activeCount(): number {
    let n = 0;
    for (const b of this.bolts) if (b.active) n++;
    return n;
  }
}

/**
 * Ray (origin o, unit dir d, length len) vs capsule (segment a-b, radius r).
 * Returns the distance along the ray to the closest approach if it is within
 * r, else -1. Approximate (closest point, not exact entry), fine for bolts.
 */
export function segmentCapsule(o: THREE.Vector3, d: THREE.Vector3, len: number, a: THREE.Vector3, b: THREE.Vector3, r: number): number {
  // Closest points between segment o + d*s (s in [0,len]) and a + (b-a)*t (t in [0,1]).
  const ux = d.x * len, uy = d.y * len, uz = d.z * len;
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const A = ux * ux + uy * uy + uz * uz;
  const B = ux * vx + uy * vy + uz * vz;
  const C = vx * vx + vy * vy + vz * vz;
  const D = ux * wx + uy * wy + uz * wz;
  const E = vx * wx + vy * wy + vz * wz;
  const den = A * C - B * B;
  let s = den > 1e-8 ? (B * E - C * D) / den : 0;
  s = Math.max(0, Math.min(1, s));
  let t = C > 1e-8 ? (B * s + E) / C : 0;
  if (t < 0) {
    t = 0;
    s = A > 1e-8 ? Math.max(0, Math.min(1, -D / A)) : 0;
  } else if (t > 1) {
    t = 1;
    s = A > 1e-8 ? Math.max(0, Math.min(1, (B - D) / A)) : 0;
  }
  const px = wx + ux * s - vx * t;
  const py = wy + uy * s - vy * t;
  const pz = wz + uz * s - vz * t;
  if (px * px + py * py + pz * pz <= r * r) return s * len;
  return -1;
}
