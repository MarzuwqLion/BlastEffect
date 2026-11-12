import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GLSL leaves some operations undefined, and GPUs disagree about them: one
 * returns a number, another "not a number". With a high-dynamic-range
 * picture and bloom, a single such pixel blacks out blocks of the screen
 * (the High preset did exactly that: multisampling shades edge pixels just
 * outside a shape, where a value that is never negative inside it is). The
 * software renderer the scripted runs use does not show it, so these checks
 * read the shader source instead.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const SOURCES = sourceFiles('src').map((f) => [f, readFileSync(f, 'utf8')] as const);

describe('shader math is defined for every input', () => {
  it('finds the shaders', () => {
    expect(SOURCES.filter(([, s]) => s.includes('gl_FragColor')).length).toBeGreaterThan(8);
  });

  it('every pow() clamps its base: pow of a negative number is undefined', () => {
    const bad: string[] = [];
    for (const [f, s] of SOURCES) {
      // GLSL pow only: Math.pow has a dot in front.
      for (const m of s.matchAll(/(?<![\w.])pow\(\s*([^,]*)/g)) {
        const base = m[1].trim();
        if (!/^(max|clamp|abs)\(/.test(base)) bad.push(`${f}: pow(${base}, …)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no smoothstep with its edges the wrong way round: undefined when edge0 >= edge1', () => {
    const bad: string[] = [];
    for (const [f, s] of SOURCES) {
      for (const m of s.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        if (Number(m[1]) >= Number(m[2])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no sqrt, log or bare atan of a value that can leave its domain', () => {
    const bad: string[] = [];
    for (const [f, s] of SOURCES) {
      if (!s.includes('gl_FragColor') && !s.includes('glsl')) continue;
      for (const m of s.matchAll(/(?<![\w.])(sqrt|log|inversesqrt|acos|asin)\(\s*([^)]*)/g)) {
        const arg = m[2].trim();
        // Allowed: a clamped argument, or the rim term (a pow of a clamped base, so never negative).
        if (!/^(max|clamp|abs)\(/.test(arg) && arg !== 'rim') bad.push(`${f}: ${m[1]}(${arg}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the scene is sanitized before the bloom', () => {
    const renderer = SOURCES.find(([f]) => f.endsWith('Renderer.ts'))![1];
    const sanitize = renderer.indexOf('new SanitizePass()');
    expect(sanitize).toBeGreaterThan(renderer.indexOf('addPass(this.renderPass)'));
    expect(sanitize).toBeLessThan(renderer.indexOf('addPass(this.bloom)'));
  });
});
