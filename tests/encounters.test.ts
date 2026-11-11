import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { canPrime } from '../src/combat/combo';
import { defensesFor, estimateTimeToKill } from '../src/combat/damage';
import { basin } from '../src/level/sections/basin';
import { club } from '../src/level/sections/club';
import { dock } from '../src/level/sections/dock';
import { strip } from '../src/level/sections/strip';
import { terrace } from '../src/level/sections/terrace';
import { emptyTotals, formatTime, scoreRun } from '../src/game/RunStats';
import { BARKS, ENEMY_NAMES, PROMPTS } from '../src/strings';

const SECTIONS = [dock, strip, club, terrace, basin];
const ENCOUNTERS = SECTIONS.flatMap((s) => s.encounters);
const { jackal, ibis, grunt } = CONFIG.enemies;
const { smg, rifle } = CONFIG.weapons;

describe('enemy roster', () => {
  it('every spawn uses a configured, named enemy type', () => {
    const kinds = new Set(ENCOUNTERS.flatMap((e) => e.waves.flatMap((w) => w.spawns.map((s) => s.kind))));
    for (const k of kinds) {
      expect(CONFIG.enemies[k], k).toBeDefined();
      expect(ENEMY_NAMES[k], k).toBeTruthy();
    }
    for (const k of CONFIG.boss.reinforcements.flat()) expect(CONFIG.enemies[k], k).toBeDefined();
    // All five types appear somewhere on the route.
    expect([...kinds].sort()).toEqual(['grunt', 'heavy', 'ibis', 'jackal', 'trooper']);
  });

  it('the Jackal is a combo target: no shield or armour, fast, dead in under 1.5 s of SMG fire', () => {
    expect(canPrime(defensesFor(jackal))).toBe(true);
    expect(jackal.runSpeed).toBeGreaterThan(CONFIG.player.sprintSpeed * 0.75);
    expect(estimateTimeToKill(jackal, smg)).toBeLessThan(1.5);
  });

  it("the Jackal's lunge can be dodged: the lock leaves time for a dash, and one hit never kills", () => {
    const S = CONFIG.jackalSlash;
    expect(S.lockBefore).toBeGreaterThanOrEqual(0.2);
    expect(S.windup).toBeGreaterThan(S.lockBefore);
    // A dash clears the lunge's width.
    expect(CONFIG.player.dashDistance).toBeGreaterThan(S.hitRadius * 2);
    expect(S.damage * CONFIG.difficulty.veteran.damageTaken).toBeLessThan(CONFIG.player.shieldMax);
  });

  it('the Ibis hits hard, slowly, and dies to two rifle body shots', () => {
    expect(ibis.weapon.boltDamage).toBeGreaterThan(grunt.weapon.boltDamage * 2);
    expect(ibis.weapon.telegraph).toBeGreaterThan(1.2);
    expect(CONFIG.ibisLock).toBeLessThan(ibis.weapon.telegraph / 3);
    expect(Math.ceil((ibis.health + ibis.armor + ibis.shield) / rifle.damage)).toBeLessThanOrEqual(2);
    // Never a one-shot kill from full, even on the hardest setting.
    expect(ibis.weapon.boltDamage * CONFIG.difficulty.veteran.damageTaken).toBeLessThan(CONFIG.player.shieldMax);
  });
});

describe('staged encounters', () => {
  it('posted crews face a direction and never depend on intel flags', () => {
    const staged = ENCOUNTERS.filter((e) => e.staged);
    expect(staged.map((e) => e.id).sort()).toEqual(['club', 'stripA', 'terrace']);
    for (const e of staged) {
      const w = e.waves[0];
      expect(w.fewerWith, e.id).toBeUndefined();
      for (const s of w.spawns) {
        expect(s.yaw, `${e.id} ${s.kind}`).toBeTypeOf('number');
        expect(s.delay ?? 0, `${e.id} ${s.kind}`).toBe(0);
      }
    }
  });

  it('the first fight is grunts only; new types come with a hint', () => {
    const a = strip.encounters[0];
    expect(a.waves.flatMap((w) => w.spawns).every((s) => s.kind === 'grunt')).toBe(true);
    const firstWith = (kind: string) => ENCOUNTERS.find((e) => e.waves.some((w) => w.spawns.some((s) => s.kind === kind)))!;
    expect(firstWith('jackal').waves.some((w) => w.hint === 'jackal')).toBe(true);
    expect(PROMPTS.jackal && PROMPTS.ibis && PROMPTS.ambush).toBeTruthy();
    expect(BARKS.idle.length).toBeGreaterThan(2);
  });

  it('noticing is slower at range than up close, and an ambush pays double', () => {
    const N = CONFIG.notice;
    expect(N.timeFar).toBeGreaterThan(N.timeNear);
    expect(N.reactMax).toBeLessThan(1.5);
    expect(CONFIG.rewards.ambushDamage).toBe(2);
  });
});

