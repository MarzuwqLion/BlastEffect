import { CONFIG } from '../config';
import { settings } from '../core/settings';
import { ACTIONS, CHORD_ACTIONS, GAMEPAD, KEYBOARD, MOVE_KEYS, PAD, type Action } from './bindings';

export type Device = 'kbm' | 'gamepad';

const N = ACTIONS.length;
const INDEX = new Map<Action, number>(ACTIONS.map((a, i) => [a, i]));
const idx = (a: Action): number => INDEX.get(a)!;

/** Prevent browser defaults for these while the game has focus. */
const BLOCK_DEFAULT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'Backspace']);

/**
 * Keyboard, mouse and gamepad, merged through the one input map
 * (bindings.ts). Call update() once at the start of each frame and
 * endFrame() at the end. Tracks the last device used so prompts can match.
 */
export class Input {
  device: Device = 'kbm';
  readonly move = { x: 0, y: 0 };
  /** Look delta this frame in radians (yaw right +, pitch up +). */
  readonly look = { yaw: 0, pitch: 0 };
  /** Raw right stick, for aim assist. */
  readonly stick = { x: 0, y: 0 };
  pointerLocked = false;
  /** When true, mouse look works without pointer lock (automation). */
  allowUnlockedLook = false;
  aimingScale = 1;

  private readonly held = new Uint8Array(N);
  private readonly prevHeld = new Uint8Array(N);
  private readonly pressedEdge = new Uint8Array(N);
  private readonly releasedEdge = new Uint8Array(N);
  private readonly injected = new Uint8Array(N);
  private readonly injectedTap = new Uint8Array(N);

  private readonly codesDown = new Set<string>();
  private readonly codesTapped = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private injectedMove: { x: number; y: number } | null = null;
  private injectedLook = { yaw: 0, pitch: 0 };

  private padIndex: number | null = null;
  private readonly padButtons = new Float32Array(17);
  private readonly padPrev = new Float32Array(17);
  private readonly padAxes = new Float32Array(4);
  private chordLb = -1;
  private chordRb = -1;
  private chordFired = false;
  private chordOut: Action | null = null;
  private clock = 0;
  private stickDir: Action | null = null;
  private stickRepeat = 0;
  private stickTap: Action | null = null;
  private readonly dzOut = { x: 0, y: 0 };

