import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONFIG } from '../config';

/**
 * The last pass of the post chain, on the tone-mapped image: edge
 * anti-aliasing (FXAA, for the presets without MSAA), a vignette, a touch
 * of colour fringing that swells with impacts, film grain, and a fade to
 * grey for death. One full-screen shader.
 */
const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uTime: { value: 0 },
    uVignette: { value: CONFIG.look.vignette },
    uGrain: { value: CONFIG.look.grain },
    uAberration: { value: CONFIG.look.aberration },
    uImpact: { value: 0 },
    uDesat: { value: 0 },
    uFxaa: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uImpact;
    uniform float uDesat;
    uniform float uFxaa;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.299, 0.587, 0.114);

    // Fast approximate anti-aliasing: blur along the local edge direction.
    vec3 fxaa(vec2 uv) {
      vec3 m = texture2D(tDiffuse, uv).rgb;
      vec3 nw = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * uTexel).rgb;
      vec3 ne = texture2D(tDiffuse, uv + vec2(1.0, -1.0) * uTexel).rgb;
      vec3 sw = texture2D(tDiffuse, uv + vec2(-1.0, 1.0) * uTexel).rgb;
      vec3 se = texture2D(tDiffuse, uv + vec2(1.0, 1.0) * uTexel).rgb;
      float lM = dot(m, LUMA);
      float lNW = dot(nw, LUMA);
      float lNE = dot(ne, LUMA);
      float lSW = dot(sw, LUMA);
      float lSE = dot(se, LUMA);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = dot(b, LUMA);
      return (lB < lMin || lB > lMax) ? a : b;
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col = uFxaa > 0.5 ? fxaa(vUv) : texture2D(tDiffuse, vUv).rgb;
      // Fringing grows toward the corners and with impacts.
      float ab = (uAberration + uImpact * 0.006) * r2 * 4.0;
      if (ab > 0.00005) {
        col.r = mix(col.r, texture2D(tDiffuse, vUv + c * ab).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - c * ab).b, 0.85);
      }
      float l = dot(col, LUMA);
      // Split tone: cool shadows, slightly warm highlights.
      col += vec3(-0.006, 0.003, 0.011) * (1.0 - smoothstep(0.0, 0.45, l));
      col *= mix(vec3(1.0), vec3(1.025, 1.0, 0.965), smoothstep(0.5, 1.0, l));
      col = mix(col, vec3(l), uDesat * 0.85);
      // Vignette.
      float v = smoothstep(0.32, 1.0, length(c) * 1.32);
      col *= 1.0 - uVignette * v;
      // Grain, stronger in the dark where banding shows.
      float g = hash(vUv / uTexel + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (1.0 - l * 0.6);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class FinishPass extends ShaderPass {
  constructor() {
    super(FinishShader);
  }

  setResolution(width: number, height: number): void {
    (this.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  set fxaa(on: boolean) {
    this.uniforms.uFxaa.value = on ? 1 : 0;
  }

  /** Per frame: time for the grain, impact (0..1 camera trauma), desaturation (0..1). */
  setFrame(time: number, impact: number, desat: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uImpact.value = impact;
    this.uniforms.uDesat.value = desat;
  }
}
