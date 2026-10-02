import { actionLabels, lookLabel, moveLabel, GAMEPAD, PAD, type Action } from '../input/bindings';
import type { Device } from '../input/Input';

const PAD_CLASS: Record<number, string> = {
  [PAD.A]: 'a', [PAD.B]: 'b', [PAD.X]: 'x', [PAD.Y]: 'y',
  [PAD.LB]: 'shoulder', [PAD.RB]: 'shoulder', [PAD.LT]: 'shoulder', [PAD.RT]: 'shoulder',
};

/** HTML for the key/button glyph of an action on the given device. */
export function glyph(action: Action, device: Device): string {
  const labels = actionLabels(action, device);
  if (device === 'gamepad') {
    const b = GAMEPAD[action][0];
    const cls = action === 'power3' ? 'shoulder' : PAD_CLASS[b] ?? '';
    return `<span class="key pad ${cls}">${labels[0] ?? '?'}</span>`;
  }
  return `<span class="key">${labels[0] ?? '?'}</span>`;
}

/** Replace {action} tokens (plus {move}/{look}) in a template with glyphs. */
export function withGlyphs(template: string, device: Device): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (name === 'move') return `<span class="key${device === 'gamepad' ? ' pad shoulder' : ''}">${moveLabel(device)}</span>`;
    if (name === 'look') return `<span class="key${device === 'gamepad' ? ' pad shoulder' : ''}">${lookLabel(device)}</span>`;
    return glyph(name as Action, device);
  });
}
