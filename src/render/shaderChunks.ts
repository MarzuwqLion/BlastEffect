/** GLSL snippets shared by the level, character and FX materials. */

export const HASH_GLSL = /* glsl */ `
vec2 na_hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float na_hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float na_vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = na_hash1(i);
  float b = na_hash1(i + vec2(1.0, 0.0));
  float c = na_hash1(i + vec2(0.0, 1.0));
  float d = na_hash1(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/**
 * Caustics from animated cellular noise: bright thin lines where the two
 * nearest cell distances meet. Two layers at different scales.
 */
export const CAUSTICS_GLSL = /* glsl */ `
float na_causticLayer(vec2 p, float t) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = na_hash2(ip + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - fp);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  return 1.0 - smoothstep(0.0, 0.14, d2 - d1);
}
float na_caustics(vec2 p, float t) {
  return na_causticLayer(p, t) * 0.65 + na_causticLayer(p * 1.73 + 3.1, t * 1.31) * 0.45;
}
`;