describe('difficulty and scoring', () => {
  it('three levels, ordered', () => {
    const { story, standard, veteran } = CONFIG.difficulty;
    expect(story.damageTaken).toBeLessThan(standard.damageTaken);
    expect(standard.damageTaken).toBeLessThan(veteran.damageTaken);
    expect(story.tokens).toBeLessThanOrEqual(standard.tokens);
    expect(standard.tokens).toBeLessThanOrEqual(veteran.tokens);
    expect(veteran.telegraph).toBeLessThan(story.telegraph);
  });

  it('the opening sections go easier; the last two run at full strength', () => {
    expect(strip.ease!.damage).toBeLessThan(club.ease!.damage);
    expect(club.ease!.damage).toBeLessThan(1);
    expect(terrace.ease).toBeUndefined();
    expect(basin.ease).toBeUndefined();
    // Even on Story someone is still shooting in the first fight.
    expect(CONFIG.difficulty.story.tokens - strip.ease!.tokens).toBeGreaterThanOrEqual(1);
    // The first fight on Standard is no harsher than the game was before difficulty levels (1.0).
    expect(CONFIG.difficulty.standard.damageTaken * strip.ease!.damage).toBeLessThanOrEqual(1);
  });

  it('a fast, clean, thorough run earns S; a slow, messy one does not', () => {
    const found = { logs: 5, logsTotal: 5, zones: 3, zonesTotal: 3 };
    const great = scoreRun({ ...emptyTotals(), time: 560, shots: 600, hits: 430, headshots: 18, kills: 34, combos: 14, ambushes: 3, deaths: 0 }, found, 'standard');
    expect(great.rank).toBe('S');
    expect(great.score).toBeLessThanOrEqual(100);
    const rough = scoreRun({ ...emptyTotals(), time: 1700, shots: 2000, hits: 500, headshots: 1, kills: 34, combos: 1, deaths: 6 }, { logs: 0, logsTotal: 5, zones: 0, zonesTotal: 3 }, 'standard');
    expect(rough.rank).toBe('D');
    expect(great.score).toBeGreaterThan(rough.score);
    // A typical first clear: 20 minutes, two deaths, 40% accuracy, some of the side content.
    const first = scoreRun({ ...emptyTotals(), time: 1200, shots: 1500, hits: 600, headshots: 5, kills: 34, combos: 6, ambushes: 1, deaths: 2 }, { logs: 2, logsTotal: 5, zones: 1, zonesTotal: 3 }, 'standard');
    expect(first.rank).toBe('C');
    // The same hands on a second run: faster, cleaner, and they went looking.
    const second = scoreRun({ ...emptyTotals(), time: 780, shots: 1100, hits: 580, headshots: 9, kills: 34, combos: 10, ambushes: 2, deaths: 1 }, { logs: 4, logsTotal: 5, zones: 3, zonesTotal: 3 }, 'standard');
    expect(['A', 'S']).toContain(second.rank);
  });

  it('the same run scores higher on a harder setting', () => {
    const t = { ...emptyTotals(), time: 800, shots: 900, hits: 450, headshots: 6, kills: 34, combos: 6, deaths: 1 };
    const found = { logs: 2, logsTotal: 5, zones: 1, zonesTotal: 3 };
    expect(scoreRun(t, found, 'veteran').score).toBeGreaterThan(scoreRun(t, found, 'standard').score);
    expect(scoreRun(t, found, 'standard').score).toBeGreaterThan(scoreRun(t, found, 'story').score);
  });

  it('formats times as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.4)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });
});
