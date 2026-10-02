import type { Layer } from '../combat/damage';

/** Defense layer icons: shape as well as colour, so layers read without colour. */
export const LAYER_ICON: Record<Layer, string> = {
  // Hexagon: shields.
  shield: '<svg viewBox="0 0 24 24"><path d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z M12 5l-6.1 3.5v7L12 19l6.1-3.5v-7z" fill-rule="evenodd"/></svg>',
  // Stacked chevron plates: armor.
  armor: '<svg viewBox="0 0 24 24"><path d="M3 4l9-3 9 3v5l-9 3-9-3z M3 13l9 3 9-3v4.5l-9 4.5-9-4.5z"/></svg>',
  // Cross: health.
  health: '<svg viewBox="0 0 24 24"><path d="M8.5 2h7v6.5H22v7h-6.5V22h-7v-6.5H2v-7h6.5z"/></svg>',
};

export function layerIcon(layer: Layer): string {
  return `<span class="layer-icon ${layer}">${LAYER_ICON[layer]}</span>`;
}

/** Power tile icons (stroked). */
export const POWER_ICON = {
  // Snare: rising rings around a figure.
  pull: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="25" rx="10" ry="3"/><ellipse cx="16" cy="18" rx="7" ry="2.2"/><circle cx="16" cy="9" r="3"/><path d="M16 12v6M12 4l4-3 4 3"/></svg>',
  // Lance: a thrown bolt.
  throw: '<svg viewBox="0 0 32 32"><path d="M4 26L24 6M24 6h-7M24 6v7"/><path d="M8 18l-3 3M12 22l-3 3"/></svg>',
  // Surge: figure rushing forward.
  charge: '<svg viewBox="0 0 32 32"><path d="M6 16h12M9 11h8M9 21h8"/><path d="M18 8l8 8-8 8z"/></svg>',
};

export const HIT_X = '<svg viewBox="0 0 30 30"><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 4l7 7M26 4l-7 7M4 26l7-7M26 26l-7-7"/></g></svg>';