  private deviceListeners: ((d: Device) => void)[] = [];
  private lockListeners: ((locked: boolean) => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('gamepadconnected', (e) => {
      if (this.padIndex === null) this.padIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === (e as GamepadEvent).gamepad.index) this.padIndex = null;
    });
  }

  onDeviceChange(l: (d: Device) => void): void {
    this.deviceListeners.push(l);
  }

  onPointerLockChange(l: (locked: boolean) => void): void {
    this.lockListeners.push(l);
  }

  requestPointerLock(): void {
    if (this.pointerLocked || this.allowUnlockedLook) return;
    try {
      const p = this.target.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      // Some browsers throw if called outside a gesture; the next click retries.
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** True while the action is held. */
  isHeld(a: Action): boolean {
    return this.held[idx(a)] === 1;
  }

  /** True on the frame the action went down. */
  pressed(a: Action): boolean {
    return this.pressedEdge[idx(a)] === 1;
  }

  released(a: Action): boolean {
    return this.releasedEdge[idx(a)] === 1;
  }

  /** Marks a press as handled so later readers this frame don't see it. */
  consume(a: Action): void {
    this.pressedEdge[idx(a)] = 0;
  }

  /** Automation hooks used by the Playwright scripts and debug API. */
  inject(a: Action, down: boolean): void {
    this.injected[idx(a)] = down ? 1 : 0;
    if (down) this.injectedTap[idx(a)] = 1;
  }

  injectMove(x: number, y: number): void {
    this.injectedMove = { x, y };
  }

  clearInjectedMove(): void {
    this.injectedMove = null;
  }

  injectLook(yaw: number, pitch: number): void {
    this.injectedLook.yaw += yaw;
    this.injectedLook.pitch += pitch;
  }

  rumble(strength: number, duration: number): void {
    if (this.device !== 'gamepad' || this.padIndex === null) return;
    const pad = navigator.getGamepads?.()[this.padIndex];
    const act = pad?.vibrationActuator as
      | { playEffect?: (t: string, p: Record<string, number>) => Promise<unknown> }
      | undefined;
    act?.playEffect?.('dual-rumble', {
      duration: Math.round(duration * 1000),
      strongMagnitude: Math.min(1, strength),
      weakMagnitude: Math.min(1, strength * 0.7),
    })?.catch(() => {});
  }

  update(dt: number): void {
    this.clock += dt;
    this.pollGamepad(dt);
    const s = settings.value;

    for (let i = 0; i < N; i++) {
      const a = ACTIONS[i];
      let h = this.injected[i] === 1 || this.injectedTap[i] === 1;
      let tapped = this.injectedTap[i] === 1;
      for (const code of KEYBOARD[a]) {
        if (this.codesDown.has(code)) h = true;
        if (this.codesTapped.has(code)) tapped = true;
      }
      if (!CHORD_ACTIONS.includes(a)) {
        for (const b of GAMEPAD[a]) {
          if (this.padButtons[b] > CONFIG.input.triggerThreshold) h = true;
        }
      }
      if (this.stickTap === a) tapped = true;
      this.prevHeld[i] = this.held[i];
      this.held[i] = h ? 1 : 0;
      this.pressedEdge[i] = (h && !this.prevHeld[i]) || (tapped && !this.prevHeld[i]) ? 1 : 0;
      this.releasedEdge[i] = !h && this.prevHeld[i] ? 1 : 0;
      this.injectedTap[i] = 0;
    }
    this.codesTapped.clear();
    this.stickTap = null;

    // LB/RB chord: a single press becomes power1/power2 once the chord window
    // passes; both within the window becomes power3.
    if (this.chordOut) {
      const i = idx(this.chordOut);
      this.pressedEdge[i] = 1;
      this.held[i] = 1;
      this.chordOut = null;
    }

    // Movement.
    let mx = 0;
    let my = 0;
    if (this.anyDown(MOVE_KEYS.right)) mx += 1;
    if (this.anyDown(MOVE_KEYS.left)) mx -= 1;
    if (this.anyDown(MOVE_KEYS.forward)) my += 1;
    if (this.anyDown(MOVE_KEYS.back)) my -= 1;
    const kl = Math.hypot(mx, my);
    if (kl > 1) {
      mx /= kl;
      my /= kl;
    }
    const lx = this.padAxes[0];
    const ly = -this.padAxes[1];
    radialDeadzone(lx, ly, CONFIG.input.deadzone, this.dzOut);
    if (Math.abs(this.dzOut.x) + Math.abs(this.dzOut.y) > Math.abs(mx) + Math.abs(my)) {
      mx = this.dzOut.x;
      my = this.dzOut.y;
    }
    if (this.injectedMove) {
      mx = this.injectedMove.x;
      my = this.injectedMove.y;
    }
    this.move.x = mx;
    this.move.y = my;

    // Look.
    const sens = s.sensitivity;
    const inv = s.invertY ? -1 : 1;
    const useMouse = this.pointerLocked || this.allowUnlockedLook;
    let yaw = useMouse ? this.mouseDx * CONFIG.input.mouseSensitivity * sens * this.aimingScale : 0;
    let pitch = useMouse ? -this.mouseDy * CONFIG.input.mouseSensitivity * sens * this.aimingScale * inv : 0;
    const rs = radialDeadzone(this.padAxes[2], -this.padAxes[3], CONFIG.input.deadzone * 0.8, this.dzOut);
    this.stick.x = rs.x;
    this.stick.y = rs.y;
    if (rs.x !== 0 || rs.y !== 0) {
      // Response curve: precise near centre, fast at the edge.
      const mag = Math.hypot(rs.x, rs.y);
      const curved = Math.pow(mag, 1.8) / mag;
      const padScale = sens * this.aimingScale * (this.aimingScale < 1 ? CONFIG.input.gamepadAimScale / this.aimingScale : 1);
      yaw += rs.x * curved * CONFIG.input.gamepadYawRate * padScale * dt;
      pitch += rs.y * curved * CONFIG.input.gamepadPitchRate * padScale * dt * inv;
    }
    yaw += this.injectedLook.yaw;
    pitch += this.injectedLook.pitch;
    this.injectedLook.yaw = 0;
    this.injectedLook.pitch = 0;
    this.look.yaw = yaw;
    this.look.pitch = pitch;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  /** Clears per-frame edges; call after all systems read input. */
  endFrame(): void {
    // Edges are recomputed in update(); nothing else to clear.
  }

  /** Clears all held state, e.g. when the window loses focus. */
  reset(): void {
    this.codesDown.clear();
    this.codesTapped.clear();
    this.held.fill(0);
    this.prevHeld.fill(0);
    this.pressedEdge.fill(0);
    this.injected.fill(0);
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  private anyDown(codes: readonly string[]): boolean {
    for (const c of codes) if (this.codesDown.has(c)) return true;
    return false;
  }

  private setDevice(d: Device): void {
    if (this.device === d) return;
    this.device = d;
    for (const l of this.deviceListeners) l(d);
  }

  private pollGamepad(dt: number): void {
    this.padPrev.set(this.padButtons);
    this.padButtons.fill(0);
    this.padAxes.fill(0);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    if (this.padIndex !== null) pad = pads[this.padIndex] ?? null;
    if (!pad) {
      for (const p of pads) {
        if (p && p.connected) {
          pad = p;
          this.padIndex = p.index;
          break;
        }
      }
    }
    if (!pad) return;
    const n = Math.min(pad.buttons.length, 17);
    let active = false;
    for (let i = 0; i < n; i++) {
      const b = pad.buttons[i];
      this.padButtons[i] = i === PAD.LT || i === PAD.RT ? b.value : b.pressed ? 1 : b.value;
      if (this.padButtons[i] > 0.5) active = true;
    }
    for (let i = 0; i < 4 && i < pad.axes.length; i++) {
      this.padAxes[i] = pad.axes[i];
      if (Math.abs(pad.axes[i]) > 0.5) active = true;
    }
    if (active) this.setDevice('gamepad');

    // Chord resolution for LB/RB.
    const lbDown = this.padButtons[PAD.LB] > 0.5;
    const rbDown = this.padButtons[PAD.RB] > 0.5;
    const lbEdge = lbDown && this.padPrev[PAD.LB] <= 0.5;
    const rbEdge = rbDown && this.padPrev[PAD.RB] <= 0.5;
    if (lbEdge) this.chordLb = this.clock;
    if (rbEdge) this.chordRb = this.clock;
    const win = CONFIG.input.chordWindow;
    if (!this.chordFired && this.chordLb >= 0 && this.chordRb >= 0 && Math.abs(this.chordLb - this.chordRb) <= win) {
      this.chordOut = 'power3';
      this.chordFired = true;
    } else if (!this.chordFired && this.chordLb >= 0 && this.chordRb < 0 && (this.clock - this.chordLb > win || !lbDown)) {
      this.chordOut = 'power1';
      this.chordFired = true;
    } else if (!this.chordFired && this.chordRb >= 0 && this.chordLb < 0 && (this.clock - this.chordRb > win || !rbDown)) {
      this.chordOut = 'power2';
      this.chordFired = true;
    }
    if (!lbDown && !rbDown) {
      this.chordLb = -1;
      this.chordRb = -1;
      this.chordFired = false;
    } else if (this.chordFired) {
      // Keep the chord latched until both buttons are released.
    }

    // Left stick also drives menu navigation: one press, then repeats.
    const ax = this.padAxes[0];
    const ay = this.padAxes[1];
    let dir: Action | null = null;
    if (ay < -0.6) dir = 'uiUp';
    else if (ay > 0.6) dir = 'uiDown';
    else if (ax < -0.6) dir = 'uiLeft';
    else if (ax > 0.6) dir = 'uiRight';
    if (dir !== this.stickDir) {
      this.stickDir = dir;
      this.stickRepeat = 0.4;
      if (dir) this.stickTap = dir;
    } else if (dir) {
      this.stickRepeat -= dt;
      if (this.stickRepeat <= 0) {
        this.stickRepeat = 0.18;
        this.stickTap = dir;
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey) return;
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.codesDown.add(e.code);
    this.codesTapped.add(e.code);
    this.setDevice('kbm');
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.codesDown.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    this.codesDown.add(code);
    this.codesTapped.add(code);
    this.setDevice('kbm');
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.codesDown.delete(`Mouse${e.button}`);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked && !this.allowUnlockedLook) return;
    // Ignore the occasional huge spike some browsers emit on lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.setDevice('kbm');
  };

  private onWheel = (e: WheelEvent): void => {
    const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    this.codesTapped.add(code);
  };

  private onBlur = (): void => {
    this.codesDown.clear();
  };

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.target;
    this.pointerLocked = locked;
    if (!locked) this.codesDown.clear();
    for (const l of this.lockListeners) l(locked);
  };
}

function radialDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  out.x = (x / m) * scaled;
  out.y = (y / m) * scaled;
  return out;
}
