/**
 * Contradiction candidates. MindStash can't tell if two notes disagree; it only finds pairs
 * worth asking about: text that loads in the same session, talks about the same thing
 * (shared uncommon words in one sentence each), and shows a conflict signal. The user's
 * own agent then judges each pair (`mindstash check` / `mindstash judge`).
 */
import type { Finding, Item, Project } from './types.js';
import type { Pair, PairSide, State } from './state.js';
import { findingId, type Rule } from './rules/context.js';
import { words } from './minhash.js';
import { clip, sentences, shortHash } from './text.js';

export const MAX_PAIRS = 25;

/** Sentences that tell the agent what to do. Log lines ("shipped X on …") can't contradict a rule. */
const DIRECTIVE = /\b(always|never|don'?t|do not|must|should|shouldn'?t|prefer|avoid|make sure|instead of)\b/i;

const NEG_TOKENS = new Set(['never', "don't", 'dont', 'not', 'no', 'avoid', 'stop', 'without', 'instead', 'disable', 'disabled', "shouldn't", "doesn't", "won't"]);

/** Tools whose versions are worth comparing. Anything else with a number is an identifier ("table 13"). */
const TOOLS =
  'node|nodejs|python|ruby|go|golang|java|jdk|dotnet|net|php|rust|deno|bun|postgres|postgresql|mysql|redis|valkey|mongodb|react|next|nextjs|vue|nuxt|angular|svelte|expo|typescript|ts|vite|webpack|tailwind|django|rails|laravel|spring|ubuntu|debian|alpine|kubernetes|k8s|terraform|ef|efcore|xunit|jest|vitest|pnpm|npm|yarn|gradle|kotlin|swift|xcode|android|ios|sdk|api|claude|opus|sonnet|gpt';
const VERSION_RE = new RegExp(String.raw`\b(${TOOLS})[\s@v-]*(\d+(?:\.\d+){0,2})\b`, 'g');

function versions(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.toLowerCase().matchAll(VERSION_RE)) out.set(m[1]!, m[2]!);
  return out;
}

/** Words that come right after a negation ("never use --force" → use, force). */
function negatedTerms(s: string): Set<string> {
  const toks = s.toLowerCase().match(/[a-z0-9'][a-z0-9'-]*/g) ?? [];
  const out = new Set<string>();
  toks.forEach((t, i) => {
    if (!NEG_TOKENS.has(t)) return;
    for (const w of toks.slice(i + 1, i + 5)) out.add(w);
  });
  return out;
}

interface Sent {
  text: string;
  terms: Set<string>;
  negated: Set<string>;
  versions: Map<string, string>;
}

interface Doc {
  item: Item;
  sents: Sent[];
  terms: Set<string>;
}

function cueFor(a: Sent, b: Sent, shared: string[]): string | undefined {
  for (const [name, v] of a.versions) {
    const w = b.versions.get(name);
    if (w && w !== v) return `${name} ${v} vs ${name} ${w}`;
  }
  // A shared word is negated on one side only: "never X" vs "X".
  for (const t of shared) {
    if (t.length >= 4 && a.negated.has(t) !== b.negated.has(t)) return `"${t}": one says not to, the other says to`;
  }
  return undefined;
}

/** Group key: items that load in the same session can contradict each other. */
function sessionsFor(item: Item, projects: Project[]): string[] {
  if (item.kind === 'memory') return [`${item.agent}:${item.projectKey ?? 'global'}`];
  // Instruction files load in every project at or below their folder (or everywhere if global).
  return projects
    .filter((p) => p.agent === item.agent && p.exists)
    .filter((p) =>
      p.instructionChain
        ? p.instructionChain.includes(item.path) || item.scope.kind === 'global'
        : item.scope.kind === 'global' || (item.scope.dir !== undefined && (p.path === item.scope.dir || p.path.startsWith(item.scope.dir + '/'))),
    )
    .map((p) => `${item.agent}:${p.key}`);
}

