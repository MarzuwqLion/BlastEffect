import * as THREE from 'three';
import { globalUniforms } from './materials';
import { CAUSTICS_GLSL, HASH_GLSL } from './shaderChunks';

/**
 * The city dome overhead: dark sea through hexagonal glass, shafts of
 * filtered light, caustic shimmer, passing silhouettes of sea life, and
 * marine snow drifting around the camera.
 */
export class Dome {
  readonly group = new THREE.Group();
  private readonly creatures: { sprite: THREE.Sprite; axis: THREE.Vector3; speed: number; angle: number; elev: number; radius: number; base: THREE.Vector3 }[] = [];
  private readonly snow: THREE.Points;
  private readonly snowPos: Float32Array;

  constructor(scene: THREE.Scene, lifeCount: number) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: globalUniforms.uTime },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
          gl_Position.z = gl_Position.w * 0.99995;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDir;
        ${HASH_GLSL}
        ${CAUSTICS_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float elev = asin(clamp(d.y, -1.0, 1.0));
          float az = atan(d.z, d.x);
          float h = clamp(d.y, 0.0, 1.0);
          // Water colour: lighter toward the surface far above.
          vec3 deep = vec3(0.002, 0.008, 0.016);
          vec3 mid = vec3(0.004, 0.03, 0.045);
          vec3 top = vec3(0.015, 0.085, 0.1);
          vec3 col = mix(deep, mid, smoothstep(-0.05, 0.45, h));
          col = mix(col, top, smoothstep(0.55, 1.0, h));
          // Light shafts from above, drifting.
          float rays = na_vnoise(vec2(az * 9.0 + uTime * 0.03, 0.0)) * na_vnoise(vec2(az * 23.0 - uTime * 0.05, 3.0));
          rays = pow(rays, 2.0) * smoothstep(0.15, 0.9, h);
          col += vec3(0.04, 0.14, 0.15) * rays * 0.8;
          // Caustic shimmer on the glass.
          vec2 cuv = vec2(az * 6.0, elev * 8.0);
          col += vec3(0.04, 0.16, 0.18) * na_caustics(cuv * 1.3, uTime * 0.35) * smoothstep(0.1, 0.8, h) * 0.4;
          // Hexagonal frame of the dome.
          vec2 g = vec2(az * 14.0 / 3.14159, elev * 14.0 / 1.5708 * 0.9);
          vec2 r = vec2(1.0, 1.732);
          vec2 hA = mod(g, r) - r * 0.5;
          vec2 hB = mod(g - r * 0.5, r) - r * 0.5;
          vec2 gh = dot(hA, hA) < dot(hB, hB) ? hA : hB;
          vec2 ah = abs(gh);
          float hexd = max(dot(ah, normalize(vec2(1.0, 1.732))), ah.x);
          float frame = smoothstep(0.47, 0.5, hexd) * smoothstep(0.0, 0.25, h);
          col = mix(col, vec3(0.006, 0.01, 0.014), frame * 0.7);
          col += vec3(0.5, 0.36, 0.12) * frame * 0.015;
          // Lit nodes at frame joints.
          float node = smoothstep(0.08, 0.0, length(gh) - 0.0) * 0.0;
          col += vec3(0.2, 0.9, 1.0) * node;
          // Below the horizon fades to black (the city floor).
          col *= smoothstep(-0.25, 0.05, d.y);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);

    // Sea life silhouettes.
    const kinds = ['manta', 'whale', 'school', 'shark', 'turtle'];
    for (let i = 0; i < lifeCount; i++) {
      const kind = kinds[i % kinds.length];
      const tex = creatureTexture(kind);
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false, opacity: 0.85 });
      const sprite = new THREE.Sprite(sm);
      const size = (kind === 'whale' ? 90 : kind === 'school' ? 70 : kind === 'manta' ? 45 : 30) * 0.2;
      sprite.scale.set(size, size * 0.5, 1);
      sprite.renderOrder = -9;
      this.group.add(sprite);
      const axis = new THREE.Vector3(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();
      this.creatures.push({ sprite, axis, speed: (0.004 + Math.random() * 0.006) * (Math.random() < 0.5 ? -1 : 1), angle: Math.random() * Math.PI * 2, elev: 0.5 + Math.random() * 0.45, radius: 120 + Math.random() * 25, base: new THREE.Vector3() });
    }

    // Marine snow.
    const n = 600;
    this.snowPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.snowPos[i * 3] = (Math.random() - 0.5) * 40;
      this.snowPos[i * 3 + 1] = Math.random() * 20;
      this.snowPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fd8e0, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    scene.add(this.group);
  }

  setIndoors(indoors: boolean): void {
    this.snow.visible = !indoors;
  }

  update(dt: number, cam: THREE.Vector3): void {
    // Sky follows the camera so it never clips.
    this.group.children[0].position.copy(cam);
    for (const c of this.creatures) {
      c.angle += c.speed * dt * 10;
      const el = c.elev;
      // Far away and drawn behind everything, so position relative to the camera.
      c.sprite.position.set(
        cam.x + Math.cos(c.angle) * Math.cos(el) * c.radius,
        cam.y + Math.sin(el) * c.radius,
        cam.z + Math.sin(c.angle) * Math.cos(el) * c.radius,
      );
      // Face along the direction of travel.
      (c.sprite.material as THREE.SpriteMaterial).rotation = -c.angle * Math.sign(c.speed) + (c.speed < 0 ? Math.PI : 0);
    }
    const p = this.snowPos;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= dt * 0.15;
      p[i] += Math.sin(p[i + 1] * 0.7 + i) * dt * 0.05;
      // Wrap around the camera.
      if (p[i + 1] < cam.y - 4) p[i + 1] += 20;
      if (p[i + 1] > cam.y + 16) p[i + 1] -= 20;
      if (p[i] < cam.x - 20) p[i] += 40;
      if (p[i] > cam.x + 20) p[i] -= 40;
      if (p[i + 2] < cam.z - 20) p[i + 2] += 40;
      if (p[i + 2] > cam.z + 20) p[i + 2] -= 40;
    }
    (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Silhouettes of sea life, drawn as dark shapes with a faint rim light. */
function creatureTexture(kind: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(2,10,16,0.95)';
  g.strokeStyle = 'rgba(80,200,220,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  if (kind === 'manta') {
    g.moveTo(40, 64);
    g.quadraticCurveTo(110, 10, 150, 50);
    g.lineTo(200, 64);
    g.lineTo(150, 78);
    g.quadraticCurveTo(110, 118, 40, 64);
    g.moveTo(195, 64);
    g.lineTo(250, 62);
  } else if (kind === 'whale') {
    g.moveTo(20, 64);
    g.quadraticCurveTo(60, 30, 160, 44);
    g.quadraticCurveTo(200, 50, 215, 60);
    g.lineTo(250, 40);
    g.lineTo(240, 64);
    g.lineTo(250, 88);
    g.lineTo(215, 70);
    g.quadraticCurveTo(160, 92, 70, 84);
    g.quadraticCurveTo(30, 80, 20, 64);
    g.moveTo(110, 80);
    g.lineTo(130, 104);
    g.lineTo(140, 82);
  } else if (kind === 'shark') {
    g.moveTo(20, 66);
    g.quadraticCurveTo(80, 44, 170, 60);
    g.lineTo(230, 44);
    g.lineTo(215, 66);
    g.lineTo(235, 86);
    g.lineTo(170, 70);
    g.quadraticCurveTo(80, 84, 20, 66);
    g.moveTo(100, 54);
    g.lineTo(120, 30);
    g.lineTo(130, 56);
  } else if (kind === 'turtle') {
    g.ellipse(128, 64, 50, 34, 0, 0, Math.PI * 2);
    g.moveTo(178, 64);
    g.arc(190, 64, 12, 0, Math.PI * 2);
    g.moveTo(110, 34);
    g.lineTo(90, 8);
    g.lineTo(130, 32);
    g.moveTo(110, 94);
    g.lineTo(90, 120);
    g.lineTo(130, 96);
  } else {
    // School of fish.
    for (let i = 0; i < 40; i++) {
      const x = 20 + Math.random() * 216;
      const y = 30 + Math.random() * 68 + Math.sin(x * 0.05) * 10;
      g.moveTo(x, y);
      g.ellipse(x, y, 5, 2, 0, 0, Math.PI * 2);
      g.moveTo(x - 5, y);
      g.lineTo(x - 9, y - 3);
      g.lineTo(x - 9, y + 3);
    }
  }
  g.fill();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
