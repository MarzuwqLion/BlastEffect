import * as THREE from 'three';

/**
 * Procedural canvas textures for the level: sandstone courses, lapis,
 * wet basalt pavers with puddles, glyph reliefs, awnings, plaster friezes.
 * Everything is drawn at load time; no image files.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Seeded RNG for repeatable textures. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, rnd: () => number, alpha: number, light: boolean): void {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * alpha})`;
    const s = 1 + rnd() * 2;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

export function sandstoneTexture(base = '#c7a679', mortar = '#8a7050', seed = 1): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const rnd = seeded(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  const rows = 8;
  const rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rh * 0.8 : 0;
    while (x < 512) {
      const w = rh * (1.4 + rnd() * 1.4);
      const tone = (rnd() - 0.5) * 30;
      g.fillStyle = `rgba(${tone > 0 ? 255 : 60},${tone > 0 ? 240 : 40},${tone > 0 ? 210 : 20},${Math.abs(tone) / 160})`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      g.fillStyle = mortar;
      g.fillRect(x, r * rh, 3, rh);
      x += w;
    }
    g.fillStyle = mortar;
    g.fillRect(0, r * rh, 512, 3);
  }
  speckle(g, 512, 512, 5000, rnd, 0.12, false);
  speckle(g, 512, 512, 2500, rnd, 0.1, true);
  // Weathering streaks.
  for (let i = 0; i < 18; i++) {
    const x = rnd() * 512;
    const grad = g.createLinearGradient(x, 0, x, 512);
    grad.addColorStop(0, 'rgba(40,30,20,0.12)');
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = grad;
    g.fillRect(x, rnd() * 200, 4 + rnd() * 10, 300);
  }
  return tex(c);
}

export function lapisTexture(seed = 2): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const rnd = seeded(seed);
  g.fillStyle = '#1b2f78';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(${80 + rnd() * 60},${110 + rnd() * 60},${200 + rnd() * 55},${0.08 + rnd() * 0.15})`;
    g.lineWidth = 2 + rnd() * 8;
    g.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 120;
      y += (rnd() - 0.5) * 120;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(230,190,90,${0.4 + rnd() * 0.6})`;
    const s = rnd() * 2.2;
    g.fillRect(rnd() * 512, rnd() * 512, s, s);
  }
  speckle(g, 512, 512, 3000, rnd, 0.15, false);
  return tex(c);
}

/** Dark basalt pavers; returns colour and a roughness map with puddles. */
export function streetTextures(seed = 3): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const [c, g] = canvas(512, 512);
  const [rc, rg] = canvas(512, 512);
  const rnd = seeded(seed);
  g.fillStyle = '#26282d';
  g.fillRect(0, 0, 512, 512);
  rg.fillStyle = 'rgb(140,140,140)';
  rg.fillRect(0, 0, 512, 512);
  const n = 4;
  const s = 512 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const off = y % 2 ? s / 2 : 0;
      const tone = 30 + rnd() * 18;
      g.fillStyle = `rgb(${tone},${tone + 1},${tone + 5})`;
      g.fillRect(((x * s + off) % 512) + 3, y * s + 3, s - 6, s - 6);
      if (off) g.fillRect(0, y * s + 3, off - 3, s - 6);
      rg.fillStyle = `rgb(${120 + rnd() * 50},${120 + rnd() * 50},${120 + rnd() * 50})`;
      rg.fillRect(((x * s + off) % 512) + 3, y * s + 3, s - 6, s - 6);
    }
  }
  speckle(g, 512, 512, 6000, rnd, 0.2, true);
  speckle(g, 512, 512, 6000, rnd, 0.25, false);
  // Puddles: very low roughness blobs, slightly darker colour.
  for (let i = 0; i < 9; i++) {
    const px = rnd() * 512;
    const py = rnd() * 512;
    const r = 30 + rnd() * 70;
    for (let k = 0; k < 4; k++) {
      const ox = (rnd() - 0.5) * r;
      const oy = (rnd() - 0.5) * r;
      const rr = r * (0.4 + rnd() * 0.5);
      const grad = rg.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr);
      grad.addColorStop(0, 'rgb(12,12,12)');
      grad.addColorStop(0.75, 'rgb(20,20,20)');
      grad.addColorStop(1, 'rgba(20,20,20,0)');
      rg.fillStyle = grad;
      rg.beginPath();
      rg.arc(px + ox, py + oy, rr, 0, Math.PI * 2);
      rg.fill();
      g.fillStyle = 'rgba(0,0,10,0.18)';
      g.beginPath();
      g.arc(px + ox, py + oy, rr * 0.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  return { map: tex(c), rough: tex(rc, false) };
}

export function tileTexture(seed = 4): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = seeded(seed);
  g.fillStyle = '#0d0e14';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 18 + rnd() * 10;
      g.fillStyle = `rgb(${v},${v},${v + 8})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  }
  return tex(c);
}

export function metalTexture(seed = 5): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = seeded(seed);
  g.fillStyle = '#3a3d44';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`;
    g.fillRect(0, rnd() * 256, 256, 1);
  }
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(2, 2, 252, 124);
  g.strokeRect(2, 130, 124, 124);
  g.strokeRect(130, 130, 124, 124);
  for (const [x, y] of [[10, 10], [246, 10], [10, 118], [246, 118], [10, 138], [118, 138], [138, 138], [246, 246]]) {
    g.fillStyle = 'rgba(200,200,210,0.3)';
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Painted plaster with a lotus frieze band near the top. */
export function plasterTexture(base: string, band: string, seed = 6): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const rnd = seeded(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 4000, rnd, 0.12, false);
  speckle(g, 512, 512, 2000, rnd, 0.08, true);
  // Frieze.
  g.fillStyle = band;
  g.fillRect(0, 40, 512, 56);
  g.fillStyle = '#d9b45a';
  g.fillRect(0, 36, 512, 4);
  g.fillRect(0, 96, 512, 4);
  for (let x = 0; x < 512; x += 32) {
    // Lotus flower and bud alternating.
    g.fillStyle = x % 64 ? '#e8d7a8' : '#3fa3a0';
    g.beginPath();
    g.moveTo(x + 16, 46);
    g.quadraticCurveTo(x + 4, 70, x + 10, 90);
    g.lineTo(x + 22, 90);
    g.quadraticCurveTo(x + 28, 70, x + 16, 46);
    g.fill();
  }
  return tex(c);
}

