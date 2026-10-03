/**
 * Data-driven dialogue trees. Trees live in src/strings.ts with the rest of
 * the text. tests/dialogue.test.ts validates every tree.
 */

export type SpeakerId = 'imani' | 'odette' | 'yaw' | 'croc' | 'bas' | 'nef' | 'kwame' | 'merit';

/** Flags set by dialogue and read later (see GameFlags in game/flags.ts). */
export type Flag =
  | 'intel_route'
  | 'intel_weakpoint'
  | 'promised_odette'
  | 'yaw_met'
  | 'yaw_left'
  | 'croc_spared'
  | 'croc_shutdown'
  | 'asked_sister'
  | 'heard_grandmother'
  | 'asked_bas_mari'
  | 'intel_shifts'
  | 'tuned_ka'
  | 'tuned_shield'
  | 'mari_letter'
  | 'all_logs'
  | 'met_bas'
  | 'met_nef'
  | 'met_kwame'
  | 'met_merit';

/** Events a dialogue can fire into the game. */
export type DialogueEvent =
  | 'openStripGate'
  | 'openSideRoute'
  | 'yawLeaves'
  | 'startBoss'
  | 'endLevel'
  | 'intelWeakpoint'
  | 'leviathanPass'
  | 'nefMeal'
  | 'tuneKa'
  | 'tuneShield'
  | 'giveLetter'
  | 'basAdvice';

export type Condition =
  | { flag: Flag; is?: boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface DialogueChoice {
  text: string;
  /** Node to go to, or null to end the conversation. */
  next: string | null;
  condition?: Condition;
  setFlags?: Flag[];
  events?: DialogueEvent[];
}

export interface Branch {
  condition: Condition;
  next: string | null;
}

export interface DialogueNode {
  speaker: SpeakerId;
  text: string;
  /** Either choices (2-4 visible), or `next` (string, null = end), optionally preceded by conditional branches. */
  choices?: DialogueChoice[];
  next?: string | null;
  branches?: Branch[];
  setFlags?: Flag[];
  events?: DialogueEvent[];
}

export interface DialogueTree {
  id: string;
  start: string;
  /** Who Imani is talking to, for camera framing. */
  partner: SpeakerId;
  nodes: Record<string, DialogueNode>;
}

export function evalCondition(c: Condition, flags: ReadonlySet<Flag>): boolean {
  if ('flag' in c) return flags.has(c.flag) === (c.is ?? true);
  if ('all' in c) return c.all.every((x) => evalCondition(x, flags));
  if ('any' in c) return c.any.some((x) => evalCondition(x, flags));
  return !evalCondition(c.not, flags);
}

export function conditionFlags(c: Condition, out: Set<Flag>): Set<Flag> {
  if ('flag' in c) out.add(c.flag);
  else if ('all' in c) c.all.forEach((x) => conditionFlags(x, out));
  else if ('any' in c) c.any.forEach((x) => conditionFlags(x, out));
  else conditionFlags(c.not, out);
  return out;
}
