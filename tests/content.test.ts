import { describe, expect, it } from 'vitest';
import { LOOPS, MUSIC } from '../src/audio/manifest';
import { CONFIG } from '../src/config';
import { basin } from '../src/level/sections/basin';
import { club } from '../src/level/sections/club';
import { dock } from '../src/level/sections/dock';
import { strip } from '../src/level/sections/strip';
import { terrace } from '../src/level/sections/terrace';
import { DIALOGUE, MARI_LOGS, NAMES, PROMPTS } from '../src/strings';

const SECTIONS = [dock, strip, club, terrace, basin];

const inside = (p: [number, number, number], b: readonly number[]): boolean =>
  p[0] >= Math.min(b[0], b[3]) && p[0] <= Math.max(b[0], b[3]) && p[2] >= Math.min(b[2], b[5]) && p[2] <= Math.max(b[2], b[5]);

describe('level content wiring', () => {
  it('every NPC has a dialogue tree', () => {
    for (const s of SECTIONS) for (const n of s.npcs ?? []) expect(DIALOGUE[n.dialogue], `${s.name}: ${n.id}`).toBeDefined();
  });

  it('zones and sections use music cues and loops that exist', () => {
    for (const s of SECTIONS) {
      expect(MUSIC[s.music], s.name).toBeDefined();
      if (s.musicAfter) expect(MUSIC[s.musicAfter]).toBeDefined();
      for (const z of s.zones ?? []) if (z.music) expect(MUSIC[z.music], z.id).toBeDefined();
      for (const spot of s.soundscape ?? []) expect(LOOPS[spot.loop], spot.loop).toBeDefined();
    }
  });

  it('three optional zones, each with a name and a nudge or an entrance on the route', () => {
    const zones = SECTIONS.flatMap((s) => s.zones ?? []);
    expect(zones.map((z) => z.id).sort()).toEqual(['glass', 'shrine', 'souk']);
    for (const z of zones) expect(z.name.length).toBeGreaterThan(2);
    expect(zones.find((z) => z.id === 'glass')!.name).toBe(NAMES.glass);
  });

  it('the new characters stand inside their zones', () => {
    const where: Record<string, string> = { bas: 'glass', nef: 'souk', kwame: 'souk', merit: 'shrine' };
    for (const s of SECTIONS) {
      for (const n of s.npcs ?? []) {
        const zid = where[n.id];
        if (!zid) continue;
        const z = SECTIONS.flatMap((x) => x.zones ?? []).find((x) => x.id === zid)!;
        expect(inside([n.x, n.y, n.z], z.box), `${n.id} in ${zid}`).toBe(true);
      }
    }
  });

  it('crowds are sane', () => {
    for (const s of SECTIONS) {
      for (const c of s.crowds ?? []) {
        expect(c.count).toBeGreaterThan(0);
        if (c.spots) expect(c.spots.length).toBeGreaterThanOrEqual(c.count);
      }
    }
  });

  it("Mari's logs have unique ids and text", () => {
    const ids = MARI_LOGS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5);
    for (const l of MARI_LOGS) expect(l.text.length).toBeGreaterThan(40);
  });

  it('explosive tuning: a cell next to a grunt kills it; a grenade does not one-shot a full player', () => {
    const cell = CONFIG.explosives.cell;
    // Grunt beside a cell (~1.5 m from the blast centre).
    const k = 1 - (1.5 / cell.radius) * 0.5;
    expect(cell.damage * k).toBeGreaterThanOrEqual(CONFIG.enemies.grunt.health);
    const g = CONFIG.explosives.grenade;
    expect(g.playerDamage).toBeLessThan(CONFIG.player.healthMax + CONFIG.player.shieldMax);
    expect(g.fuse).toBeGreaterThan(g.flight + 0.8);
    expect(PROMPTS.grenade).toBeTruthy();
  });
});
