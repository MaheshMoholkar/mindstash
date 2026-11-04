import { agentName } from '../adapters/index.js';
import { CATEGORIES, itemsOf, subject } from '../cli/format.js';
import type { Archived, Pair } from '../core/state.js';
import type { Category, Finding, Item, ScanResult } from '../core/types.js';
import { CATEGORY_COLOR } from './theme.js';
import { plural } from '../core/text.js';

/** Sidebar entries. Headers are labels; everything else can be selected. */
export type Entry =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'category'; key: string; id: Category | 'all'; label: string; count: number; color: string }
  | { kind: 'scope'; key: string; group: Group }
  | { kind: 'view'; key: string; id: 'cost' | 'checks' | 'browse' | 'archived'; label: string; badge?: number }
  | { kind: 'gap'; key: string };

export interface Group {
  key: string;
  label: string;
  agent: string;
  items: Item[];
  memories: number;
  skills: number;
  tokens: number;
  gone: boolean;
}

/** Rows of the main list. One shape for findings, items and contradiction pairs. */
export interface Row {
  key: string;
  primary: string;
  secondary: string;
  tag: string;
  color: string;
  finding?: Finding;
  item?: Item;
  pair?: Pair;
  group?: Group;
  archived?: Archived;
  /** memory, skill, instructions, index, scope, pair: picks the row's icon. */
  kind?: string;
}

export const RULE_LABEL: Record<string, string> = {
  'missing-project': 'project gone',
  'missing-path': 'missing file',
  'past-event': 'past date',
  'wrong-scope': 'wrong scope',
  similar: 'look similar',
  'skill-duplicate': 'duplicate skill',
  'skill-overlap': 'skill overlap',
  relearned: 're-learned',
  'too-long': 'too long',
  'broken-link': 'broken link',
  unindexed: 'not in index',
  contradiction: 'contradiction',
  'duplicate-checked': 'duplicate',
  'agents-too-long': 'AGENTS.md too long',
  'missing-skill': 'missing skill',
  'version-mismatch': 'version mismatch',
  'broad-instructions': 'loads everywhere',
  'codex-skill-budget': 'skills budget',
  'instructions-too-big': 'too big',
};

export function groupsOf(r: ScanResult): Group[] {
  const sum = (xs: Item[]) => xs.reduce((n, i) => n + i.loadTokens, 0);
  const groups: Group[] = [];
  const multi = r.agents.filter((a) => a.found).length > 1;
  for (const agent of r.agents.filter((a) => a.found)) {
    const global = r.items.filter((i) => i.agent === agent.id && i.scope.kind === 'global');
    groups.push({
      key: `global:${agent.id}`,
      label: multi ? `global · ${agentName(agent.id)}` : 'global',
      agent: agent.id,
      items: [...global].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
      memories: global.filter((i) => i.kind === 'memory').length,
      skills: global.filter((i) => i.kind === 'skill').length,
      tokens: sum(global),
      gone: false,
    });
  }
  for (const p of [...r.projects].sort((a, b) => a.path.localeCompare(b.path) || a.agent.localeCompare(b.agent))) {
    const items = r.items.filter(
      (i) =>
        i.agent === p.agent &&
        (i.projectKey === p.key || (i.kind === 'skill' && i.scope.kind === 'project' && i.scope.dir === p.path)),
    );
    const mems = items.filter((i) => i.kind === 'memory');
    if (!mems.length && !items.some((i) => i.kind === 'skill')) continue;
    const label = items[0]?.scope.label ?? p.path;
    groups.push({
      key: p.key,
      label: multi && p.agent !== 'claude-code' ? `${label} · ${agentName(p.agent)}` : label,
      agent: p.agent,
      items: items.filter((i) => i.kind !== 'index').sort((a, b) => a.name.localeCompare(b.name)),
      memories: mems.length,
      skills: items.filter((i) => i.kind === 'skill').length,
      tokens: sum(items),
      gone: !p.exists,
    });
  }
  return groups;
}

export function sidebarEntries(r: ScanResult, pairs: Pair[], archived: Archived[] = []): Entry[] {
  const out: Entry[] = [{ kind: 'header', key: 'h:findings', label: 'FINDINGS' }];
  out.push({ kind: 'category', key: 'cat:all', id: 'all', label: 'All', count: r.findings.length, color: CATEGORY_COLOR.all! });
  for (const c of CATEGORIES) {
    const count = r.findings.filter((f) => f.category === c.id).length;
    if (count) out.push({ kind: 'category', key: `cat:${c.id}`, id: c.id, label: c.label, count, color: CATEGORY_COLOR[c.id]! });
  }
  out.push({ kind: 'gap', key: 'g:1' }, { kind: 'header', key: 'h:views', label: 'VIEWS' });
  out.push({ kind: 'view', key: 'view:browse', id: 'browse', label: 'Browse all', badge: groupsOf(r).length });
  out.push({ kind: 'view', key: 'view:checks', id: 'checks', label: 'Checks', badge: pairs.length || undefined });
  out.push({ kind: 'view', key: 'view:archived', id: 'archived', label: 'Archived', badge: archived.length || undefined });
  out.push({ kind: 'view', key: 'view:cost', id: 'cost', label: 'Token cost' });
  return out;
}

