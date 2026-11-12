import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Sits between the scene and the bloom. The picture at that point is
 * high-dynamic-range, and one pixel holding "not a number" or infinity (a
 * single undefined operation in one shader on one GPU is enough) is smeared
 * by the bloom's blur until blocks of the screen, or all of it, are black.
 * This pass replaces anything that is not a sane brightness with one that
 * is, so a bad pixel stays one pixel.
 */
const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Brightest value let through (the bloom threshold is 1). */
    uMax: { value: 64 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    // NaN fails every comparison, so it falls through to 0; infinity and
    // blown-out highlights stop at uMax; negatives become 0.
    float clean(float v) {
      return (v >= 0.0 && v <= uMax) ? v : (v > uMax ? uMax : 0.0);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // On GPUs that follow IEEE, min and max already drop a NaN operand.
      c = min(max(c, vec3(0.0)), vec3(uMax));
      gl_FragColor = vec4(clean(c.r), clean(c.g), clean(c.b), 1.0);
    }`,
};

export class SanitizePass extends ShaderPass {
  constructor() {
    super(SanitizeShader);
  }
}
