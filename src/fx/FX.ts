import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Player } from '../player/Player';
import { MASK, type SurfaceKind } from '../core/Physics';
import { ParticleSystem } from './Particles';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

const MAX_TRACERS = 64;

interface Timed {
  t: number;
  life: number;
}

function radialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A muzzle flash star: radial glow plus spikes. */
function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.2, 'rgba(255,210,120,0.9)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,230,170,0.85)';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(64, 64);
    g.rotate((i / 6) * Math.PI * 2 + 0.3);
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(60, 0);
    g.lineTo(0, 4);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * All transient visual effects, pooled: particles, tracers, decals,
 * telegraph lines and rings, shockwaves, flashes and two FX lights.
 */
export class FX {
  readonly add: ParticleSystem;
  readonly smoke: ParticleSystem;
  private readonly tracers: THREE.InstancedMesh;
  private readonly tracerLife = new Float32Array(MAX_TRACERS);
  private readonly tracerMax = new Float32Array(MAX_TRACERS);
  private readonly tracerMats: THREE.Matrix4[] = [];
  private readonly tracerCol: THREE.Color[] = [];
  private tracerCursor = 0;

  private readonly decals: THREE.InstancedMesh;
  private readonly decalFade: THREE.InstancedBufferAttribute;
  private readonly decalAge: Float32Array;
  private decalCursor = 0;
  private decalCount: number;

  private readonly lines: { mesh: THREE.Mesh; owner: unknown; seen: boolean }[] = [];
  private readonly rings: ({ mesh: THREE.Mesh } & Timed)[] = [];
  private readonly waves: ({ mesh: THREE.Mesh; radius: number } & Timed)[] = [];
  private readonly flashes: ({ sprite: THREE.Sprite; size: number } & Timed)[] = [];
  readonly muzzleLight: THREE.PointLight;
  readonly boomLight: THREE.PointLight;
  private muzzleLightT = 0;
  private boomLightT = 0;
  private boomLightMax = 1;
  private jetAccum = 0;
  private readonly flashTex: THREE.Texture;
  private readonly glowTex: THREE.Texture;

