import type { QualityLevel } from '../config';

export type TextSize = 'small' | 'medium' | 'large';

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: QualityLevel;
  textSize: TextSize;
  aimAssist: boolean;
}

const KEY = 'neo-atlantis.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
  quality: 'medium',
  textSize: 'medium',
  aimAssist: true,
};

type Listener = (s: Settings) => void;

class SettingsStore {
  readonly value: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.value = { ...DEFAULT_SETTINGS };
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      if (raw) Object.assign(this.value, JSON.parse(raw));
    } catch {
      // Storage can be unavailable (private mode); defaults are fine.
    }
  }

  set<K extends keyof Settings>(key: K, v: Settings[K]): void {
    this.value[key] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // ignore
    }
    for (const l of this.listeners) l(this.value);
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}

export const settings = new SettingsStore();
