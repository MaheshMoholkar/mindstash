import { Box, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { agentName } from '../adapters/index.js';
import { itemsOf } from '../cli/format.js';
import { installSkills, skillInstalled } from '../cli/skill.js';
import { pending } from '../core/contradictions.js';
import { baselines, cost } from '../core/cost.js';
import { apply, describe, FixError, moveTargetFor, plan, undo, type Requests } from '../core/fix.js';
import { actionable, scanSnapshot } from '../core/scan.js';
import { loadState, saveState, type Pair } from '../core/state.js';
import { loadCache, type ScanSnapshot } from '../core/cache.js';
import { markSeen } from '../core/notify.js';
import { plural, tildify } from '../core/text.js';
import type { FixKind, ScanContext, ScanResult } from '../core/types.js';
import { costLines } from './cost.js';
import { ENTRY_HELP, pathsOf, rowsFor, scopeEntries, selectable, sidebarEntries, treeRows, type Entry, type Row } from './data.js';
import { docFor, editability } from './doc.js';
import { fuzzy, helpLines, Modal, paletteLines, type PaletteItem } from './overlays.js';
import { CommandLine, Doc, List, Sidebar, StatusLine, type Mode } from './panes.js';
import { theme } from './theme.js';
import type { Focus, Message, Overlay, Ui } from './types.js';
import { fmt, useSize, wrap } from './ui.js';

export interface AppProps {
  ctx: ScanContext;
  firstRun: boolean;
  /** Command the installed skill should use to call MindStash. */
  selfCommand: string;
  initialUi?: Ui;
  /** Leave the UI so the user's editor can take over the terminal. */
  onEdit(paths: string[], ui: Ui): void;
  /** Tests pass a result to skip the real scan. */
  initialResult?: ScanResult;
  refresh?(): Promise<ScanSnapshot>;
}

interface Command {
  name: string;
  aliases?: string[];
  title: string;
  run(arg?: string): void;
}

const TOUR = [
  { title: 'Browse project folders', text: 'Use j and k to move. Press Enter on a project folder to see its findings, or l to open the selected item’s detail.' },
  { title: 'Jump with Ctrl-P', text: 'Press Ctrl-P and type part of a project, item, view, or command name. Use the arrow keys to choose and Enter to open it.' },
  { title: 'Undo with u', text: 'Review the list of files before confirming a fix. Press u and confirm to undo your last change.' },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const COLLAPSE_AFTER = 20;

function pendingPairs(ctx: ScanContext, r: ScanResult): Pair[] {
  try {
    return pending(loadState(ctx.mindstashDir), r.items, r.projects).pairs;
  } catch {
    return [];
  }
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const { cols, rows: termRows } = useSize();
  const { ctx } = props;

  // Draw the last scan instantly; the real scan refreshes it right after the first frame.
  const [first] = useState(() => props.initialResult
    ? { result: props.initialResult, pairs: pendingPairs(ctx, props.initialResult) }
    : loadCache(ctx));
  const [result, setResult] = useState<ScanResult | null>(first?.result ?? null);
  const [refreshing, setRefreshing] = useState(!props.initialResult);
  const [fresh, setFresh] = useState(Boolean(props.initialResult));
  const [pairs, setPairs] = useState<Pair[]>(first?.pairs ?? []);
  const [entryKey, setEntryKey] = useState(props.initialUi?.entryKey ?? 'cat:stale');
  const [focus, setFocus] = useState<Focus>(props.initialUi?.focus ?? 'main');
  const [cursor, setCursor] = useState(props.initialUi?.cursor ?? 0);
  const [offset, setOffset] = useState(0);
  const [fileCursor, setFileCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'NORMAL' | 'SEARCH' | 'COMMAND'>('NORMAL');
  const [query, setQuery] = useState('');
  const [cmd, setCmd] = useState('');
  const [overlay, setOverlay] = useState<Overlay | null>(props.firstRun && props.initialResult ? { kind: 'welcome' } : null);
  const [message, setMessage] = useState<Message | undefined>();
  const [sidebarHidden, setSidebarHidden] = useState(props.initialUi?.sidebarHidden ?? false);
  const [fatal, setFatal] = useState<string | null>(null);
  const vim = useRef({ count: '', g: false, z: false });
  /** Folder keys the user opened or closed (relative to the default). */
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const rescan = useCallback(async () => {
    setRefreshing(true);
    setFresh(false);
    try {
      const snapshot = await (props.refresh?.() ?? scanSnapshot({ ...ctx, now: new Date() }));
      setResult(snapshot.result);
      setPairs(snapshot.pairs);
      setFresh(true);
    } finally {
      setRefreshing(false);
    }
  }, [ctx, props.refresh]);

  // Opening the UI counts as having looked (the status line's "N new" resets).
  useEffect(() => {
    if (result && fresh && !refreshing) markSeen(ctx, result.findings.map((f) => f.id));
  }, [result, fresh, refreshing]);

  useEffect(() => {
    if (props.initialResult) return;
    let active = true;
    void rescan().then(() => {
      if (active && props.firstRun) setOverlay({ kind: 'welcome' });
    }).catch((e: Error) => {
      if (!active) return;
      if (first) setMessage({ tone: 'error', text: `Refresh failed: ${e.message}` });
      else setFatal(e.message);
    });
    return () => { active = false; };
  }, []);

  /* ---------------------------------------------------------------- derived */

  const archived = useMemo(() => {
    try {
      return loadState(ctx.mindstashDir).archived;
    } catch {
      return [];
    }
  }, [result]);
  const entries = useMemo(() => (result ? sidebarEntries(result, pairs, archived) : []), [result, pairs, archived]);
  const scopes = useMemo(() => (result ? scopeEntries(result) : []), [result]);
  const scopeEntry = scopes.find((e) => e.key === entryKey);
  // An open scope highlights "Browse all" in the sidebar.
  const sideKey = scopeEntry ? 'view:browse' : entryKey;
  const found = entries.findIndex((e) => e.key === sideKey && selectable(e));
  const entryIdx = found >= 0 ? found : entries.findIndex(selectable);
  const entry: Entry | undefined = scopeEntry ?? entries[entryIdx];
  const flat = useMemo(() => (result ? rowsFor(entry, result, pairs, query, archived) : []), [entry, result, pairs, query, archived]);
  // Findings lists group into per-project folders; long lists start collapsed.
  const foldersOn = entry?.kind === 'category';
  const collapseByDefault = flat.length > COLLAPSE_AFTER && !query;
  const rows = useMemo(
    () => (foldersOn ? treeRows(flat, (k) => (flipped.has(k) ? !collapseByDefault : collapseByDefault)) : flat),
    [flat, foldersOn, flipped, collapseByDefault],
  );
  const cur = clamp(cursor, 0, Math.max(0, rows.length - 1));
  const row: Row | undefined = rows[cur];
  const isCost = entry?.kind === 'view' && entry.id === 'cost';

  const showSidebar = !sidebarHidden && cols >= 72;
  const sw = showSidebar ? 24 : 0;
  const mw = cols - sw;
  // One spare row: some terminals scroll when the last line is written.
  const bodyH = termRows - 3;
  // Wide terminals: list and preview side by side (three columns). Narrow: stacked.
  const threeCol = mw >= 90;
  const zoomed = focus === 'detail' || isCost;
  const previewGap = zoomed ? 0 : threeCol ? 2 : 1;
  const listW = threeCol ? Math.floor(mw * 0.56) : mw;
  const prevW = threeCol ? mw - listW - previewGap : mw;
  const listH = threeCol ? bodyH : Math.max(6, Math.floor(bodyH * 0.45));
  const docW = (zoomed ? mw : prevW) - 4;

  const costReport = useMemo(() => result && isCost ? cost(result, ctx.home) : null, [result, isCost, ctx.home]);

  const docLines = useMemo(
    () => (costReport ? costLines(costReport, docW) : result ? docFor(row, result, docW, focus === 'detail', fileCursor) : []),
    [result, row, docW, focus, costReport, fileCursor],
  );
  const docHeight = zoomed || threeCol ? bodyH : bodyH - listH - previewGap;
  const maxOffset = Math.max(0, docLines.length - (docHeight - 2));
  // Files of a multi-file finding, when its detail is open (the file picker).
  const pickFiles = focus === 'detail' && row?.finding && !row.item && result ? itemsOf(row.finding, result) : [];
  const picking = pickFiles.length > 1;
  const pickedFile = picking ? pickFiles[clamp(fileCursor, 0, pickFiles.length - 1)] : undefined;
  // Keep the picked file in view.
  useEffect(() => {
    if (!picking) return;
    const line = docLines.findIndex((l) => l.cursor);
    const visible = docHeight - 2;
    if (line >= 0 && (line < offset || line >= offset + visible - 1)) setOffset(clamp(line - 3, 0, maxOffset));
  }, [fileCursor, picking]);

  // Keep the cursor valid when the list shrinks (after a fix, or while searching).
  useEffect(() => {
    if (cursor !== cur) setCursor(cur);
  }, [cur]);

  /* ---------------------------------------------------------------- navigation */

  const flip = (key: string) =>
    setFlipped((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const setFolder = (r: Row | undefined, open: boolean) => {
    if (r?.folder && r.folder.collapsed === open) flip(r.folder.key);
  };
  /** Open (or close) every folder: flip all folders whose default differs from the wish. */
  const allFolders = (open: boolean) => {
    const keys = treeRows(flat, () => true).filter((r) => r.folder).map((r) => r.key);
    setFlipped(new Set(collapseByDefault === open ? keys : []));
  };
  /** Rows under a folder row, or the row itself. */
  const expand = (rs: Row[]) => rs.flatMap((r) => (r.folder ? r.folder.children : [r]));

  const goEntry = (key: string) => {
    setEntryKey(key);
    setFlipped(new Set());
    setCursor(0);
    setOffset(0);
    setSelected(new Set());
    setQuery('');
    if (focus === 'detail') setFocus('main');
  };

  const moveSidebar = (delta: number) => {
    const idx = entries.map((e, i) => (selectable(e) ? i : -1)).filter((i) => i >= 0);
    const at = idx.indexOf(entryIdx);
    const next = idx[clamp((at === -1 ? 0 : at) + delta, 0, idx.length - 1)];
    if (next !== undefined) goEntry(entries[next]!.key);
  };

  const move = (delta: number) => {
    if (focus === 'sidebar') return moveSidebar(delta);
    if (picking) return setFileCursor((c) => clamp(c + delta, 0, pickFiles.length - 1));
    if (focus === 'detail' || isCost) return setOffset((o) => clamp(o + delta, 0, maxOffset));
    setCursor((c) => clamp(c + delta, 0, Math.max(0, rows.length - 1)));
    setOffset(0);
  };

  const jump = (to: 'top' | 'bottom' | number) => {
    if (focus === 'sidebar') return moveSidebar(to === 'top' ? -1e9 : to === 'bottom' ? 1e9 : 0);
    if (focus === 'detail' || isCost) return setOffset(to === 'top' ? 0 : to === 'bottom' ? maxOffset : clamp(to, 0, maxOffset));
    setCursor(to === 'top' ? 0 : to === 'bottom' ? Math.max(0, rows.length - 1) : clamp(to, 0, Math.max(0, rows.length - 1)));
  };

  const focusRight = () => {
    if (focus === 'main' && row?.folder) {
      if (row.folder.collapsed) setFolder(row, true);
      else setCursor((c) => c + 1);
      return;
    }
    if (focus === 'sidebar') setFocus('main');
    else if (focus === 'main' && row?.group) goEntry(row.key);
    else if (focus === 'main' && row && !isCost && !row.folder) {
      setFocus('detail');
      setOffset(0);
      setFileCursor(0);
    }
  };
  const focusLeft = () => {
    if (focus === 'main' && row?.depth === 1) {
      let i = cur;
      while (i > 0 && !rows[i]!.folder) i--;
      setFolder(rows[i], false);
      setCursor(i);
      return;
    }
    if (focus === 'main' && row?.folder && !row.folder.collapsed) return setFolder(row, false);
    if (focus === 'detail') setFocus('main');
    else if (focus === 'main' && scopeEntry) {
      const back = scopes.findIndex((e) => e.key === scopeEntry.key);
      goEntry('view:browse');
      setCursor(Math.max(0, back));
    }
    else if (focus === 'main' && showSidebar) setFocus('sidebar');
  };

  /* ---------------------------------------------------------------- actions */

  const ui = (): Ui => ({ entryKey: entry?.key ?? entryKey, focus, cursor: cur, sidebarHidden });

  const targets = (): Row[] =>
    focus === 'sidebar' ? [] : selected.size ? flat.filter((r) => selected.has(r.key)) : row ? expand([row]) : [];

  /** Projects a memory can be moved to: existing Claude Code projects, suggestion first. */
  const pickTargets = (q: string, suggested?: string): { path: string; label: string; hint: string }[] => {
    if (!result) return [];
    const list = result.projects
      .filter((p) => p.agent === 'claude-code' && p.exists)
      .map((p) => ({ path: p.path, label: tildify(p.path, ctx.home), hint: p.path === suggested ? 'suggested' : '' }));
    const scored = list
      .map((t) => ({ t, s: fuzzy(q, t.label) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => Number(Boolean(b.t.hint)) - Number(Boolean(a.t.hint)) || b.s - a.s || a.t.label.localeCompare(b.t.label));
    return scored.map((x) => x.t).slice(0, Math.max(1, Math.min(12, termRows - 8)));
  };

  const canFix = () => {
    if (fresh && !refreshing) return true;
    setMessage({ tone: 'info', text: refreshing ? 'Wait for the refresh before applying changes.' : 'Press r for a fresh scan before applying changes.' });
    return false;
  };

  const canMove = (item: NonNullable<Row['item']>) => item.kind === 'memory' && item.agent === 'claude-code' && actionable(item);

  const act = (kind: FixKind) => {
    if (!canFix()) return;
    if (kind === 'move') {
      const rs = targets();
      const ids = pickedFile
        ? (canMove(pickedFile) ? [pickedFile.id] : [])
        : rs.flatMap((r) => {
          if (r.item) return canMove(r.item) ? [r.item.id] : [];
          if (!r.finding || !result) return [];
          const items = itemsOf(r.finding, result);
          return items.length && items.every(canMove) ? [r.finding.id] : [];
        });
      if (!ids.length) return setMessage({ tone: 'error', text: 'Only Claude Code memories can be moved to another project.' });
      const suggested = rs.find((r) => r.finding?.moveTo)?.finding?.moveTo?.projectPath;
      if (!pickTargets('', suggested).length) {
        return setMessage({ tone: 'info', text: 'No existing Claude Code projects in this scan. Use apply --move <id> --to <folder>.' });
      }
      return setOverlay({ kind: 'pick', ids, query: '', cursor: 0, suggested });
    }
    // In the file picker, delete / archive act on the picked file only.
    if (pickedFile && (kind === 'delete' || kind === 'archive')) {
      if (!actionable(pickedFile)) return setMessage({ tone: 'error', text: `${pickedFile.name}: ${editability(pickedFile)}.` });
      try {
        const p = plan(ctx, { [kind]: [pickedFile.id] } as Requests);
        if (p.actions.length) setOverlay({ kind: 'confirm', plan: p });
      } catch (e) {
        if (e instanceof FixError) setMessage({ tone: 'error', text: e.message });
        else throw e;
      }
      return;
    }
    const rs = targets();
    if (!rs.length) return setMessage({ tone: 'info', text: 'Pick a row first (l to move into the list).' });
    if (kind === 'restore') {
      const restoreIds = rs.filter((r) => r.archived).map((r) => r.key);
      if (!restoreIds.length) return setMessage({ tone: 'info', text: 'R restores items in the Archived view.' });
      try {
        const p = plan(ctx, { restore: restoreIds });
        if (p.actions.length) setOverlay({ kind: 'confirm', plan: p });
      } catch (e) {
        if (e instanceof FixError) setMessage({ tone: 'error', text: e.message });
        else throw e;
      }
      return;
    }
    const ids: string[] = [];
    let why = '';
    for (const r of rs) {
      if (r.pair) why = 'Contradiction candidates are judged by your agent: /mindstash or $mindstash.';
      else if (r.finding?.fixes.includes(kind)) ids.push(r.finding.id);
      else if (r.item && (kind === 'delete' || kind === 'archive') && actionable(r.item)) ids.push(r.item.id);
      else if (r.item && !actionable(r.item)) why = `${r.item.name}: ${editability(r.item)}.`;
      else if (r.finding) {
        why = `${kind} isn't offered for this finding.${kind === 'delete' || kind === 'archive' ? ' Open its scope under SCOPES to act on one file.' : ''}`;
      }
    }
    if (!ids.length) return setMessage({ tone: 'error', text: why || `Nothing here can be ${kind}d.` });
    try {
      const p = plan(ctx, { [kind]: ids } as Requests);
      if (!p.actions.length) return setMessage({ tone: 'info', text: 'Nothing to change.' });
      setOverlay({ kind: 'confirm', plan: p });
      if (rs.length > ids.length) {
        setMessage({ tone: 'info', text: `${rs.length - ids.length} of the selected rows can't be ${kind}d and were left out.` });
      }
    } catch (e) {
      if (e instanceof FixError) setMessage({ tone: 'error', text: e.message });
      else throw e;
    }
  };

  const askUndo = () => {
    if (!canFix()) return;
    const op = [...loadState(ctx.mindstashDir).history].reverse().find((o) => !o.undone);
    if (!op) setMessage({ tone: 'info', text: 'Nothing to undo.' });
    else setOverlay({ kind: 'undo', op });
  };

  const edit = () => {
    if (!result) return;
    const picked = focus === 'sidebar' ? [] : selected.size ? flat.filter((r) => selected.has(r.key)) : row ? expand([row]) : [];
    const paths = pickedFile ? [pickedFile.path] : [...new Set(picked.flatMap((r) => pathsOf(r, result)))];
    if (!paths.length) return setMessage({ tone: 'info', text: 'Nothing to open here.' });
    props.onEdit(paths, ui());
    exit();
  };

  const installSkill = () => {
    const done = installSkills(ctx, props.selfCommand);
    setMessage({
      tone: done.length ? 'ok' : 'error',
      text: done.length ? `✓ Added ${done.map((d) => `${d.invoke} to ${d.name}`).join(' and ')}.` : 'No supported agent found.',
    });
  };

  const toggleSelect = (all = false) => {
    if (focus === 'sidebar' || isCost) return;
    setSelected((s) => {
      if (all) return s.size === flat.length ? new Set() : new Set(flat.map((r) => r.key));
      const n = new Set(s);
      if (row?.folder) {
        const kids = row.folder.children.map((k) => k.key);
        const allIn = kids.every((k) => n.has(k));
        for (const k of kids) allIn ? n.delete(k) : n.add(k);
      } else if (row) n.has(row.key) ? n.delete(row.key) : n.add(row.key);
      return n;
    });
    if (!all) setCursor((c) => clamp(c + 1, 0, Math.max(0, rows.length - 1)));
  };

  const refreshError = (e: Error) => setMessage({ tone: 'error', text: `Refresh failed: ${e.message}` });
  const doRescan = () => {
    if (!refreshing) void rescan().then(() => setMessage({ tone: 'ok', text: '✓ Rescanned.' })).catch(refreshError);
  };
  const finishTour = (onboarding: boolean) => {
    if (onboarding) {
      const state = loadState(ctx.mindstashDir);
      state.tourSeen = true;
      saveState(ctx.mindstashDir, state);
    }
    setOverlay(onboarding && !skillInstalled(ctx) && result?.agents.some((agent) => agent.found) ? { kind: 'skill' } : null);
  };

  const commands: Command[] = [
    { name: 'quit', aliases: ['q', 'q!', 'qa', 'wq', 'x'], title: 'Quit', run: () => exit() },
    { name: 'rescan', aliases: ['r', 'scan', 'e!'], title: 'Rescan everything', run: doRescan },
    { name: 'stale', title: 'Stale findings', run: () => goEntry('cat:stale') },
    { name: 'checks', title: 'Contradiction checks', run: () => goEntry('view:checks') },
    { name: 'cost', title: 'Token cost', run: () => goEntry('view:cost') },
    { name: 'help', aliases: ['h'], title: 'Keys and commands', run: () => setOverlay({ kind: 'help' }) },
    { name: 'tour', title: 'Take the quick tour', run: () => setOverlay({ kind: 'tour', page: 0, onboarding: false }) },
    { name: 'undo', aliases: ['u'], title: 'Undo the last change', run: askUndo },
    { name: 'delete', aliases: ['d'], title: 'Delete the selected rows', run: () => act('delete') },
    { name: 'archive', aliases: ['a'], title: 'Archive the selected rows', run: () => act('archive') },
    { name: 'move', aliases: ['m'], title: 'Move to another project', run: () => act('move') },
    { name: 'ignore', aliases: ['i'], title: 'Mark as not a problem', run: () => act('ignore') },
    { name: 'link', aliases: ['relink'], title: 'Add an unlisted memory to MEMORY.md', run: () => act('relink') },
    { name: 'restore', title: 'Restore archived items', run: () => act('restore') },
    { name: 'archived', title: 'Archived items', run: () => goEntry('view:archived') },
    { name: 'edit', aliases: ['e'], title: 'Open in $EDITOR', run: edit },
    { name: 'skill', aliases: ['install-skill'], title: 'Install the MindStash skill', run: installSkill },
    { name: 'sidebar', title: 'Hide / show the sidebar', run: () => setSidebarHidden((h) => !h) },
    { name: 'nohlsearch', aliases: ['noh'], title: 'Clear the search', run: () => setQuery('') },
  ];

  const findCommand = (word: string): Command | undefined => {
    const exact = commands.find((c) => c.name === word || c.aliases?.includes(word));
    if (exact) return exact;
    const pre = commands.filter((c) => c.name.startsWith(word));
    return pre.length === 1 ? pre[0] : undefined;
  };

  const runCommand = (text: string) => {
    const [word = '', ...rest] = text.trim().split(/\s+/);
    if (!word) return;
    if (/^\d+$/.test(word)) return jump(Number(word) - 1); // :12 → row 12, like vim
    const c = findCommand(word);
    if (!c) return setMessage({ tone: 'error', text: `Not a command: ${word}  (:help lists them)` });
    c.run(rest.join(' '));
  };

  const paletteItems = (q: string): PaletteItem[] => {
    if (!result) return [];
    const items: (PaletteItem & { score: number })[] = [];
    const add = (label: string, hint: string, run: () => void, boost = 0) => {
      const score = fuzzy(q, label);
      if (score >= 0) items.push({ label, hint, run, score: score + boost });
    };
    for (const c of commands) add(c.title, `:${c.name}`, () => c.run(), 5);
    for (const e of entries) {
      if (e.kind === 'category') add(`Go to ${e.label}`, `${e.count} findings`, () => goEntry(e.key), 3);
      if (e.kind === 'view') add(`Go to ${e.label}`, 'view', () => goEntry(e.key), 3);
    }
    for (const e of scopes) if (e.kind === 'scope') add(e.group.label, 'scope', () => goEntry(e.key));
    if (q) {
      for (const e of entries) {
        if (e.kind !== 'category') continue;
        const findings = rowsFor(e, result, pairs, '');
        for (const r of findings) {
          add(`${r.primary} — ${r.finding?.title ?? ''}`, r.tag, () => {
            const opened = new Set<string>();
            const visible = treeRows(findings, (key, children) => {
              if (findings.length <= COLLAPSE_AFTER) return false;
              if (!children.some((child) => child.key === r.key)) return true;
              opened.add(key);
              return false;
            });
            goEntry(e.key);
            setFlipped(opened);
            setCursor(visible.findIndex((row) => row.key === r.key));
            setFocus('main');
          });
        }
      }
      for (const e of scopes) {
        if (e.kind !== 'scope') continue;
        e.group.items.forEach((it) =>
          add(it.name, `${it.kind} · ${e.group.label}`, () => {
            setEntryKey(e.key);
            setQuery('');
            setSelected(new Set());
            setCursor(Math.max(0, rowsFor(e, result, pairs, '').findIndex((r) => r.key === it.id)));
            setFocus('main');
          }, -2),
        );
      }
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 10);
  };

  /* ---------------------------------------------------------------- keys */

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (!result) {
      if (input === 'q') exit();
      if (input === 'r' && !refreshing) {
        setFatal(null);
        void rescan().then(() => {
          if (props.firstRun) setOverlay({ kind: 'welcome' });
        }).catch((e: Error) => setFatal(e.message));
      }
      return;
    }

    if (overlay) {
      setMessage(undefined);
      switch (overlay.kind) {
        case 'confirm':
          if (input === 'y' || key.return) {
            const p = overlay.plan;
            if (!canFix()) return;
            setOverlay(null);
            try {
              apply(ctx, p);
            } catch (e) {
              return setMessage({ tone: 'error', text: (e as Error).message });
            }
            setSelected(new Set());
            if (focus === 'detail') setFocus('main');
            const saved = p.tokensSaved ? ` · saved ~${fmt(p.tokensSaved)} tk/session` : '';
            void rescan().then(() =>
              setMessage({ tone: 'ok', text: `✓ ${plural(p.actions.length, 'change')} applied${saved} · u to undo` }),
            ).catch(refreshError);
          } else if (input === 'n' || key.escape || input === 'q') setOverlay(null);
          return;
        case 'undo':
          if (input === 'y' || key.return) {
            setOverlay(null);
            try {
              undo(ctx);
            } catch (e) {
              return setMessage({ tone: 'error', text: (e as Error).message });
            }
            void rescan().then(() => setMessage({ tone: 'ok', text: '✓ Undone.' })).catch(refreshError);
          } else if (input === 'n' || key.escape || input === 'q') setOverlay(null);
          return;
        case 'help':
          if (key.escape || key.return || input === 'q' || input === '?') setOverlay(null);
          return;
        case 'welcome':
          if (key.return) setOverlay({ kind: 'tour', page: 0, onboarding: true });
          else if (key.escape) finishTour(true);
          else if (input === 'q') exit();
          return;
        case 'tour':
          if (key.escape) finishTour(overlay.onboarding);
          else if (key.return || key.rightArrow || key.downArrow) {
            if (overlay.page === TOUR.length - 1) finishTour(overlay.onboarding);
            else setOverlay({ ...overlay, page: overlay.page + 1 });
          } else if ((key.leftArrow || key.upArrow) && overlay.page > 0) setOverlay({ ...overlay, page: overlay.page - 1 });
          return;
        case 'skill':
          if (input === 'y') {
            setOverlay(null);
            installSkill();
          } else if (input === 'n' || key.escape || key.return) setOverlay(null);
          return;
        case 'pick': {
          const list = pickTargets(overlay.query, overlay.suggested);
          if (key.escape) setOverlay(null);
          else if (key.return) {
            const target = list[overlay.cursor];
            if (!target) return;
            try {
              const p = plan(ctx, { move: overlay.ids }, { moveTo: moveTargetFor(ctx, target.path) });
              setOverlay(p.actions.length ? { kind: 'confirm', plan: p } : null);
            } catch (e) {
              setOverlay(null);
              if (e instanceof FixError) setMessage({ tone: 'error', text: e.message });
              else throw e;
            }
          } else if (key.downArrow || (key.ctrl && (input === 'n' || input === 'j'))) {
            setOverlay({ ...overlay, cursor: clamp(overlay.cursor + 1, 0, Math.max(0, list.length - 1)) });
          } else if (key.upArrow || (key.ctrl && (input === 'p' || input === 'k'))) {
            setOverlay({ ...overlay, cursor: clamp(overlay.cursor - 1, 0, Math.max(0, list.length - 1)) });
          } else if (key.backspace || key.delete) setOverlay({ ...overlay, query: overlay.query.slice(0, -1), cursor: 0 });
          else if (input && !key.ctrl && !key.meta) setOverlay({ ...overlay, query: overlay.query + input, cursor: 0 });
          return;
        }
        case 'palette': {
          const items = paletteItems(overlay.query);
          if (key.escape) setOverlay(null);
          else if (key.return) {
            setOverlay(null);
            items[overlay.cursor]?.run();
          } else if (key.downArrow || (key.ctrl && (input === 'n' || input === 'j'))) {
            setOverlay({ ...overlay, cursor: clamp(overlay.cursor + 1, 0, Math.max(0, items.length - 1)) });
          } else if (key.upArrow || (key.ctrl && (input === 'p' || input === 'k'))) {
            setOverlay({ ...overlay, cursor: clamp(overlay.cursor - 1, 0, Math.max(0, items.length - 1)) });
          } else if (key.backspace || key.delete) setOverlay({ ...overlay, query: overlay.query.slice(0, -1), cursor: 0 });
          else if (input && !key.ctrl && !key.meta) setOverlay({ ...overlay, query: overlay.query + input, cursor: 0 });
          return;
        }
      }
    }

    if (mode === 'SEARCH') {
      if (key.escape) {
        setQuery('');
        setMode('NORMAL');
      } else if (key.return) setMode('NORMAL');
      else if (key.backspace || key.delete) {
        if (!query) setMode('NORMAL');
        setQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
      setCursor(0);
      return;
    }

    if (mode === 'COMMAND') {
      if (key.escape) {
        setCmd('');
        setMode('NORMAL');
      } else if (key.return) {
        setMode('NORMAL');
        setCmd('');
        runCommand(cmd);
      } else if (key.tab) {
        const c = commands.find((x) => x.name.startsWith(cmd.trim()));
        if (c) setCmd(c.name);
      } else if (key.backspace || key.delete) {
        if (!cmd) setMode('NORMAL');
        setCmd((c) => c.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) setCmd((c) => c + input);
      return;
    }

    // NORMAL mode
    setMessage(undefined);
    if (key.ctrl && input === 'p') return setOverlay({ kind: 'palette', query: '', cursor: 0 });
    const half = Math.max(1, Math.floor(bodyH / 2));
    if (key.ctrl && input === 'd') return move(half);
    if (key.ctrl && input === 'u') return move(-half);

    const v = vim.current;
    if (v.z) {
      v.z = false;
      if (input === 'o') setFolder(row, true);
      else if (input === 'c') setFolder(row, false);
      else if (input === 'a' && row?.folder) flip(row.folder.key);
      else if (input === 'R') allFolders(true);
      else if (input === 'M') allFolders(false);
      return;
    }
    if (input === 'z' && foldersOn) {
      v.z = true;
      return;
    }
    if (/^[1-9]$/.test(input) || (v.count && input === '0')) {
      v.count += input;
      return;
    }
    const n = Number(v.count || '1');
    const counted = v.count !== '';
    v.count = '';
    if (input === 'g') {
      if (v.g) {
        v.g = false;
        return jump(counted ? n - 1 : 'top');
      }
      v.g = true;
      return;
    }
    v.g = false;

    if (input === 'j' || key.downArrow) move(n);
    else if (input === 'k' || key.upArrow) move(-n);
    else if (key.pageDown) move(half * 2);
    else if (key.pageUp) move(-half * 2);
    else if (input === 'G') jump(counted ? n - 1 : 'bottom');
    else if (input === 'h' || key.leftArrow) focusLeft();
    else if (key.return && focus === 'main' && row?.folder) flip(row.folder.key);
    else if (input === 'l' || key.rightArrow || key.return) focusRight();
    else if (key.tab) setFocus((f) => (f === 'sidebar' ? 'main' : showSidebar ? 'sidebar' : 'main'));
    else if (key.escape) {
      if (focus === 'detail') setFocus('main');
      else if (scopeEntry && !query) focusLeft();
      else if (query) setQuery('');
      else if (selected.size) setSelected(new Set());
    } else if (input === '[') moveSidebar(-1);
    else if (input === ']') moveSidebar(1);
    else if (input === ' ' || input === 'x') toggleSelect();
    else if (input === 'V') toggleSelect(true);
    else if (input === 'd') act('delete');
    else if (input === 'a') act('archive');
    else if (input === 'm') act('move');
    else if (input === 'i') act('ignore');
    else if (input === 'L') act('relink');
    else if (input === 'R') act('restore');
    else if (input === 'e') edit();
    else if (input === 'u') askUndo();
    else if (input === '/') {
      if (focus !== 'main') setFocus('main');
      setQuery('');
      setMode('SEARCH');
    } else if (input === ':') setMode('COMMAND');
    else if (input === '?') setOverlay({ kind: 'help' });
    else if (input === 'r') doRescan();
    else if (input === '\\') setSidebarHidden((h) => !h);
    else if (input === 'q') exit();
  });

  /* ---------------------------------------------------------------- render */

  if (fatal) return <Text color={theme.error}>{fatal}{' · r retry · q quit'}</Text>;
  if (!result) {
    return (
      <Box width={cols} height={termRows} alignItems="center" justifyContent="center">
        <Text color={theme.accent}>◆ MindStash · scanning memories and skills…</Text>
      </Box>
    );
  }

  const entryLabel =
    entry?.kind === 'category' || entry?.kind === 'view' ? entry.label : entry?.kind === 'scope' ? `Browse › ${entry.group.label}` : '';
  const listTitle = `${entryLabel}${query ? `  /${query}` : ''}`;
  const emptyText =
    entry?.kind === 'view' && entry.id === 'checks'
      ? '✓ No pairs waiting to be checked.'
      : query
        ? 'No matches.'
        : entry?.kind === 'category'
          ? '✓ Nothing needs attention here.'
          : 'Empty.';

  const tourPage = overlay?.kind === 'tour' ? overlay.page : undefined;
  const tourKeys = tourPage === TOUR.length - 1
    ? 'Enter / → / ↓ done · ← / ↑ back · Esc close'
    : 'Enter / → / ↓ next · ← / ↑ back · Esc skip';
  const statusMode: Mode = tourPage !== undefined
    ? 'TOUR'
    : overlay?.kind === 'confirm' || overlay?.kind === 'undo' ? 'CONFIRM' : mode;
  const crumb = [entryLabel, rows.length && !isCost ? `${cur + 1}/${rows.length}` : '', focus === 'detail' ? 'detail' : '', refreshing ? '↻ refreshing' : '']
    .filter(Boolean)
    .join(' › ');
  const hints =
    focus === 'sidebar'
      ? 'j/k move · l open · [ ] switch · ^p palette · : command · ? help'
      : focus === 'detail'
        ? picking
          ? 'j/k pick file · e edit · h back'
          : 'j/k scroll · a archive · m move · i ignore · e edit · h back'
        : entry?.kind === 'view' && entry.id === 'archived'
          ? 'R restore · e open · space select · / search'
          : row?.finding?.fixes.includes('relink')
            ? 'L link into MEMORY.md · a archive · i ignore · e edit · ⏎ open'
            : row?.folder
            ? `⏎ ${row.folder.collapsed ? 'open' : 'close'} folder · zR open all · zM close all · space select folder`
            : 'space select · a archive · m move · i ignore · e edit · ⏎ open · h close folder · / search';
  const completion =
    mode === 'COMMAND' && cmd.trim()
      ? commands.filter((c) => c.name.startsWith(cmd.trim())).map((c) => c.name).slice(0, 6).join('  ')
      : '';

  let modal: ReactNode = null;
  if (overlay) {
    const mw2 = Math.min(76, cols - 4);
    const inner = mw2 - 4;
    const common = { cols, rows: termRows, width: mw2 };
    if (overlay.kind === 'confirm') {
      const p = overlay.plan;
      modal = (
        <Modal
          {...common}
          title={`Apply ${plural(p.actions.length, 'change')}?`}
          color={theme.error}
          lines={[
            ...p.actions.slice(0, 12).map((a) => ({ text: describe(a) })),
            ...(p.actions.length > 12 ? [{ text: `… and ${p.actions.length - 12} more`, dim: true }] : []),
            { text: '' },
            ...(p.tokensSaved ? [{ text: `Saves ~${fmt(p.tokensSaved)} tokens per session.`, color: theme.ok }] : []),
            { text: 'A backup is saved first. Undo any time with u.', dim: true },
          ]}
          footer="y apply   n cancel"
        />
      );
    } else if (overlay.kind === 'undo') {
      modal = (
        <Modal
          {...common}
          title="Undo last change?"
          color={theme.warn}
          lines={[
            { text: new Date(overlay.op.at).toLocaleString(), dim: true },
            ...overlay.op.summary.split('\n').slice(0, 12).map((t) => ({ text: t })),
          ]}
          footer="y undo   n cancel"
        />
      );
    } else if (overlay.kind === 'help') {
      modal = <Modal {...common} title="Keys" lines={helpLines()} footer="Esc close" />;
    } else if (overlay.kind === 'pick') {
      const list = pickTargets(overlay.query, overlay.suggested);
      modal = (
        <Modal
          {...common}
          title="Move to another project"
          color={theme.info}
          lines={paletteLines(list.map((t) => ({ label: t.label, hint: t.hint, run: () => {} })), overlay.query, overlay.cursor, inner)}
          footer="type to filter   ⏎ choose   Esc cancel   (you confirm the move next)"
        />
      );
    } else if (overlay.kind === 'palette') {
      modal = (
        <Modal
          {...common}
          title="Go to anything"
          color={theme.accent2}
          lines={paletteLines(paletteItems(overlay.query), overlay.query, overlay.cursor, inner)}
          footer="⏎ run   ↑↓ move   Esc close"
        />
      );
    } else if (overlay.kind === 'welcome') {
      modal = (
        <Modal
          {...common}
          title="Welcome to MindStash"
          lines={[
            { text: 'Looking for agents…', bold: true },
            ...result.agents.map((a) => ({
              text: `${a.found ? '✓' : '✗'} ${a.name.padEnd(13)} ${
                a.found
                  ? `${plural(a.projects, 'project')} · ${plural(a.memories, 'memory', 'memories')} · ${plural(a.skills, 'skill')}`
                  : 'not found'
              }`,
              color: a.found ? theme.ok : theme.muted,
            })),
            { text: '' },
            ...wrap('Nothing changes without asking you. Every fix is backed up and can be undone with u.', inner).map((t) => ({ text: t })),
            { text: '' },
            { text: 'Press ? any time for keys, Ctrl-P to jump anywhere.', dim: true },
          ]}
          footer="⏎ continue   q quit"
        />
      );
    } else if (overlay.kind === 'tour') {
      const tip = TOUR[overlay.page]!;
      modal = <Modal {...common} title={`Quick Tour ${overlay.page + 1}/${TOUR.length} · ${tip.title}`}
        color={theme.accent2}
        backgroundColor={theme.hilite}
        lines={wrap(tip.text, inner).map((text) => ({ text }))}
        footer={tourKeys} />;
    } else if (overlay.kind === 'skill') {
      const agents = result.agents.filter((a) => a.found).map((a) => agentName(a.id));
      modal = (
        <Modal
          {...common}
          title="Use MindStash from your agent?"
          lines={[
            ...wrap(
              `Add the MindStash skill to ${agents.join(' and ')} so you can review memories from chat (/mindstash in Claude Code, $mindstash in Codex).`,
              inner,
            ).map((t) => ({ text: t })),
            { text: '' },
            { text: 'One small file per agent; only its description loads per session.', dim: true },
          ]}
          footer="y add it   n not now"
        />
      );
    }
  }

  const tokens = baselines(result).map((b) => ({ name: b.name === 'Claude Code' ? 'Claude' : b.name, tokens: b.tokens }));
  const docTitle = isCost ? 'Token cost' : focus === 'detail' ? (row?.primary ?? 'Detail') : 'Preview';

  return (
    <Box flexDirection="column" width={cols} height={termRows}>
      <Box height={bodyH}>
        {showSidebar ? (
          <Sidebar
            entries={entries}
            cursor={entryIdx}
            focused={focus === 'sidebar'}
            width={sw}
            height={bodyH}
            about={entries[entryIdx] ? ENTRY_HELP[entries[entryIdx]!.key] : undefined}
          />
        ) : null}
        <Box flexDirection={threeCol && !zoomed ? 'row' : 'column'} width={mw} gap={previewGap}>
          {zoomed ? null : (
            <List
              title={listTitle}
              rows={rows}
              cursor={cur}
              selected={selected}
              focused={focus === 'main'}
              canDelete={fresh && !refreshing && !!row && expand([row]).some((target) =>
                (!selected.size || selected.has(target.key))
                && (target.finding?.fixes.includes('delete') || (target.item && actionable(target.item))),
              )}
              width={listW}
              height={listH}
              empty={emptyText}
            />
          )}
          <Doc
            title={docTitle}
            lines={docLines}
            offset={focus === 'detail' || isCost ? offset : 0}
            overflowHint={zoomed ? '… more below (j/k)' : '… more in detail'}
            focused={focus === 'detail' || (isCost && focus === 'main')}
            width={zoomed ? mw : prevW}
            height={docHeight}
          />
        </Box>
      </Box>
      <StatusLine mode={statusMode} crumb={tourPage === undefined ? crumb : `Quick tour ${tourPage + 1}/${TOUR.length}`} selected={selected.size} tokens={tokens} width={cols} />
      <CommandLine
        mode={mode}
        input={mode === 'COMMAND' ? cmd : query}
        completion={completion}
        message={tourPage === undefined ? message : undefined}
        hints={tourPage === undefined ? hints : tourKeys}
        width={cols}
      />
      {modal}
    </Box>
  );
}
