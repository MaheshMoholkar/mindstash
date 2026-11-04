import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { CATEGORIES } from '../../cli/format.js';
import { cost } from '../../core/cost.js';
import type { Finding, Item, ScanResult } from '../../core/types.js';
import type { Nav } from '../types.js';
import { fmt, Header, Hints, Scrollbar, useSize, windowOf } from '../ui.js';

interface Group {
  key: string;
  label: string;
  items: Item[];
  memories: number;
  skills: number;
  tokens: number;
  gone: boolean;
}

export function groupsOf(r: ScanResult): Group[] {
  const sum = (xs: Item[]) => xs.reduce((n, i) => n + i.loadTokens, 0);
  const global = r.items.filter((i) => i.scope.kind === 'global');
  const groups: Group[] = [
    {
      key: 'global',
      label: 'Global (Claude Code)',
      items: [...global].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
      memories: 0,
      skills: global.filter((i) => i.kind === 'skill').length,
      tokens: sum(global),
      gone: false,
    },
  ];
  for (const p of [...r.projects].sort((a, b) => a.path.localeCompare(b.path))) {
    const items = r.items.filter(
      (i) => i.projectKey === p.key || (i.kind === 'skill' && i.scope.kind === 'project' && i.scope.dir === p.path),
    );
    const mems = items.filter((i) => i.kind === 'memory');
    if (!mems.length && !items.some((i) => i.kind === 'skill')) continue;
    groups.push({
      key: p.key,
      label: items[0]?.scope.label ?? p.path,
      items: items.filter((i) => i.kind !== 'index').sort((a, b) => a.name.localeCompare(b.name)),
      memories: mems.length,
      skills: items.filter((i) => i.kind === 'skill').length,
      tokens: sum(items),
      gone: !p.exists,
    });
  }
  return groups;
}

type Row = { type: 'group'; g: Group } | { type: 'item'; it: Item; g: Group };

export function Browse({ nav }: { nav: Nav }) {
  const { cols, rows } = useSize();
  const r = nav.result;
  const groups = useMemo(() => groupsOf(r), [r]);
  const flags = useMemo(() => {
    const m = new Map<string, Finding>();
    for (const f of r.findings) for (const id of f.itemIds) if (!m.has(id)) m.set(id, f);
    return m;
  }, [r]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const list: Row[] = useMemo(() => {
    const q = query.toLowerCase();
    const out: Row[] = [];
    for (const g of groups) {
      const items = q ? g.items.filter((i) => `${i.name} ${i.description ?? ''}`.toLowerCase().includes(q)) : g.items;
      if (q && !items.length && !g.label.toLowerCase().includes(q)) continue;
      out.push({ type: 'group', g });
      if (open.has(g.key) || q) for (const it of items) out.push({ type: 'item', it, g });
    }
    return out;
  }, [groups, open, query]);

  useInput((input, key) => {
    if (searching) {
      if (key.return || key.escape) setSearching(false);
      if (key.escape) setQuery('');
      else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
      else if (input && !key.ctrl && !key.meta && !key.return) setQuery((q) => q + input);
      setCursor(0);
      return;
    }
    const row = list[cursor];
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(list.length - 1, c + 1));
    else if (key.pageDown) setCursor((c) => Math.min(list.length - 1, c + 10));
    else if (key.pageUp) setCursor((c) => Math.max(0, c - 10));
    else if ((key.return || key.rightArrow || key.leftArrow) && row?.type === 'group') {
      setOpen((s) => {
        const n = new Set(s);
        if (key.leftArrow) n.delete(row.g.key);
        else if (key.rightArrow) n.add(row.g.key);
        else n.has(row.g.key) ? n.delete(row.g.key) : n.add(row.g.key);
        return n;
      });
    } else if (key.leftArrow && row?.type === 'item') {
      // Collapse the group and land on its header.
      setOpen((s) => {
        const n = new Set(s);
        n.delete(row.g.key);
        return n;
      });
      setCursor(list.findIndex((x) => x.type === 'group' && x.g.key === row.g.key));
    } else if (key.return && row?.type === 'item') {
      const f = flags.get(row.it.id);
      nav.push(f ? { kind: 'detail', id: f.id } : { kind: 'item', id: row.it.id });
    } else if (input === 'e' && row?.type === 'item') nav.edit([row.it.path]);
    else if (input === '/') setSearching(true);
    else nav.common(input, key);
  });

  const { start, end } = windowOf(list.length, cursor, rows - 8);
  const nameW = Math.min(40, cols - 40);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title="Browse" right="[/] search" />
      {searching || query ? (
        <Text>
          <Text color="cyan">/</Text>
          {query}
          {searching ? <Text inverse> </Text> : null}
        </Text>
      ) : null}
      {list.slice(start, end).map((row, i) => {
        const on = start + i === cursor;
        const mark = <Text color={on ? 'cyan' : undefined}>{on ? '▸' : ' '}</Text>;
        if (row.type === 'group') {
          const g = row.g;
          const counts = [g.memories && `${g.memories} mem`, g.skills && `${g.skills} skills`].filter(Boolean).join('  ');
          return (
            <Box key={'g' + g.key}>
              {mark}
              <Text> {open.has(g.key) || query ? '▾' : '▸'} </Text>
              <Box width={nameW + 4}>
                <Text bold={on} dimColor={g.gone} wrap="truncate-end">
                  {g.label}
                  {g.gone ? ' (folder gone)' : ''}
                </Text>
              </Box>
              <Box width={20}>
                <Text dimColor>{counts}</Text>
              </Box>
              <Text>{`${fmt(g.tokens)} tk`.padStart(10)}</Text>
            </Box>
          );
        }
        const f = flags.get(row.it.id);
        const cat = f && CATEGORIES.find((c) => c.id === f.category);
        return (
          <Box key={'i' + row.it.id}>
            {mark}
            <Text>{'     '}</Text>
            <Box width={nameW}>
              <Text bold={on} wrap="truncate-end">
                {row.it.name}
              </Text>
            </Box>
            <Text dimColor> {row.it.kind === 'memory' ? '' : row.it.kind.padEnd(12)} </Text>
            {f ? <Text color="yellow">● {cat?.label.toLowerCase()}</Text> : <Text color="green">✓</Text>}
          </Box>
        );
      })}
      <Scrollbar start={start} end={end} count={list.length} />
      <Hints keys={[['Enter', 'Open'], ['←→', 'Collapse/expand'], ['e', 'Edit'], ['/', 'Search'], ['Esc', 'Back']]} />
    </Box>
  );
}