export type GlyphKind = 'eye' | 'ankh' | 'reed' | 'water' | 'bird' | 'scarab' | 'sun' | 'feather' | 'pillar' | 'lotus';
export const GLYPHS: GlyphKind[] = ['eye', 'ankh', 'reed', 'water', 'bird', 'scarab', 'sun', 'feather', 'pillar', 'lotus'];

/** Draws a simple glyph in a size×size box at (x, y). Stroke style set by caller. */
export function drawGlyph(g: CanvasRenderingContext2D, kind: GlyphKind, x: number, y: number, s: number): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.beginPath();
  switch (kind) {
    case 'eye':
      g.moveTo(x + s * 0.1, cy);
      g.quadraticCurveTo(cx, y + s * 0.15, x + s * 0.9, cy);
      g.quadraticCurveTo(cx, y + s * 0.75, x + s * 0.1, cy);
      g.moveTo(cx + s * 0.1, cy);
      g.arc(cx, cy, s * 0.1, 0, Math.PI * 2);
      g.moveTo(cx - s * 0.05, cy + s * 0.18);
      g.lineTo(cx - s * 0.12, y + s * 0.92);
      g.moveTo(cx + s * 0.05, cy + s * 0.15);
      g.quadraticCurveTo(cx + s * 0.25, y + s * 0.95, cx + s * 0.32, y + s * 0.75);
      break;
    case 'ankh':
      g.ellipse(cx, y + s * 0.28, s * 0.14, s * 0.2, 0, 0, Math.PI * 2);
      g.moveTo(x + s * 0.2, y + s * 0.5);
      g.lineTo(x + s * 0.8, y + s * 0.5);
      g.moveTo(cx, y + s * 0.48);
      g.lineTo(cx, y + s * 0.95);
      break;
    case 'reed':
      g.moveTo(cx, y + s * 0.95);
      g.lineTo(cx, y + s * 0.3);
      g.quadraticCurveTo(cx + s * 0.3, y + s * 0.05, cx + s * 0.05, y + s * 0.05);
      g.moveTo(cx, y + s * 0.6);
      g.lineTo(cx - s * 0.18, y + s * 0.45);
      break;
    case 'water':
      for (let k = 0; k < 3; k++) {
        const yy = y + s * (0.3 + k * 0.2);
        g.moveTo(x + s * 0.08, yy);
        for (let i = 0; i < 6; i++) g.lineTo(x + s * (0.08 + (i + 1) * 0.14), yy + (i % 2 ? -s * 0.06 : s * 0.06));
      }
      break;
    case 'bird':
      g.moveTo(x + s * 0.2, y + s * 0.92);
      g.lineTo(x + s * 0.35, y + s * 0.6);
      g.quadraticCurveTo(x + s * 0.3, y + s * 0.3, x + s * 0.5, y + s * 0.2);
      g.lineTo(x + s * 0.65, y + s * 0.25);
      g.lineTo(x + s * 0.55, y + s * 0.32);
      g.quadraticCurveTo(x + s * 0.75, y + s * 0.6, x + s * 0.9, y + s * 0.62);
      g.lineTo(x + s * 0.55, y + s * 0.72);
      g.lineTo(x + s * 0.5, y + s * 0.92);
      break;
    case 'scarab':
      g.ellipse(cx, cy + s * 0.05, s * 0.22, s * 0.3, 0, 0, Math.PI * 2);
      g.moveTo(cx, y + s * 0.25);
      g.lineTo(cx, y + s * 0.85);
      g.moveTo(cx - s * 0.22, cy);
      g.lineTo(x + s * 0.05, y + s * 0.35);
      g.moveTo(cx + s * 0.22, cy);
      g.lineTo(x + s * 0.95, y + s * 0.35);
      g.moveTo(cx - s * 0.2, cy + s * 0.2);
      g.lineTo(x + s * 0.08, y + s * 0.9);
      g.moveTo(cx + s * 0.2, cy + s * 0.2);
      g.lineTo(x + s * 0.92, y + s * 0.9);
      break;
    case 'sun':
      g.arc(cx, cy, s * 0.25, 0, Math.PI * 2);
      g.moveTo(cx + s * 0.08, cy);
      g.arc(cx, cy, s * 0.08, 0, Math.PI * 2);
      break;
    case 'feather':
      g.moveTo(cx, y + s * 0.95);
      g.quadraticCurveTo(cx - s * 0.25, y + s * 0.4, cx + s * 0.05, y + s * 0.05);
      g.quadraticCurveTo(cx + s * 0.2, y + s * 0.5, cx, y + s * 0.95);
      break;
    case 'pillar':
      g.moveTo(cx, y + s * 0.1);
      g.lineTo(cx, y + s * 0.95);
      for (let k = 0; k < 4; k++) {
        g.moveTo(x + s * 0.25, y + s * (0.12 + k * 0.08));
        g.lineTo(x + s * 0.75, y + s * (0.12 + k * 0.08));
      }
      break;
    case 'lotus':
      g.moveTo(cx, y + s * 0.95);
      g.lineTo(cx, y + s * 0.55);
      g.moveTo(cx, y + s * 0.55);
      g.quadraticCurveTo(x + s * 0.1, y + s * 0.4, x + s * 0.2, y + s * 0.15);
      g.quadraticCurveTo(cx - s * 0.05, y + s * 0.4, cx, y + s * 0.1);
      g.quadraticCurveTo(cx + s * 0.05, y + s * 0.4, x + s * 0.8, y + s * 0.15);
      g.quadraticCurveTo(x + s * 0.9, y + s * 0.4, cx, y + s * 0.55);
      break;
  }
  g.stroke();
}

