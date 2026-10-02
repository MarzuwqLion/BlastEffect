import * as THREE from 'three';

/**
 * CPU-simulated, GPU-drawn point particles. Fixed-size typed arrays, no
 * per-frame allocation. One draw call per system.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly startCol: Float32Array;
  private readonly size: Float32Array;
  private readonly startSize: Float32Array;
  private readonly endSize: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private cursor = 0;
  scale = 1;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.startCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.startSize = new Float32Array(max);
    this.endSize = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixel;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixel * (300.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
          if (alpha <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 7;
  }

  setPixelRatio(pr: number, height: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uPixel.value = pr * (height / 900);
  }

  /**
   * Emit one particle. Colour may exceed 1 for bloom. `endSize` defaults to
   * `size`; `gravity` in m/s²; `drag` per second.
   */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    size: number, life: number,
    opts?: { endSize?: number; drag?: number; gravity?: number },
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.startCol[i3] = r;
    this.startCol[i3 + 1] = g;
    this.startCol[i3 + 2] = b;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.startSize[i] = size;
    this.endSize[i] = opts?.endSize ?? size;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.drag[i] = opts?.drag ?? 0;
    this.grav[i] = opts?.gravity ?? 0;
  }

  update(dt: number): void {
    let last = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * t;
      // Fade in fast, out smoothly.
      this.alpha[i] = this.life[i] > 0 ? Math.min(1, t * 12) * (1 - t * t) : 0;
      last = i + 1;
    }
    this.geo.setDrawRange(0, last);
    if (last > 0) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
