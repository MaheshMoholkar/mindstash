import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, itemsOf, subject } from '../../cli/format.js';
import type { Requests } from '../../core/fix.js';
import type { Category, Finding, FixKind } from '../../core/types.js';
import type { Nav } from '../types.js';
import { CONFIDENCE_COLOR, Header, Hints, Scrollbar, useSize, windowOf } from '../ui.js';

const ACTION_KEYS: Record<string, FixKind> = { d: 'delete', a: 'archive', m: 'move', i: 'ignore' };

/** Build fix requests for the chosen findings, skipping ones that don't allow `kind`. */
export function requestsFor(findings: Finding[], kind: FixKind): { req: Requests; skipped: number } {
  const ok = findings.filter((f) => f.fixes.includes(kind));
  return { req: { [kind]: ok.map((f) => f.id) }, skipped: findings.length - ok.length };
}

export function Findings({ nav, category }: { nav: Nav; category: Category }) {
  const { cols, rows } = useSize();
  const r = nav.result;
  const cats = CATEGORIES.filter((c) => r.findings.some((f) => f.category === c.id));
  const [cat, setCat] = useState<Category>(category);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const list = useMemo(() => {
    const q = query.toLowerCase();
    return r.findings
      .filter((f) => f.category === cat)
      .filter((f) => {
        if (!q) return true;
        const hay = [f.title, ...itemsOf(f, r).map((i) => `${i.name} ${i.scope.label}`)].join(' ').toLowerCase();
        return hay.includes(q);
      });
  }, [r, cat, query]);

  // After a fix the list shrinks; keep the cursor and selection valid.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, list.length - 1)));
    setSelected((s) => new Set([...s].filter((id) => list.some((f) => f.id === id))));
  }, [list]);

  // If this category is now empty, go back to Home.
  useEffect(() => {
    if (cats.length === 0) nav.pop();
    else if (!cats.some((c) => c.id === cat)) setCat(cats[0]!.id);
  }, [cats.length, cat]);

  useInput((input, key) => {
    if (searching) {
      if (key.return || key.escape) setSearching(false);
      if (key.escape) setQuery('');
      else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
      else if (input && !key.ctrl && !key.meta && !key.return) setQuery((q) => q + input);
      setCursor(0);
      return;
    }
    const current = list[cursor];
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(list.length - 1, c + 1));
    else if (key.pageDown) setCursor((c) => Math.min(list.length - 1, c + 10));
    else if (key.pageUp) setCursor((c) => Math.max(0, c - 10));
    else if (key.tab && cats.length > 1) {
      const i = cats.findIndex((c) => c.id === cat);
      const next = cats[(i + (key.shift ? cats.length - 1 : 1)) % cats.length]!;
      setCat(next.id);
      setCursor(0);
      setSelected(new Set());
    } else if (input === ' ' && current) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(current.id) ? n.delete(current.id) : n.add(current.id);
        return n;
      });
      setCursor((c) => Math.min(list.length - 1, c + 1));
    } else if (key.return && current) nav.push({ kind: 'detail', id: current.id });
    else if (input === '/') setSearching(true);
    else if (ACTION_KEYS[input]) {
      const targets = selected.size ? list.filter((f) => selected.has(f.id)) : current ? [current] : [];
      if (!targets.length) return;
      const kind = ACTION_KEYS[input]!;
      const { req, skipped } = requestsFor(targets, kind);
      if (!req[kind]!.length) {
        nav.toast({ tone: 'error', text: `Can't ${kind} ${targets.length === 1 ? 'this one' : 'these'}. Press Enter for options.` });
        return;
      }
      if (skipped) nav.toast({ tone: 'info', text: `${skipped} selected can't be ${kind}d and were left out.` });
      nav.act(req);
    } else nav.common(input, key);
  });

  const label = CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
  const height = Math.max(3, Math.floor((rows - 10) / 2));
  const { start, end } = windowOf(list.length, cursor, height);
  const nameW = Math.min(34, Math.floor(cols * 0.32));
  const scopeW = Math.min(34, Math.floor(cols * 0.3));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title={`Findings › ${label} (${list.length})`} right={cats.length > 1 ? '[Tab] next type' : undefined} />
      {searching || query ? (
        <Text>
          <Text color="cyan">/</Text>
          {query}
          {searching ? <Text inverse> </Text> : <Text dimColor>  (Esc in search clears)</Text>}
        </Text>
      ) : null}
      {list.slice(start, end).map((f, i) => {
        const idx = start + i;
        const on = idx === cursor;
        const { name, scope } = subject(f, r);
        return (
          <Box key={f.id} flexDirection="column">
            <Box>
              <Text color={on ? 'cyan' : undefined}>{on ? '▸ ' : '  '}</Text>
              <Text>{selected.has(f.id) ? '[x] ' : '[ ] '}</Text>
              <Text color={CONFIDENCE_COLOR[f.confidence]}>● </Text>
              <Box width={nameW}>
                <Text bold={on} wrap="truncate-end">
                  {name || f.title}
                </Text>
              </Box>
              <Text> </Text>
              <Box width={scopeW}>
                {/* Keep the end of long paths: "…/vyavasay-v2" is the part that tells them apart. */}
                <Text dimColor wrap="truncate-start">
                  {scope}
                </Text>
              </Box>
              <Text dimColor> {f.id}</Text>
            </Box>
            <Box paddingLeft={8}>
              <Text wrap="truncate-end" dimColor={!on}>
                {f.title}
              </Text>
            </Box>
          </Box>
        );
      })}
      {list.length === 0 ? <Text dimColor>  No matches.</Text> : null}
      <Scrollbar start={start} end={end} count={list.length} />
      <Text> </Text>
      <Text dimColor>{selected.size ? `${selected.size} selected` : ' '}</Text>
      <Hints
        keys={[
          ['Enter', 'Details'],
          ['Space', 'Select'],
          ['d', 'Delete'],
          ['a', 'Archive'],
          ['m', 'Move'],
          ['i', 'Not a problem'],
          ['/', 'Search'],
          ['Esc', 'Back'],
        ]}
      />
    </Box>
  );
}
