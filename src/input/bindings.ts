/**
 * The one input map. Every gameplay and UI action is listed here with its
 * keyboard/mouse and gamepad bindings. Rebinding means editing these tables.
 * Nothing is bound to Ctrl: Ctrl+W closes the browser tab.
 */

export const ACTIONS = [
  'fire', 'aim', 'reload', 'jump', 'sprint', 'dash',
  'power1', 'power2', 'power3', 'melee', 'interact',
  'swapWeapon', 'swapShoulder', 'pause', 'debug',
  'uiUp', 'uiDown', 'uiLeft', 'uiRight', 'uiConfirm', 'uiBack',
  'choice1', 'choice2', 'choice3', 'choice4',
] as const;

export type Action = (typeof ACTIONS)[number];

/** KeyboardEvent.code values, plus Mouse0/Mouse1/Mouse2 and WheelUp/WheelDown. */
export const KEYBOARD: Record<Action, readonly string[]> = {
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  dash: ['KeyQ'],
  power1: ['Digit1'],
  power2: ['Digit2'],
  power3: ['Digit3'],
  melee: ['KeyV'],
  interact: ['KeyE'],
  swapWeapon: ['Tab', 'WheelUp', 'WheelDown'],
  swapShoulder: ['KeyX'],
  pause: ['Escape', 'KeyP'],
  debug: ['Backquote'],
  uiUp: ['ArrowUp', 'KeyW'],
  uiDown: ['ArrowDown', 'KeyS'],
  uiLeft: ['ArrowLeft', 'KeyA'],
  uiRight: ['ArrowRight', 'KeyD'],
  uiConfirm: ['Enter', 'Space', 'KeyE'],
  uiBack: ['Escape', 'Backspace'],
  choice1: ['Digit1', 'Numpad1'],
  choice2: ['Digit2', 'Numpad2'],
  choice3: ['Digit3', 'Numpad3'],
  choice4: ['Digit4', 'Numpad4'],
};

/** Keys that move the player (WASD). Arrow keys are reserved for menus. */
export const MOVE_KEYS = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
} as const;

/** Standard gamepad mapping (Xbox layout). */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/**
 * Gamepad buttons per action. power1/power2/power3 are resolved from LB/RB
 * as a chord (see Input), so they are listed as the buttons involved.
 * X is shared by reload and interact; gameplay prefers interact when
 * something is in reach.
 */
export const GAMEPAD: Record<Action, readonly number[]> = {
  fire: [PAD.RT],
  aim: [PAD.LT],
  reload: [PAD.X],
  jump: [PAD.A],
  sprint: [PAD.L3],
  dash: [PAD.B],
  power1: [PAD.LB],
  power2: [PAD.RB],
  power3: [PAD.LB, PAD.RB],
  melee: [PAD.R3],
  interact: [PAD.X],
  swapWeapon: [PAD.Y],
  swapShoulder: [PAD.LEFT],
  pause: [PAD.MENU],
  debug: [],
  uiUp: [PAD.UP],
  uiDown: [PAD.DOWN],
  uiLeft: [PAD.LEFT],
  uiRight: [PAD.RIGHT],
  uiConfirm: [PAD.A],
  uiBack: [PAD.B, PAD.MENU],
  choice1: [],
  choice2: [],
  choice3: [],
  choice4: [],
};

/** Actions resolved through the LB/RB chord rather than plain buttons. */
export const CHORD_ACTIONS: readonly Action[] = ['power1', 'power2', 'power3'];

const KEY_LABELS: Record<string, string> = {
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', WheelUp: 'Wheel', WheelDown: 'Wheel',
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Tab: 'Tab', Escape: 'Esc',
  Enter: 'Enter', Backspace: 'Bksp', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓',
  ArrowLeft: '←', ArrowRight: '→',
};

export function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

const PAD_LABELS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'View', 9: 'Menu', 10: 'L3', 11: 'R3', 12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →',
};

export function padLabel(button: number): string {
  return PAD_LABELS[button] ?? `B${button}`;
}

/** Display labels for an action on a device, e.g. ['LB', 'RB'] or ['Q']. */
export function actionLabels(action: Action, device: 'kbm' | 'gamepad'): string[] {
  if (device === 'gamepad') {
    const b = GAMEPAD[action];
    if (action === 'power3') return ['LB+RB'];
    return b.length ? [padLabel(b[0])] : [];
  }
  const k = KEYBOARD[action];
  return k.length ? [keyLabel(k[0])] : [];
}

/** Labels for the movement and look controls, which are not plain actions. */
export function moveLabel(device: 'kbm' | 'gamepad'): string {
  return device === 'gamepad' ? 'LS' : 'WASD';
}

export function lookLabel(device: 'kbm' | 'gamepad'): string {
  return device === 'gamepad' ? 'RS' : 'Mouse';
}
