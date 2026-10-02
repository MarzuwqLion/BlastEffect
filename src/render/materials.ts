import * as THREE from 'three';
import { CAUSTICS_GLSL, HASH_GLSL } from './shaderChunks';

/** Uniforms shared by every level material. */
export const globalUniforms = {
  uTime: { value: 0 },
  uCaustics: { value: 1 },
  uCausticColor: { value: new THREE.Color(0x4fd8ff) },
};

export interface LevelMatOptions {
  color: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  /** World units per texture repeat for triplanar mapping. */
  texScale?: number;
  caustics?: number;
  envMapIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** Use mesh UVs instead of world-space triplanar mapping. */
  useUv?: boolean;
  name?: string;
}

/**
 * MeshStandardMaterial with world-space triplanar texturing (so merged
 * geometry never needs UVs that match) and an animated caustic light
 * pattern from the dome above.
 */
export function levelMaterial(o: LevelMatOptions): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color,
    map: o.map ?? null,
    roughnessMap: o.roughnessMap ?? null,
    normalMap: o.normalMap ?? null,
    roughness: o.roughness ?? 0.8,
    metalness: o.metalness ?? 0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    envMapIntensity: o.envMapIntensity ?? 1,
  });
  m.name = o.name ?? 'level';
  const texScale = 1 / (o.texScale ?? 2);
  const caustics = o.caustics ?? 0.5;
  const triplanar = !o.useUv;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uCaustics = globalUniforms.uCaustics;
    shader.uniforms.uCausticColor = globalUniforms.uCausticColor;
    shader.uniforms.uTexScale = { value: texScale };
    shader.uniforms.uCausticAmount = { value: caustics };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vNaWorldPos;
varying vec3 vNaWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
{
  vec4 naWp = vec4(transformed, 1.0);
  vec3 naN = objectNormal;
  #ifdef USE_INSTANCING
    naWp = instanceMatrix * naWp;
    naN = mat3(instanceMatrix) * naN;
  #endif
  naWp = modelMatrix * naWp;
  vNaWorldPos = naWp.xyz;
  vNaWorldNormal = normalize(mat3(modelMatrix) * naN);
}`,
      );
    let frag = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying vec3 vNaWorldPos;
varying vec3 vNaWorldNormal;
uniform float uTime;
uniform float uCaustics;
uniform vec3 uCausticColor;
uniform float uTexScale;
uniform float uCausticAmount;
${HASH_GLSL}
${CAUSTICS_GLSL}
vec4 naTriplanar(sampler2D tex) {
  vec3 bw = abs(normalize(vNaWorldNormal));
  bw = pow(bw, vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  vec4 x = texture2D(tex, vNaWorldPos.zy * uTexScale);
  vec4 y = texture2D(tex, vNaWorldPos.xz * uTexScale);
  vec4 z = texture2D(tex, vNaWorldPos.xy * uTexScale);
  return x * bw.x + y * bw.y + z * bw.z;
}`,
    );
    if (triplanar) {
      frag = frag
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  vec4 sampledDiffuseColor = naTriplanar(map);
  diffuseColor *= sampledDiffuseColor;
#endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = naTriplanar(roughnessMap);
  roughnessFactor *= texelRoughness.g;
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = naTriplanar(emissiveMap);
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
        );
    }
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
if (uCaustics > 0.5 && uCausticAmount > 0.0) {
  float naUp = smoothstep(0.2, 0.9, normalize(vNaWorldNormal).y);
  float naSide = (1.0 - naUp) * 0.35;
  vec2 naP = vNaWorldPos.xz * 0.32 + vec2(vNaWorldPos.y * 0.15);
  float naC = na_caustics(naP, uTime * 0.6);
  totalEmissiveRadiance += uCausticColor * naC * (naUp + naSide) * uCausticAmount * 0.12 * diffuseColor.rgb * 2.0;
}`,
    );
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `level-${triplanar ? 'tri' : 'uv'}`;
  return m;
}

/** Unlit emissive material for neon tubes and glowing trim (bloom does the rest). */
export function neonMaterial(color: THREE.ColorRepresentation, intensity = 3): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: true });
  m.name = 'neon';
  return m;
}