/** Columns of carved glyphs on sandstone (relief) for pylons and walls. */
export function reliefTexture(seed = 7, glow = false): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const rnd = seeded(seed);
  if (glow) {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 512, 512);
  } else {
    g.drawImage(sandstoneTexture('#c9a87a', '#9a8060', seed).image as HTMLCanvasElement, 0, 0);
  }
  const cols = 6;
  const cw = 512 / cols;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let col = 0; col < cols; col++) {
    g.strokeStyle = glow ? 'rgba(80,230,255,1)' : 'rgba(80,58,36,0.75)';
    g.lineWidth = glow ? 4 : 5;
    if (!glow) {
      g.fillStyle = 'rgba(60,40,20,0.12)';
      g.fillRect(col * cw + 2, 0, 2, 512);
    }
    for (let row = 0; row < 7; row++) {
      const kind = GLYPHS[Math.floor(rnd() * GLYPHS.length)];
      drawGlyph(g, kind, col * cw + 12, row * (512 / 7) + 6, cw - 24);
    }
  }
  return tex(c);
}

export function awningTexture(a: string, b: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(i * 32, 0, 32, 256);
  }
  const rnd = seeded(9);
  speckle(g, 256, 256, 1500, rnd, 0.15, false);
  return tex(c);
}

export function woodTexture(seed = 8): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = seeded(seed);
  g.fillStyle = '#3b2618';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = `rgba(${20 + rnd() * 40},${10 + rnd() * 20},5,${0.2 + rnd() * 0.3})`;
    g.lineWidth = 1 + rnd() * 2;
    const y = rnd() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (rnd() - 0.5) * 10, 160, y + (rnd() - 0.5) * 10, 256, y);
    g.stroke();
  }
  return tex(c);
}

/** Neon sign text on transparent black, for emissive maps. */
export function signTexture(text: string, color: string, opts: { font?: string; width?: number; height?: number; border?: boolean; glyphs?: boolean } = {}): THREE.CanvasTexture {
  const w = opts.width ?? 512;
  const h = opts.height ?? 128;
  const [c, g] = canvas(w, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 4;
  g.font = opts.font ?? `600 ${Math.floor(h * 0.5)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.globalAlpha = 0.65;
  g.fillText(text, w / 2, h / 2 + 2);
  g.globalAlpha = 1;
  if (opts.border) {
    g.shadowBlur = 12;
    g.strokeRect(8, 8, w - 16, h - 16);
  }
  if (opts.glyphs) {
    g.lineWidth = 3;
    const s = h * 0.5;
    drawGlyph(g, 'eye', 12, h / 2 - s / 2, s);
    drawGlyph(g, 'lotus', w - 12 - s, h / 2 - s / 2, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A single glyph on black for holograms. */
export function glyphTexture(kind: GlyphKind, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = color;
  g.shadowBlur = 20;
  drawGlyph(g, kind, 28, 28, 200);
  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  drawGlyph(g, kind, 28, 28, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
