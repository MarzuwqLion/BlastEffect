import { describe, expect, it } from 'vitest';
import { ACTIONS, GAMEPAD, KEYBOARD, MOVE_KEYS } from '../src/input/bindings';

describe('input map', () => {
  it('never binds gameplay to Ctrl (Ctrl+W closes the tab)', () => {
    const all = [...Object.values(KEYBOARD).flat(), ...Object.values(MOVE_KEYS).flat()];
    expect(all.some((k) => /Control|Ctrl|Meta/.test(k))).toBe(false);
  });

  it('every action has a keyboard binding and every gameplay action a gamepad binding', () => {
    for (const a of ACTIONS) {
      if (a === 'debug' || a.startsWith('choice')) continue;
      expect(KEYBOARD[a].length, a).toBeGreaterThan(0);
      expect(GAMEPAD[a].length, a).toBeGreaterThan(0);
    }
  });

  it('matches the requested keyboard layout', () => {
    expect(KEYBOARD.fire).toContain('Mouse0');
    expect(KEYBOARD.aim).toContain('Mouse2');
    expect(KEYBOARD.reload).toContain('KeyR');
    expect(KEYBOARD.jump).toContain('Space');
    expect(KEYBOARD.sprint).toContain('ShiftLeft');
    expect(KEYBOARD.dash).toContain('KeyQ');
    expect(KEYBOARD.power1).toContain('Digit1');
    expect(KEYBOARD.melee).toContain('KeyV');
    expect(KEYBOARD.interact).toContain('KeyE');
    expect(KEYBOARD.swapWeapon).toContain('Tab');
    expect(KEYBOARD.swapShoulder).toContain('KeyX');
    expect(KEYBOARD.pause).toContain('Escape');
  });

  it('matches the requested gamepad layout (Xbox)', () => {
    expect(GAMEPAD.fire).toEqual([7]);
    expect(GAMEPAD.aim).toEqual([6]);
    expect(GAMEPAD.jump).toEqual([0]);
    expect(GAMEPAD.dash).toEqual([1]);
    expect(GAMEPAD.sprint).toEqual([10]);
    expect(GAMEPAD.reload).toEqual([2]);
    expect(GAMEPAD.interact).toEqual([2]);
    expect(GAMEPAD.swapWeapon).toEqual([3]);
    expect(GAMEPAD.power1).toEqual([4]);
    expect(GAMEPAD.power2).toEqual([5]);
    expect(GAMEPAD.power3).toEqual([4, 5]);
    expect(GAMEPAD.melee).toEqual([11]);
    expect(GAMEPAD.swapShoulder).toEqual([14]);
    expect(GAMEPAD.pause).toEqual([9]);
  });
});
