import type { Finding, Item } from '../types.js';
import { comparable, signature, similarity } from '../minhash.js';
import { findingId, sumLoad, type Rule } from './context.js';

export const MEMORY_SIMILAR = 0.45;
export const SKILL_OVERLAP = 0.5;
export const RELEARNED = 0.5;

function textOf(i: Item): string {
  return i.kind === 'skill' ? `${i.name.replace(/[-_:]/g, ' ')} ${i.description ?? ''}` : `${i.description ?? ''}\n${i.body}`;
}

function pairs(items: Item[], threshold: number): { a: Item; b: Item; score: number }[] {
  const sigs = items.filter((i) => comparable(textOf(i))).map((i) => ({ i, sig: signature(textOf(i)) }));
  const out: { a: Item; b: Item; score: number }[] = [];
  for (let x = 0; x < sigs.length; x++) {
    for (let y = x + 1; y < sigs.length; y++) {
      const score = similarity(sigs[x]!.sig, sigs[y]!.sig);
      if (score >= threshold) out.push({ a: sigs[x]!.i, b: sigs[y]!.i, score });
    }
  }
  return out.sort((p, q) => q.score - p.score);
}

/** Memories that look like they say the same thing. Suggest-only: never merged automatically. */
export const similarMemories: Rule = ({ items, projectOf }) => {
  // Memories of a vanished project are already flagged; comparing them only adds noise.
  const mems = items.filter((i) => i.kind === 'memory' && projectOf(i)?.exists !== false);
  return pairs(mems, MEMORY_SIMILAR).map(({ a, b, score }) => {
    const pct = Math.round(score * 100);
    const sameScope = a.scope.label === b.scope.label;
    return {
      id: findingId('similar', [a.path, b.path]),
      rule: 'similar',
      category: 'similar',
      confidence: 'medium',
      title: `${a.name} ↔ ${b.name} · ${pct}% match`,
      reasons: [
        `These two memories share ${pct}% of their wording and may say the same thing.`,
        sameScope ? `Both load in ${a.scope.label}.` : `One is in ${a.scope.label}, the other in ${b.scope.label}.`,
        `MindStash won't merge them; open both and keep the one you want.`,
      ],
      itemIds: [a.id, b.id],
      tokens: Math.min(a.loadTokens, b.loadTokens),
      fixes: ['ignore'],
    } satisfies Finding;
  });
};

/** Skills installed twice, or whose descriptions would trigger on the same requests. */
export const skillOverlap: Rule = ({ items }) => {
  const skills = items.filter((i) => i.kind === 'skill');
  const out: Finding[] = [];
  const bare = (s: Item) => s.name.split(':').pop()!.toLowerCase();

  const byName = new Map<string, Item[]>();
  for (const s of skills) byName.set(bare(s), [...(byName.get(bare(s)) ?? []), s]);
  for (const [name, group] of byName) {
    // Project skills in different repos never load together; only global copies,
    // or a global copy plus a project copy, compete in the same session.
    if (group.length < 2 || !group.some((s) => s.scope.kind === 'global')) continue;
    out.push({
      id: findingId('skill-duplicate', group.map((s) => s.path)),
      rule: 'skill-duplicate',
      category: 'similar',
      confidence: 'high',
      title: `skill "${name}" is installed ${group.length} times`,
      reasons: [
        `Found in: ${group.map((s) => s.source ?? s.scope.label).join(', ')}.`,
        `Each copy adds its description to every session (~${sumLoad(group.slice(1))} extra tokens).`,
      ],
      itemIds: group.map((s) => s.id),
      tokens: sumLoad(group.slice(1)),
      fixes: ['ignore'],
    });
  }

  for (const { a, b, score } of pairs(skills, SKILL_OVERLAP)) {
    if (bare(a) === bare(b)) continue;
    if (a.scope.kind === 'project' && b.scope.kind === 'project' && a.scope.dir !== b.scope.dir) continue;
    // Skills from the same plugin are designed as a set; overlap there is expected.
    if (a.source && a.source === b.source && a.source.startsWith('plugin:')) continue;
    const pct = Math.round(score * 100);
    out.push({
      id: findingId('skill-overlap', [a.path, b.path]),
      rule: 'skill-overlap',
      category: 'similar',
      confidence: 'medium',
      title: `skills ${a.name} ↔ ${b.name} may trigger on the same requests`,
      reasons: [
        `Their descriptions share ${pct}% of their wording, so the agent may pick either one.`,
        `Sources: ${a.source ?? a.scope.label} and ${b.source ?? b.scope.label}.`,
      ],
      itemIds: [a.id, b.id],
      tokens: Math.min(a.loadTokens, b.loadTokens),
      fixes: ['ignore'],
    });
  }
  return out;
};

/** A memory the user deleted that the agent saved again. */
export const relearned: Rule = ({ items, state }) => {
  if (state.deleted.length === 0) return [];
  const out: Finding[] = [];
  for (const m of items) {
    if (m.kind !== 'memory' || !comparable(textOf(m))) continue;
    const sig = signature(textOf(m));
    let best: { d: (typeof state.deleted)[number]; score: number } | undefined;
    for (const d of state.deleted) {
      if (m.modified.getTime() <= new Date(d.at).getTime()) continue;
      const score = similarity(sig, d.sig);
      if (score >= RELEARNED && (!best || score > best.score)) best = { d, score };
    }
    if (!best) continue;
    out.push({
      id: findingId('relearned', [m.path, best.d.at]),
      rule: 'relearned',
      category: 'relearned',
      confidence: 'medium',
      title: `looks like "${best.d.name}", which you deleted`,
      reasons: [
        `You deleted "${best.d.name}" (${best.d.scope}) on ${best.d.at.slice(0, 10)}.`,
        `This memory was saved after that and is ${Math.round(best.score * 100)}% similar.`,
        `If the agent keeps re-learning it, the source may be a CLAUDE.md or repeated instructions.`,
      ],
      itemIds: [m.id],
      tokens: m.loadTokens,
      fixes: ['delete', 'archive', 'ignore'],
    });
  }
  return out;
};
