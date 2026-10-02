import { SPEAKERS } from '../strings';
import { conditionFlags, evalCondition, type DialogueTree, type Flag } from './types';

/**
 * Checks a tree for structural problems. Returns a list of human-readable
 * errors (empty when the tree is valid):
 *  - start and every referenced node exist
 *  - every node ends, continues, or offers choices (no dead ends)
 *  - every choice list shows 2-4 options under every combination of the
 *    flags its conditions read
 *  - every node is reachable, and every node can reach an ending
 */
export function validateTree(tree: DialogueTree): string[] {
  const errors: string[] = [];
  const nodes = tree.nodes;
  const ids = Object.keys(nodes);
  const ref = (from: string, to: string | null | undefined, what: string): void => {
    if (to === null || to === undefined) return;
    if (!(to in nodes)) errors.push(`${tree.id}.${from}: ${what} points to missing node "${to}"`);
  };
  if (!(tree.start in nodes)) errors.push(`${tree.id}: start node "${tree.start}" is missing`);
  if (!(tree.partner in SPEAKERS)) errors.push(`${tree.id}: unknown partner "${tree.partner}"`);

  const edges = new Map<string, (string | null)[]>();
  for (const id of ids) {
    const n = nodes[id];
    const out: (string | null)[] = [];
    if (!(n.speaker in SPEAKERS)) errors.push(`${tree.id}.${id}: unknown speaker "${n.speaker}"`);
    if (!n.text || !n.text.trim()) errors.push(`${tree.id}.${id}: empty text`);
    const hasChoices = Array.isArray(n.choices) && n.choices.length > 0;
    const hasNext = n.next !== undefined;
    if (hasChoices && hasNext) errors.push(`${tree.id}.${id}: has both choices and next`);
    if (!hasChoices && !hasNext) errors.push(`${tree.id}.${id}: dead end (no choices and no next)`);
    if (n.branches && !hasNext) errors.push(`${tree.id}.${id}: branches need a fallback next`);
    for (const b of n.branches ?? []) {
      ref(id, b.next, 'branch');
      out.push(b.next);
    }
    if (hasNext) {
      ref(id, n.next, 'next');
      out.push(n.next ?? null);
    }
    if (hasChoices) {
      const choices = n.choices!;
      choices.forEach((c, i) => {
        if (!c.text.trim()) errors.push(`${tree.id}.${id}: choice ${i + 1} has no text`);
        ref(id, c.next, `choice ${i + 1}`);
        out.push(c.next);
      });
      // Visible count under every combination of the flags involved.
      const flags = new Set<Flag>();
      for (const c of choices) if (c.condition) conditionFlags(c.condition, flags);
      const list = [...flags];
      for (let mask = 0; mask < 1 << list.length; mask++) {
        const set = new Set<Flag>(list.filter((_, b) => mask & (1 << b)));
        const visible = choices.filter((c) => !c.condition || evalCondition(c.condition, set)).length;
        if (visible < 2 || visible > 4) {
          errors.push(`${tree.id}.${id}: ${visible} visible choices with flags {${[...set].join(', ')}} (need 2-4)`);
        }
      }
    }
    edges.set(id, out);
  }

  // Reachability from start.
  const seen = new Set<string>();
  const stack = tree.start in nodes ? [tree.start] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const to of edges.get(id) ?? []) if (to && to in nodes) stack.push(to);
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`${tree.id}.${id}: unreachable from start`);

  // Every node can reach an ending (null).
  const canEnd = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (canEnd.has(id)) continue;
      if ((edges.get(id) ?? []).some((to) => to === null || canEnd.has(to))) {
        canEnd.add(id);
        changed = true;
      }
    }
  }
  for (const id of ids) if (!canEnd.has(id)) errors.push(`${tree.id}.${id}: can never reach an ending (loop)`);
  return errors;
}