export function candidates(items: Item[], projects: Project[], limit = MAX_PAIRS): { pairs: Pair[]; total: number } {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const pool = items.filter(
    (i) =>
      (i.kind === 'memory' || i.kind === 'instructions') &&
      !(i.projectKey && byKey.get(i.projectKey)?.exists === false),
  );

  // Words in more than 1 of 5 notes are project vocabulary, not a topic.
  const df = new Map<string, number>();
  const bags = new Map<string, Set<string>>();
  for (const i of pool) {
    const bag = new Set(words(i.body).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
    bags.set(i.id, bag);
    for (const w of bag) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const common = Math.max(3, Math.ceil(pool.length * 0.2));
  const distinctive = (w: string) => (df.get(w) ?? 0) <= common;

  const docs = new Map<string, Doc>();
  const docOf = (i: Item): Doc => {
    let d = docs.get(i.id);
    if (!d) {
      const sents = sentences(i.body)
        .filter((t) => t.length > 15 && t.length < 240 && DIRECTIVE.test(t))
        .map((t) => ({
          text: t,
          terms: new Set(words(t).filter((w) => w.length > 2 && !/^\d+$/.test(w) && distinctive(w))),
          negated: negatedTerms(t),
          versions: versions(t),
        }))
        .filter((s) => s.terms.size >= 2);
      d = { item: i, sents, terms: new Set([...(bags.get(i.id) ?? [])].filter(distinctive)) };
      docs.set(i.id, d);
    }
    return d;
  };

  const groups = new Map<string, Item[]>();
  const globalMem = new Map<string, Item[]>(); // agent → global memories (load everywhere)
  for (const i of pool) {
    for (const g of sessionsFor(i, projects)) groups.set(g, [...(groups.get(g) ?? []), i]);
    if (i.kind === 'memory' && !i.projectKey) globalMem.set(i.agent, [...(globalMem.get(i.agent) ?? []), i]);
  }
  for (const [g, list] of groups) {
    const agent = g.split(':')[0]!;
    for (const m of globalMem.get(agent) ?? []) if (!list.includes(m)) list.push(m);
  }

  const found = new Map<string, Pair>();
  for (const list of groups.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const A = docOf(list[x]!);
        const B = docOf(list[y]!);
        if (A.item.kind === 'instructions' && B.item.kind === 'instructions') continue; // both read-only
        let shared = 0;
        for (const t of A.terms) if (B.terms.has(t)) shared++;
        if (shared < 3) continue;

        let best: { a: Sent; b: Sent; shared: string[]; cue: string } | undefined;
        for (const sa of A.sents) {
          for (const sb of B.sents) {
            const common = [...sa.terms].filter((t) => sb.terms.has(t));
            if (common.length < 3) continue;
            const cue = cueFor(sa, sb, common);
            if (cue && (!best || common.length > best.shared.length)) best = { a: sa, b: sb, shared: common, cue };
          }
        }
        if (!best) continue;
        const [first, second] = A.item.id < B.item.id ? [A, B] : [B, A];
        const [fs, ss] = first === A ? [best.a, best.b] : [best.b, best.a];
        const id = shortHash('pair\0' + first.item.id + '\0' + second.item.id);
        if (found.has(id)) continue;
        found.set(id, {
          id,
          a: side(first.item, fs.text),
          b: side(second.item, ss.text),
          shared: best.shared.slice(0, 6),
          cue: best.cue,
          score: best.shared.length + shared / 10,
        });
      }
    }
  }
  const all = [...found.values()].sort((p, q) => q.score - p.score);
  return { pairs: all.slice(0, limit), total: all.length };
}

function side(i: Item, snippet: string): PairSide {
  return {
    itemId: i.id,
    agent: i.agent,
    kind: i.kind,
    name: i.name,
    scope: i.scope.label,
    path: i.path,
    hash: i.hash,
    snippet: clip(snippet, 300),
  };
}

/** A verdict still applies only if neither file changed since the agent read it. */
export function verdictValid(state: State, pairId: string, items: Map<string, Item>): boolean {
  const v = state.verdicts[pairId];
  if (!v) return false;
  const a = items.get(v.pair.a.itemId);
  const b = items.get(v.pair.b.itemId);
  return Boolean(a && b && a.hash === v.hashes[0] && b.hash === v.hashes[1]);
}

/** Pairs nobody has judged yet (or whose files changed since). */
export function pending(state: State, items: Item[], projects: Project[]): { pairs: Pair[]; total: number } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const { pairs } = candidates(items, projects, Infinity);
  const open = pairs.filter((p) => !verdictValid(state, p.id, byId));
  return { pairs: open.slice(0, MAX_PAIRS), total: open.length };
}

/** Pairs the agent judged as conflicting or duplicate become findings. */
export const judged: Rule = ({ items, state }) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Finding[] = [];
  for (const [pairId, v] of Object.entries(state.verdicts)) {
    if (v.verdict === 'ok' || !verdictValid(state, pairId, byId)) continue;
    const a = byId.get(v.pair.a.itemId)!;
    const b = byId.get(v.pair.b.itemId)!;
    const conflict = v.verdict === 'conflict';
    out.push({
      id: findingId(conflict ? 'contradiction' : 'duplicate-checked', [a.id, b.id]),
      rule: conflict ? 'contradiction' : 'duplicate-checked',
      category: conflict ? 'contradiction' : 'similar',
      confidence: 'medium',
      title: `${a.name} ↔ ${b.name}: ${conflict ? 'disagree' : 'say the same thing'}`,
      reasons: [
        v.reason,
        `Checked by your agent on ${v.at.slice(0, 10)}. ${conflict ? 'The agent may follow either one.' : 'Both load in the same session.'}`,
        `MindStash won't edit them; open both and keep the one you want.`,
      ],
      itemIds: [a.id, b.id],
      tokens: Math.min(a.loadTokens, b.loadTokens),
      fixes: ['ignore'],
    });
  }
  return out;
};