export function Cost({ nav }: { nav: Nav }) {
  const { rows } = useSize();
  const c = useMemo(() => cost(nav.result, nav.ctx.home), [nav.result]);
  const [offset, setOffset] = useState(0);
  useInput((input, key) => {
    if (input === 'j' || key.downArrow) setOffset((o) => Math.min(Math.max(0, c.projects.length - 1), o + 1));
    else if (input === 'k' || key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else nav.common(input, key);
  });
  const h = Math.max(3, rows - 14 - c.bySource.length);
  const shown = c.projects.slice(offset, offset + h);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title="Token cost" right="estimated, ~4 characters per token" />
      <Text>Every session loads ~{fmt(c.baseline.total)} tokens:</Text>
      <Text>
        {fmt(c.baseline.skills).padStart(9)}  {c.baseline.skillCount} skill descriptions
      </Text>
      {c.bySource.map((s) => (
        <Text key={s.source} dimColor>
          {fmt(s.tokens).padStart(11)}  {s.source} ({s.skills})
        </Text>
      ))}
      <Text>{fmt(c.baseline.globalInstructions).padStart(9)}  global CLAUDE.md</Text>
      <Text> </Text>
      <Text bold>
        Per project <Text dimColor>baseline + CLAUDE.md + MEMORY.md + project skills</Text>
      </Text>
      {shown.map((p) => (
        <Box key={p.path}>
          <Box width={34}>
            <Text wrap="truncate-end">{p.label}</Text>
          </Box>
          <Text>{fmt(p.total).padStart(8)}  </Text>
          <Text dimColor wrap="truncate-end">
            {[p.instructions && `CLAUDE.md ${fmt(p.instructions)}`, p.index && `MEMORY.md ${fmt(p.index)}`, p.projectSkills && `skills ${fmt(p.projectSkills)}`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Box>
      ))}
      <Scrollbar start={offset} end={offset + shown.length} count={c.projects.length} />
      <Text> </Text>
      <Text>Flagged items cost ~{fmt(c.flaggedTokens)} tokens per session.</Text>
      <Hints keys={[['j/k', 'Scroll'], ['Esc', 'Back']]} />
    </Box>
  );
}

const KEYS: [string, string][] = [
  ['↑↓ / j k', 'Move'],
  ['Enter', 'Open'],
  ['Space', 'Select (findings list)'],
  ['Tab', 'Next finding type'],
  ['/', 'Search'],
  ['d / a / m', 'Delete / archive / move to project'],
  ['i', 'Not a problem (stays dismissed)'],
  ['e', 'Edit in $EDITOR'],
  ['u', 'Undo the last change'],
  ['b / c', 'Browse / token cost (from Home)'],
  ['Esc', 'Back'],
  ['q', 'Quit'],
];

export function Help({ nav }: { nav: Nav }) {
  useInput((input, key) => {
    if (input === '?') nav.pop();
    else nav.common(input, key);
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title="Help" />
      {KEYS.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan">{k.padEnd(12)}</Text>
          {d}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>Archive hides a memory from the agent but keeps it in ~/.mindstash/archive.</Text>
      <Text dimColor>Delete removes it. Both are backed up and can be undone.</Text>
      <Text dimColor>MindStash never rewrites what a memory says; for duplicates, edit the files yourself.</Text>
      <Hints keys={[['Esc', 'Back']]} />
    </Box>
  );
}