/** Scope entries are opened from Browse, not listed in the sidebar. */
export function scopeEntries(r: ScanResult): Entry[] {
  return groupsOf(r).map((g) => ({ kind: 'scope', key: `scope:${g.key}`, group: g }));
}

export const selectable = (e: Entry) => e.kind !== 'header' && e.kind !== 'gap';

function flagMap(r: ScanResult): Map<string, Finding> {
  const m = new Map<string, Finding>();
  for (const f of r.findings) for (const id of f.itemIds) if (!m.has(id)) m.set(id, f);
  return m;
}

export function rowsFor(entry: Entry | undefined, r: ScanResult, pairs: Pair[], query: string, archived: Archived[] = []): Row[] {
  if (!entry) return [];
  const q = query.toLowerCase();
  const match = (...parts: (string | undefined)[]) => !q || parts.join(' ').toLowerCase().includes(q);
  if (entry.kind === 'category') {
    const byId = new Map(r.items.map((i) => [i.id, i]));
    const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
    return r.findings
      .filter((f) => entry.id === 'all' || f.category === entry.id)
      // Group by category (stable), so the All view reads as sections.
      .map((f, i) => ({ f, i }))
      .sort((a, b) => (order.get(a.f.category) ?? 0) - (order.get(b.f.category) ?? 0) || a.i - b.i)
      .map(({ f }): Row => {
        const { name, scope } = subject(f, r);
        const first = byId.get(f.itemIds[0] ?? '');
        return {
          kind: f.itemIds.length === 2 && ['similar', 'contradiction', 'duplicate-checked', 'skill-overlap'].includes(f.rule) ? 'pair' : first?.kind,
          key: f.id,
          primary: name || f.title,
          secondary: scope,
          tag: RULE_LABEL[f.rule] ?? f.rule,
          color: CATEGORY_COLOR[f.category] ?? '',
          finding: f,
        };
      })
      .filter((row) => match(row.primary, row.secondary, row.tag, row.finding?.title));
  }
  if (entry.kind === 'scope') {
    const flags = flagMap(r);
    return entry.group.items
      .map((it): Row => {
        const f = flags.get(it.id);
        return {
          kind: it.kind,
          key: it.id,
          primary: it.name,
          secondary: it.kind === 'memory' ? '' : it.kind,
          tag: f ? RULE_LABEL[f.rule] ?? f.rule : '✓',
          color: f ? CATEGORY_COLOR[f.category] ?? '' : '',
          finding: f,
          item: it,
        };
      })
      .filter((row) => match(row.primary, row.secondary, row.tag, row.item?.description));
  }
  if (entry.kind === 'view' && entry.id === 'browse') {
    return groupsOf(r)
      .map((g): Row => ({
        kind: 'scope',
        key: `scope:${g.key}`,
        primary: g.label,
        secondary: [g.memories && plural(g.memories, 'memory', 'memories'), g.skills && plural(g.skills, 'skill')].filter(Boolean).join(' · '),
        tag: g.gone ? 'folder gone' : `${g.tokens.toLocaleString('en-US')} tk`,
        color: g.gone ? CATEGORY_COLOR.stale! : '',
        group: g,
      }))
      .filter((row) => match(row.primary, row.secondary));
  }
  if (entry.kind === 'view' && entry.id === 'archived') {
    return [...archived]
      .reverse()
      .map((a): Row => ({ kind: a.kind, key: a.id, primary: a.name, secondary: a.scope, tag: 'archived', color: '#bb9af7', archived: a }))
      .filter((row) => match(row.primary, row.secondary));
  }
  if (entry.kind === 'view' && entry.id === 'checks') {
    return pairs
      .map(
        (p): Row => ({
          kind: 'pair',
          key: p.id,
          primary: `${p.a.name} ↔ ${p.b.name}`,
          secondary: p.a.scope,
          tag: 'needs check',
          color: CATEGORY_COLOR.contradiction!,
          pair: p,
        }),
      )
      .filter((row) => match(row.primary, row.secondary, row.pair?.cue));
  }
  return [];
}

/** Files behind a row, for `e` (edit). */
export function pathsOf(row: Row | undefined, r: ScanResult): string[] {
  if (!row) return [];
  if (row.pair) return [...new Set([row.pair.a.path, row.pair.b.path])];
  if (row.archived) return [row.archived.kind === 'skill' ? `${row.archived.to}/SKILL.md` : row.archived.to];
  if (row.item) return [row.item.path];
  if (row.finding) return [...new Set(itemsOf(row.finding, r).map((i) => i.path))];
  return [];
}