  constructor(private readonly game: Game, particleScale: number, decalCount: number) {
    this.add = new ParticleSystem(Math.round(2400 * Math.max(0.5, particleScale)), true);
    this.smoke = new ParticleSystem(Math.round(700 * Math.max(0.5, particleScale)), false);
    game.scene.add(this.add.points, this.smoke.points);

    // Tracers: two crossed quads along +Z, additive.
    const tg = new THREE.BufferGeometry();
    const tp = new Float32Array([
      -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1,
      0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1,
    ]);
    const tuv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    tg.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
    const tmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          vUv = uv;
          vCol = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.25, vUv.y);
          gl_FragColor = vec4(vCol * across * across * along, 1.0);
        }`,
    });
    this.tracers = new THREE.InstancedMesh(tg, tmat, MAX_TRACERS);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracerMats.push(new THREE.Matrix4().makeScale(0, 0, 0));
      this.tracerCol.push(new THREE.Color());
      this.tracers.setMatrixAt(i, this.tracerMats[i]);
      this.tracers.setColorAt(i, this.tracerCol[i]);
    }
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 9;
    game.scene.add(this.tracers);

    // Decals: bullet scorch marks.
    this.decalCount = decalCount;
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decalFade = new THREE.InstancedBufferAttribute(new Float32Array(decalCount), 1);
    this.decalAge = new Float32Array(decalCount);
    dg.setAttribute('aFade', this.decalFade);
    const dmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aFade; varying float vFade; varying vec2 vUv;
        void main() {
          vFade = aFade; vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vFade; varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.25, d) * 0.85 * vFade;
          vec3 col = mix(vec3(0.02), vec3(0.15, 0.1, 0.06), d);
          float ember = smoothstep(0.3, 0.0, d) * vFade * vFade;
          gl_FragColor = vec4(col + vec3(1.0, 0.45, 0.1) * ember * 0.8, a);
        }`,
    });
    this.decals = new THREE.InstancedMesh(dg, dmat, decalCount);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < decalCount; i++) this.decals.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    game.scene.add(this.decals);

    // Telegraph lines (laser sights).
    const lg = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    lg.translate(0, 0.5, 0);
    lg.rotateX(Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(lg, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      game.scene.add(mesh);
      this.lines.push({ mesh, owner: null, seen: false });
    }

    // Ground rings: telegraphs and blast rings.
    const rg = new THREE.PlaneGeometry(2, 2);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(0xff5020) }, uMode: { value: 0 }, uAlpha: { value: 1 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uProgress; uniform vec3 uColor; uniform float uMode; uniform float uAlpha;
          void main(){
            float d = length(vUv - 0.5) * 2.0;
            if (d > 1.0) discard;
            float a;
            if (uMode < 0.5) {
              // Telegraph: outer edge plus a fill that grows to the edge.
              float edge = smoothstep(0.93, 0.97, d) * (1.0 - smoothstep(0.98, 1.0, d));
              float fill = step(d, uProgress) * 0.22 + smoothstep(uProgress - 0.05, uProgress, d) * step(d, uProgress) * 0.6;
              a = edge * 0.9 + fill;
            } else {
              // Blast ring: a thin expanding band.
              float w = 0.08;
              a = smoothstep(uProgress - w, uProgress, d) * (1.0 - smoothstep(uProgress, uProgress + 0.02, d)) * (1.0 - uProgress);
            }
            gl_FragColor = vec4(uColor * 2.0, a * uAlpha);
          }`,
      });
      const mesh = new THREE.Mesh(rg, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      game.scene.add(mesh);
      this.rings.push({ mesh, t: 0, life: 0 });
    }

    // Shockwave shells.
    const sg = new THREE.SphereGeometry(1, 28, 18);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0x60e8ff) } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main(){
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; uniform float uAlpha; uniform vec3 uColor;
          void main(){
            float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
            gl_FragColor = vec4(uColor * 2.5, f * uAlpha);
          }`,
      });
      const mesh = new THREE.Mesh(sg, mat);
      mesh.visible = false;
      mesh.renderOrder = 9;
      game.scene.add(mesh);
      this.waves.push({ mesh, t: 0, life: 0, radius: 1 });
    }

    // Flash sprites.
    this.flashTex = flashTexture();
    this.glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }));
      sprite.visible = false;
      sprite.renderOrder = 10;
      game.scene.add(sprite);
      this.flashes.push({ sprite, t: 0, life: 0, size: 1 });
    }

    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 8, 2);
    this.boomLight = new THREE.PointLight(0x60e8ff, 0, 22, 2);
    game.scene.add(this.muzzleLight, this.boomLight);
  }

  setPixelRatio(pr: number, height: number): void {
    this.add.setPixelRatio(pr, height);
    this.smoke.setPixelRatio(pr, height);
  }

  clear(): void {
    this.add.clear();
    this.smoke.clear();
    for (const l of this.lines) {
      l.mesh.visible = false;
      l.owner = null;
    }
    for (const r of this.rings) r.mesh.visible = false;
    for (const w of this.waves) w.mesh.visible = false;
    for (const f of this.flashes) f.sprite.visible = false;
    this.tracerLife.fill(0);
  }

  update(dt: number): void {
    this.add.update(dt);
    this.smoke.update(dt);

    // Tracers.
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      const k = Math.max(0, this.tracerLife[i] / this.tracerMax[i]);
      _c.copy(this.tracerCol[i]).multiplyScalar(k);
      this.tracers.setColorAt(i, _c);
      if (this.tracerLife[i] <= 0) this.tracers.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;

    // Decals fade slowly.
    let decalDirty = false;
    for (let i = 0; i < this.decalCount; i++) {
      if (this.decalAge[i] <= 0) continue;
      this.decalAge[i] += dt;
      const f = this.decalAge[i] < 0.5 ? 1 : Math.max(0, 1 - (this.decalAge[i] - 20) / 6);
      this.decalFade.setX(i, f);
      decalDirty = true;
      if (f <= 0) this.decalAge[i] = 0;
    }
    if (decalDirty) this.decalFade.needsUpdate = true;

    // Telegraph lines that were not refreshed this frame disappear.
    for (const l of this.lines) {
      if (l.owner && !l.seen) {
        l.mesh.visible = false;
        l.owner = null;
      }
      l.seen = false;
    }

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const u = (r.mesh.material as THREE.ShaderMaterial).uniforms;
      const p = Math.min(1, r.t / r.life);
      u.uProgress.value = p;
      if (u.uMode.value > 0.5) u.uAlpha.value = 1;
      if (r.t >= r.life) r.mesh.visible = false;
    }
    for (const w of this.waves) {
      if (!w.mesh.visible) continue;
      w.t += dt;
      const p = Math.min(1, w.t / w.life);
      const e = 1 - Math.pow(1 - p, 3);
      w.mesh.scale.setScalar(Math.max(0.01, w.radius * e));
      (w.mesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (1 - p) * 1.2;
      if (p >= 1) w.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.t += dt;
      const p = f.t / f.life;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p);
      f.sprite.scale.setScalar(f.size * (0.8 + p * 0.6));
      if (p >= 1) f.sprite.visible = false;
    }

    this.muzzleLightT -= dt;
    this.muzzleLight.intensity = this.muzzleLightT > 0 ? 18 * (this.muzzleLightT / 0.05) : 0;
    this.boomLightT -= dt;
    this.boomLight.intensity = this.boomLightT > 0 ? this.boomLightMax * Math.min(1, this.boomLightT / 0.35) : 0;

    // Jump-jets while hovering.
    const p = this.game.player;
    if (p.hovering && p.alive) {
      this.jetAccum += dt;
      while (this.jetAccum > 0.016) {
        this.jetAccum -= 0.016;
        this.jetPuff(p, 0.6);
      }
    }
  }

  private flash(pos: THREE.Vector3, size: number, life: number, color: number, tex?: THREE.Texture): void {
    const f = this.flashes.find((x) => !x.sprite.visible) ?? this.flashes[0];
    f.sprite.position.copy(pos);
    f.size = size;
    f.t = 0;
    f.life = life;
    const m = f.sprite.material as THREE.SpriteMaterial;
    m.map = tex ?? this.flashTex;
    m.color.setHex(color);
    m.rotation = Math.random() * Math.PI * 2;
    m.opacity = 1;
    f.sprite.scale.setScalar(size);
    f.sprite.visible = true;
  }

  private ring(pos: THREE.Vector3, radius: number, life: number, color: number, mode: 0 | 1): void {
    const r = this.rings.find((x) => !x.mesh.visible) ?? this.rings[0];
    r.mesh.position.set(pos.x, pos.y + 0.04, pos.z);
    r.mesh.scale.setScalar(radius);
    r.t = 0;
    r.life = life;
    const u = (r.mesh.material as THREE.ShaderMaterial).uniforms;
    u.uColor.value.setHex(color);
    u.uMode.value = mode;
    u.uProgress.value = 0;
    r.mesh.visible = true;
  }

  private wave(pos: THREE.Vector3, radius: number, life: number, color: number): void {
    const w = this.waves.find((x) => !x.mesh.visible) ?? this.waves[0];
    w.mesh.position.copy(pos);
    w.radius = radius;
    w.t = 0;
    w.life = life;
    w.mesh.scale.setScalar(0.01);
    (w.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(color);
    w.mesh.visible = true;
  }

  private boom(pos: THREE.Vector3, color: number, intensity: number, time: number): void {
    this.boomLight.position.copy(pos);
    this.boomLight.color.setHex(color);
    this.boomLightMax = intensity;
    this.boomLightT = time;
  }

  private burst(pos: THREE.Vector3, count: number, speed: number, r: number, g: number, b: number, size: number, life: number, gravity = 0, drag = 2, up = 0): void {
    const n = Math.round(count * this.add.scale);
    for (let i = 0; i < n; i++) {
      randDir(_v3);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.add.emit(pos.x, pos.y, pos.z, _v3.x * s, _v3.y * s + up, _v3.z * s, r, g, b, size * (0.6 + Math.random() * 0.6), life * (0.6 + Math.random() * 0.6), { endSize: size * 0.2, gravity, drag });
    }
  }

  private smokePuff(pos: THREE.Vector3, count: number, size: number, life: number, color = 0.25): void {
    for (let i = 0; i < count; i++) {
      randDir(_v3);
      this.smoke.emit(pos.x + _v3.x * 0.2, pos.y + _v3.y * 0.2, pos.z + _v3.z * 0.2, _v3.x * 0.8, Math.abs(_v3.y) * 0.8 + 0.3, _v3.z * 0.8, color, color, color * 1.1, size, life, { endSize: size * 2.5, drag: 1.5 });
    }
  }

  // ---- Player weapons ----

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: 'smg' | 'rifle'): void {
    const big = weapon === 'rifle';
    _v.copy(pos).addScaledVector(dir, 0.08);
    this.flash(_v, big ? 0.9 : 0.45, big ? 0.07 : 0.045, 0xffe0a0);
    this.muzzleLight.position.copy(_v);
    this.muzzleLightT = 0.05;
    for (let i = 0; i < (big ? 8 : 3); i++) {
      randDir(_v3).multiplyScalar(0.8).add(dir).normalize();
      const s = 4 + Math.random() * 6;
      this.add.emit(_v.x, _v.y, _v.z, _v3.x * s, _v3.y * s, _v3.z * s, 3, 2, 0.8, 0.05, 0.08 + Math.random() * 0.06, { drag: 6 });
    }
    if (big) this.smokePuff(_v, 2, 0.2, 0.6, 0.35);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number): void {
    const i = this.tracerCursor;
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    _v.copy(to).sub(from);
    const len = _v.length();
    if (len < 0.1) return;
    _v.divideScalar(len);
    _q.setFromUnitVectors(_z, _v);
    _s.set(width, width, len);
    this.tracerMats[i].compose(from, _q, _s);
    this.tracers.setMatrixAt(i, this.tracerMats[i]);
    this.tracerCol[i].setHex(color).multiplyScalar(3);
    this.tracers.setColorAt(i, this.tracerCol[i]);
    this.tracerLife[i] = width > 0.04 ? 0.12 : 0.06;
    this.tracerMax[i] = this.tracerLife[i];
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale = 1): void {
    let r = 2.4, g = 1.7, b = 0.8;
    if (surface === 'shield') {
      r = 0.6; g = 1.6; b = 3.2;
    } else if (surface === 'armor') {
      r = 3.2; g = 2.4; b = 0.6;
    } else if (surface === 'flesh') {
      r = 2.6; g = 0.8; b = 0.4;
    } else if (surface === 'glass') {
      r = 1.6; g = 2.4; b = 2.8;
    }
    const n = Math.round(6 * scale);
    for (let i = 0; i < n; i++) {
      randDir(_v3);
      _v3.addScaledVector(normal, 1.3).normalize();
      const s = 3 + Math.random() * 5 * scale;
      this.add.emit(point.x, point.y, point.z, _v3.x * s, _v3.y * s, _v3.z * s, r, g, b, 0.05 * scale + 0.02, 0.18 + Math.random() * 0.2, { gravity: 9, drag: 2 });
    }
    if (surface === 'shield') {
      this.flash(point, 0.35 * scale, 0.08, 0x60b0ff, this.glowTex);
    } else {
      this.flash(point, 0.18 * scale, 0.05, 0xffd090, this.glowTex);
    }
    if (surface === 'stone' || surface === 'metal' || surface === 'glass') {
      this.smokePuff(point, 1, 0.15 * scale, 0.5, 0.3);
      this.decal(point, normal, 0.09 * scale + 0.04);
    }
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    if (this.decalCount === 0) return;
    const i = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % this.decalCount;
    _v.copy(point).addScaledVector(normal, 0.01);
    _q.setFromUnitVectors(_z, normal);
    _s.set(size, size, size);
    _m.compose(_v, _q, _s);
    this.decals.setMatrixAt(i, _m);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalAge[i] = 0.001;
    this.decalFade.setX(i, 1);
    this.decalFade.needsUpdate = true;
  }

  // ---- Movement ----

  jetPuff(p: Player, strength: number): void {
    for (const side of [-1, 1] as const) {
      this.game.avatar.jetWorld(_v, side);
      const s = 3 + Math.random() * 2;
      this.add.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.6 + p.velocity.x * 0.3, -s, (Math.random() - 0.5) * 0.6 + p.velocity.z * 0.3, 0.6 * strength, 1.6 * strength, 3.2 * strength, 0.16, 0.18 + Math.random() * 0.1, { endSize: 0.02, drag: 3 });
    }
  }

  jumpJet(p: Player, strength: number): void {
    for (let i = 0; i < 6; i++) this.jetPuff(p, strength * 1.2);
    this.dust(p.position, 0.5);
  }

  dash(pos: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < 16; i++) {
      const t = Math.random();
      this.add.emit(
        pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.3 + Math.random() * 1.3, pos.z + (Math.random() - 0.5) * 0.5,
        -dir.x * (2 + t * 4), (Math.random() - 0.5), -dir.z * (2 + t * 4),
        0.5, 1.4, 2.8, 0.12, 0.25 + t * 0.2, { endSize: 0.02, drag: 4 },
      );
    }
    this.dust(pos, 0.4);
  }

  dust(pos: THREE.Vector3, scale: number): void {
    for (let i = 0; i < Math.round(6 * scale + 2); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2 * scale;
      this.smoke.emit(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, 0.3 + Math.random() * 0.5, Math.sin(a) * s, 0.28, 0.27, 0.3, 0.35 * scale + 0.2, 0.7, { endSize: 1.2 * scale + 0.5, drag: 2.5 });
    }
  }

  // ---- Enemies ----

  telegraphLine(owner: unknown, from: THREE.Vector3, to: THREE.Vector3, progress: number, tint: 'red' | 'green' = 'red'): void {
    let l = this.lines.find((x) => x.owner === owner);
    if (!l) {
      l = this.lines.find((x) => x.owner === null);
      if (!l) return;
      l.owner = owner;
    }
    l.seen = true;
    _v.copy(to).sub(from);
    const len = _v.length();
    _v.divideScalar(len);
    l.mesh.position.copy(from);
    l.mesh.quaternion.setFromUnitVectors(_z, _v);
    const w = 0.006 + progress * 0.012;
    l.mesh.scale.set(w, w, len);
    const mat = l.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.25 + progress * 0.6 + (progress > 0.8 ? Math.sin(performance.now() * 0.05) * 0.2 : 0);
    if (tint === 'green') mat.color.setRGB(0.4, 2.5, 0.9 + progress * 0.4);
    else mat.color.setRGB(2.5, 0.35 + progress * 0.3, 0.2);
    l.mesh.visible = true;
    // A charging glow at the muzzle.
    if (Math.random() < 0.5) {
      randDir(_v3);
      this.add.emit(from.x + _v3.x * 0.15, from.y + _v3.y * 0.15, from.z + _v3.z * 0.15, -_v3.x * 0.8, -_v3.y * 0.8, -_v3.z * 0.8, 3, 0.6, 0.2, 0.06 + progress * 0.05, 0.15);
    }
  }

  clearTelegraph(owner: unknown): void {
    const l = this.lines.find((x) => x.owner === owner);
    if (l) {
      l.mesh.visible = false;
      l.owner = null;
    }
  }

  telegraphRing(pos: THREE.Vector3, radius: number, duration: number, color: number): void {
    this.ring(pos, radius, duration, color, 0);
  }

  shockwave(pos: THREE.Vector3, radius: number, color: number): void {
    this.ring(pos, radius, 0.45, color, 1);
    _v.copy(pos);
    _v.y += 0.3;
    this.wave(_v, radius * 0.6, 0.35, color);
    this.dust(pos, 1.5);
    this.burst(_v, 30, 8, 3, 1.4, 0.4, 0.12, 0.5, 6, 2);
  }

  enemyMuzzle(pos: THREE.Vector3, dir: THREE.Vector3): void {
    _v.copy(pos).addScaledVector(dir, 0.06);
    this.flash(_v, 0.4, 0.05, 0xff6a40, this.glowTex);
  }

  boltImpact(point: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color): void {
    for (let i = 0; i < 5; i++) {
      randDir(_v3).sub(normal).normalize();
      const s = 2 + Math.random() * 3;
      this.add.emit(point.x, point.y, point.z, _v3.x * s, _v3.y * s, _v3.z * s, color.r, color.g, color.b, 0.06, 0.2, { gravity: 6, drag: 3 });
    }
    this.flash(point, 0.3, 0.06, 0xff7a50, this.glowTex);
  }

  shieldBreak(pos: THREE.Vector3): void {
    this.burst(pos, 40, 7, 0.6, 1.6, 3.2, 0.1, 0.6, 4, 2);
    this.wave(pos, 1.6, 0.3, 0x60b0ff);
    this.flash(pos, 1.5, 0.15, 0x80c0ff, this.glowTex);
  }

  armorBreak(pos: THREE.Vector3): void {
    this.burst(pos, 30, 6, 3.2, 2.2, 0.5, 0.09, 0.7, 12, 1);
    this.flash(pos, 1.2, 0.12, 0xffc040, this.glowTex);
    this.smokePuff(pos, 4, 0.3, 1.2, 0.25);
  }

  deathBurst(pos: THREE.Vector3, scale: number): void {
    this.burst(pos, 18 * scale, 4 * scale, 2.8, 1.2, 0.5, 0.08, 0.5, 5, 2);
    this.smokePuff(pos, Math.round(3 * scale), 0.35 * scale, 1.2, 0.2);
  }

  liftAura(pos: THREE.Vector3): void {
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.3;
      this.add.emit(pos.x + Math.cos(a) * r, pos.y - 0.6 + Math.random() * 1.2, pos.z + Math.sin(a) * r, -Math.sin(a) * 1.5, 0.6, Math.cos(a) * 1.5, 0.4, 2.2, 3, 0.08, 0.5, { endSize: 0.01 });
    }
  }

  // ---- Powers ----

  powerTrail(pos: THREE.Vector3, color: number): void {
    _c.setHex(color);
    for (let i = 0; i < 2; i++) {
      randDir(_v3);
      this.add.emit(pos.x + _v3.x * 0.1, pos.y + _v3.y * 0.1, pos.z + _v3.z * 0.1, _v3.x * 0.5, _v3.y * 0.5, _v3.z * 0.5, _c.r * 3, _c.g * 3, _c.b * 3, 0.16, 0.3, { endSize: 0.01 });
    }
  }

  powerFizzle(pos: THREE.Vector3, color: number): void {
    _c.setHex(color);
    this.burst(pos, 14, 3, _c.r * 3, _c.g * 3, _c.b * 3, 0.08, 0.4);
  }

  pullHit(pos: THREE.Vector3): void {
    this.burst(pos, 30, 4, 0.4, 2.2, 3.2, 0.1, 0.6, -2, 2);
    this.wave(pos, 1.4, 0.35, 0x40e0ff);
    this.flash(pos, 1.2, 0.15, 0x60e8ff, this.glowTex);
  }

  throwHit(pos: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < 24; i++) {
      randDir(_v3).addScaledVector(dir, 1.5).normalize();
      const s = 3 + Math.random() * 6;
      this.add.emit(pos.x, pos.y, pos.z, _v3.x * s, _v3.y * s, _v3.z * s, 3.2, 2.4, 1, 0.09, 0.4, { drag: 3, gravity: 3 });
    }
    this.flash(pos, 1.3, 0.12, 0xffd27a, this.glowTex);
  }

  chargeTrail(p: Player): void {
    for (let i = 0; i < 4; i++) {
      this.add.emit(
        p.position.x + (Math.random() - 0.5) * 0.6, p.position.y + 0.2 + Math.random() * 1.5, p.position.z + (Math.random() - 0.5) * 0.6,
        -p.velocity.x * 0.1, 0, -p.velocity.z * 0.1, 0.5, 2, 3.4, 0.22, 0.25, { endSize: 0.02, drag: 2 },
      );
    }
  }

  chargeImpact(pos: THREE.Vector3): void {
    _v.copy(pos);
    _v.y += 0.9;
    this.wave(_v, 3, 0.3, 0x50d8ff);
    this.ring(pos, 3, 0.4, 0x50d8ff, 1);
    this.burst(_v, 40, 9, 0.5, 2, 3.4, 0.12, 0.5, 2, 2);
    this.flash(_v, 2.2, 0.15, 0x80e0ff, this.glowTex);
    this.boom(_v, 0x60d8ff, 30, 0.3);
    this.dust(pos, 1.2);
  }

  /** The combo: the biggest payoff in the game. */
  comboExplosion(center: THREE.Vector3, radius: number): void {
    // Core flash and light.
    this.flash(center, radius * 0.9, 0.22, 0x9fe8ff, this.glowTex);
    this.flash(center, radius * 0.55, 0.14, 0xfff0c8, this.flashTex);
    this.boom(center, 0x8af0ff, 70, 0.6);
    // Two shells: gold then turquoise.
    this.wave(center, radius, 0.42, 0xffcf6a);
    _v.copy(center);
    this.wave(_v, radius * 1.25, 0.65, 0x40e0ff);
    // Ground blast ring.
    _v2.copy(center);
    const down = this.game.physics.raycast(center, _v3.set(0, -1, 0), 6, MASK.world, this.game.scratchHit);
    if (down) _v2.copy(this.game.scratchHit.point);
    else _v2.y -= 1;
    this.ring(_v2, radius * 1.1, 0.6, 0x60e8ff, 1);
    // Sparks: turquoise and gold, some rising like embers.
    this.burst(center, 90, 13, 0.6, 2.6, 3.4, 0.14, 0.9, 4, 1.6);
    this.burst(center, 60, 10, 3.4, 2.4, 0.9, 0.12, 1.1, 2, 1.2, 1.5);
    for (let i = 0; i < Math.round(30 * this.add.scale); i++) {
      randDir(_v3);
      this.add.emit(center.x + _v3.x * radius * 0.5, center.y + _v3.y * 0.5, center.z + _v3.z * radius * 0.5, _v3.x, 1.5 + Math.random() * 2, _v3.z, 3, 2.2, 0.8, 0.07, 1.6 + Math.random(), { drag: 0.5, gravity: -0.4 });
    }
    this.smokePuff(center, 10, 0.8, 1.8, 0.18);
    this.dust(_v2, 2);
  }

  /** Ka cell or grenade going off: hot core, shell, ground ring, debris, smoke, scorch. */
  explosion(center: THREE.Vector3, radius: number, hot: number, cool: number): void {
    this.flash(center, radius * 1.1, 0.24, hot, this.glowTex);
    this.flash(center, radius * 0.6, 0.15, 0xfff4d8, this.flashTex);
    this.boom(center, hot, 80, 0.55);
    this.wave(center, radius, 0.4, hot);
    _v.copy(center);
    this.wave(_v, radius * 1.3, 0.6, cool);
    _v2.copy(center);
    const down = this.game.physics.raycast(center, _v3.set(0, -1, 0), 4, MASK.world, this.game.scratchHit);
    if (down) {
      _v2.copy(this.game.scratchHit.point);
      this.decal(this.game.scratchHit.point, this.game.scratchHit.normal, radius * 0.5);
    } else _v2.y -= 0.5;
    this.ring(_v2, radius * 1.05, 0.55, hot, 1);
    _c.setHex(hot);
    this.burst(center, 80, 12, _c.r * 3, _c.g * 3, _c.b * 3, 0.13, 0.8, 7, 1.4, 2);
    _c.setHex(cool);
    this.burst(center, 40, 8, _c.r * 3, _c.g * 3, _c.b * 3, 0.1, 1.0, 3, 1.2, 1);
    // Chunks thrown high that fall back.
    this.burst(center, 24, 9, 1.2, 0.7, 0.35, 0.09, 1.4, 14, 0.3, 5);
    this.smokePuff(center, 14, 1.0, 2.6, 0.16);
    this.dust(_v2, 2.5);
  }

  /** Big boss slam ring etc. */
  blast(pos: THREE.Vector3, radius: number, color: number): void {
    this.wave(pos, radius, 0.4, color);
    this.ring(pos, radius, 0.5, color, 1);
    _c.setHex(color);
    this.burst(pos, 50, 10, _c.r * 3, _c.g * 3, _c.b * 3, 0.12, 0.6, 5, 2);
    this.boom(pos, color, 50, 0.4);
    this.dust(pos, 2);
  }

  /** Generic glow orb burst used by pickups. */
  sparkle(pos: THREE.Vector3, color: number): void {
    _c.setHex(color);
    this.burst(pos, 16, 2, _c.r * 2.5, _c.g * 2.5, _c.b * 2.5, 0.07, 0.6, -1, 2);
  }

  /** Static glow sprite helper for other systems (e.g. boss orbs). */
  get glowTexture(): THREE.Texture {
    return this.glowTex;
  }

  spawnIn(pos: THREE.Vector3, height: number): void {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add.emit(pos.x + Math.cos(a) * 0.6, pos.y + Math.random() * height, pos.z + Math.sin(a) * 0.6, 0, 1 + Math.random(), 0, 3, 1.2, 0.4, 0.07, 0.6, { endSize: 0.01 });
    }
  }
}

export function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}

void _y;
