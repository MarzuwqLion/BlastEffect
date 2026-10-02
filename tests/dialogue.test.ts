import { describe, expect, it } from 'vitest';
import { DIALOGUE } from '../src/strings';
import { validateTree } from '../src/dialogue/validate';
import type { DialogueTree } from '../src/dialogue/types';

describe('dialogue trees', () => {
  for (const [id, tree] of Object.entries(DIALOGUE)) {
    it(`${id} is valid (no dead ends, no missing nodes)`, () => {
      expect(validateTree(tree)).toEqual([]);
      expect(tree.id).toBe(id);
    });
  }

  it('at least one choice sets a flag that pays off later', () => {
    const setByChoice = new Set<string>();
    const read = new Set<string>();
    for (const tree of Object.values(DIALOGUE)) {
      for (const n of Object.values(tree.nodes)) {
        for (const c of n.choices ?? []) c.setFlags?.forEach((f) => setByChoice.add(f));
        const visit = (c: unknown): void => {
          if (c && typeof c === 'object') {
            const o = c as Record<string, unknown>;
            if (typeof o.flag === 'string') read.add(o.flag);
            Object.values(o).forEach(visit);
          }
        };
        visit(n.branches);
        n.choices?.forEach((c) => visit(c.condition));
      }
    }
    expect([...setByChoice].some((f) => read.has(f))).toBe(true);
  });
});

describe('validator catches broken trees', () => {
  const base = (): DialogueTree => ({
    id: 't',
    start: 'a',
    partner: 'odette',
    nodes: {
      a: { speaker: 'odette', text: 'hi', choices: [{ text: 'x', next: 'b' }, { text: 'y', next: null }] },
      b: { speaker: 'imani', text: 'bye', next: null },
    },
  });

  it('accepts a good tree', () => {
    expect(validateTree(base())).toEqual([]);
  });

  it('flags missing node references', () => {
    const t = base();
    t.nodes.a.choices![0].next = 'nope';
    expect(validateTree(t).join()).toMatch(/missing node "nope"/);
  });

  it('flags dead ends', () => {
    const t = base();
    delete t.nodes.b.next;
    expect(validateTree(t).join()).toMatch(/dead end/);
  });

  it('flags unreachable nodes', () => {
    const t = base();
    t.nodes.c = { speaker: 'imani', text: 'orphan', next: null };
    expect(validateTree(t).join()).toMatch(/unreachable/);
  });

  it('flags loops with no exit', () => {
    const t = base();
    t.nodes.b = { speaker: 'imani', text: 'loop', next: 'd' };
    t.nodes.d = { speaker: 'odette', text: 'loop', next: 'b' };
    expect(validateTree(t).join()).toMatch(/never reach an ending/);
  });

  it('flags choice lists that can show fewer than 2 options', () => {
    const t = base();
    t.nodes.a.choices![1].condition = { flag: 'yaw_met' };
    expect(validateTree(t).join()).toMatch(/1 visible choices/);
  });

  it('flags a missing start', () => {
    const t = base();
    t.start = 'zzz';
    expect(validateTree(t).join()).toMatch(/start node/);
  });
});
