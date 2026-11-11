import { CONFIG } from '../config';
import type { Difficulty } from '../core/settings';

/** What a run is scored on. Plain numbers so it can be saved and tested. */
export interface RunTotals {
  /** Seconds in control (not paused, not in menus). */
  time: number;
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
  combos: number;
  ambushes: number;
  damageTaken: number;
  deaths: number;
}

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

export interface RunResult {
  score: number;
  rank: Rank;
  accuracy: number;
  /** Points per category, for the results screen. */
  parts: { time: number; accuracy: number; survival: number; style: number; thorough: number };
}

export function emptyTotals(): RunTotals {
  return { time: 0, shots: 0, hits: 0, headshots: 0, kills: 0, combos: 0, ambushes: 0, damageTaken: 0, deaths: 0 };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Scores a finished run out of 100. Speed, accuracy and staying alive carry
 * most of it; combos, headshots and exploring fill the rest. Harder
 * difficulties scale the total. Tuned so a first clear (20 minutes, a
 * couple of deaths, 40% accuracy) lands around C, and S takes a fast,
 * clean run that also found everything.
 */
export function scoreRun(t: RunTotals, found: { logs: number; logsTotal: number; zones: number; zonesTotal: number }, difficulty: Difficulty): RunResult {
  const accuracy = t.shots > 0 ? t.hits / t.shots : 0;
  const parts = {
    // Full marks at 9 minutes or less, none at 30.
    time: clamp01(1 - (t.time - 540) / 1260) * 30,
    accuracy: clamp01((accuracy - 0.15) / 0.45) * 20,
    survival: Math.max(0, 20 - t.deaths * 5),
    style: clamp01(t.combos / 10) * 12 + clamp01(t.headshots / 12) * 5 + clamp01(t.ambushes / 3) * 3,
    thorough: (found.logsTotal ? found.logs / found.logsTotal : 0) * 5 + (found.zonesTotal ? found.zones / found.zonesTotal : 0) * 5,
  };
  const raw = parts.time + parts.accuracy + parts.survival + parts.style + parts.thorough;
  const score = Math.min(100, Math.round(raw * CONFIG.difficulty[difficulty].scoreScale));
  const rank: Rank = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 42 ? 'C' : 'D';
  return { score, rank, accuracy, parts };
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BEST_KEY = 'neo-atlantis.best.v1';

export interface BestRun {
  time: number;
  score: number;
  rank: Rank;
}

export function loadBest(): Partial<Record<Difficulty, BestRun>> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BEST_KEY) : null;
    return raw ? (JSON.parse(raw) as Partial<Record<Difficulty, BestRun>>) : {};
  } catch {
    return {};
  }
}

/** Records a finished run; returns what improved. */
export function saveBest(difficulty: Difficulty, time: number, result: RunResult): { bestTime: boolean; bestScore: boolean } {
  const all = loadBest();
  const prev = all[difficulty];
  const bestTime = !prev || time < prev.time;
  const bestScore = !prev || result.score > prev.score;
  all[difficulty] = {
    time: bestTime ? time : prev!.time,
    score: bestScore ? result.score : prev!.score,
    rank: bestScore ? result.rank : prev!.rank,
  };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the run still shows on the results screen.
  }
  return { bestTime, bestScore };
}

/** Live counters for the current run, plus a mark for per-fight results. */
export class RunStats {
  totals: RunTotals = emptyTotals();
  private mark: RunTotals = emptyTotals();

  reset(): void {
    this.totals = emptyTotals();
    this.mark = emptyTotals();
  }

  /** Call when a fight starts; `sinceMark` then reports that fight alone. */
  markFight(): void {
    this.mark = { ...this.totals };
  }

  sinceMark(): { time: number; accuracy: number; damageTaken: number; kills: number; combos: number } {
    const t = this.totals;
    const m = this.mark;
    const shots = t.shots - m.shots;
    return {
      time: t.time - m.time,
      accuracy: shots > 0 ? (t.hits - m.hits) / shots : 0,
      damageTaken: t.damageTaken - m.damageTaken,
      kills: t.kills - m.kills,
      combos: t.combos - m.combos,
    };
  }
}
