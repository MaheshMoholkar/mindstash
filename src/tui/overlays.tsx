import { Box, Text } from 'ink';
import { describe, type Action } from '../core/fix.js';
import { plural, tildify } from '../core/text.js';
import { theme } from './theme.js';
import { fit, wrap, type Line } from './ui.js';

export function deletionTitle(actions: Action[]): string {
  const first = actions[0];
  if (actions.length === 1 && first?.kind === 'delete-skill') {
    return `Delete entire skill (${plural(first.files.length, 'file')})?`;
  }
  const files = actions.reduce((count, action) =>
    count + (action.kind === 'delete' ? 1 : action.kind === 'delete-skill' ? action.files.length : 0), 0);
  const links = actions.filter((action) => action.kind === 'unlink').length;
  if (!files) return `Remove ${plural(links, 'broken link')}?`;
  const target = files > 1 ? `all ${files} files` : '1 file';
  return `Delete ${target}${links ? ` and remove ${plural(links, 'link')}` : ''}?`;
}

export function deletionLines(action: Action, home: string, width: number): Line[] {
  const pathLines = (path: string, label = '') =>
    wrap(label + tildify(path, home), width).map((text) => ({ text, dim: true }));
  const summary = wrap(describe(action), width).map((text) => ({ text, bold: true }));
  switch (action.kind) {
    case 'delete':
      return [
        ...summary,
        ...pathLines(action.target.path),
        ...(action.target.indexPath ? pathLines(action.target.indexPath, 'Update index: ') : []),
      ];
    case 'delete-skill':
      return [...summary, ...pathLines(action.dir)];
    case 'unlink':
      return [...summary, ...pathLines(action.indexPath)];
    default:
      return [];
  }
}

/**
 * A centred dialog drawn over the UI. Every inner cell is written (lines are padded),
 * so nothing from the panes underneath shows through.
 */
export function Modal({
  title,
  lines,
  footer,
  width,
  cols,
  rows,
  color = theme.accent,
  backgroundColor,
}: {
  title: string;
  lines: Line[];
  footer?: string;
  width: number;
  cols: number;
  rows: number;
  color?: string;
  backgroundColor?: string;
}) {
  const w = Math.min(width, cols - 4);
  const inner = w - 4;
  const body = footer ? [...lines, { text: '' }, { text: footer, dim: true }] : lines;
  const h = body.length + 2;
  const top = Math.max(1, Math.floor((rows - h) / 3));
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const t = ` ${title} `;
  return (
    <Box position="absolute" top={top} left={left} flexDirection="column" width={w}>
      <Text>
        <Text color={color} backgroundColor={backgroundColor}>╭─</Text>
        <Text color={color} backgroundColor={backgroundColor} bold>
          {t}
        </Text>
        <Text color={color} backgroundColor={backgroundColor}>{'─'.repeat(Math.max(0, w - 4 - t.length))}─╮</Text>
      </Text>
      {body.map((l, i) => (
        <Text key={i}>
          <Text color={color} backgroundColor={backgroundColor}>│ </Text>
          <Text color={l.color ?? (l.dim ? theme.muted : theme.fg)} bold={l.bold} backgroundColor={(l as Hl).bg ?? backgroundColor}>
            {fit(l.text, inner)}
          </Text>
          <Text color={color} backgroundColor={backgroundColor}> │</Text>
        </Text>
      ))}
      <Text color={color} backgroundColor={backgroundColor}>╰{'─'.repeat(w - 2)}╯</Text>
    </Box>
  );
}

type Hl = Line & { bg?: string };

export const KEYS: [string, string][] = [
  ['j k  ↓ ↑', 'move (counts work: 5j)'],
  ['gg  G', 'top / bottom'],
  ['^d  ^u', 'half page down / up'],
  ['h l  ← →', 'focus sidebar · list · detail'],
  ['⏎  zo zc', 'open / close a project folder'],
  ['zR  zM', 'open / close all folders'],
  ['Enter', 'open'],
  ['Esc', 'back, clear search or selection'],
  ['Tab', 'switch sidebar / list'],
  ['[  ]', 'previous / next sidebar entry'],
  ['Space  V', 'select row / all rows'],
  ['d  a  m  i', 'delete · archive · move · not a problem'],
  ['L  R', 'link into MEMORY.md · restore archived'],
  ['e', 'open in $EDITOR'],
  ['u', 'undo last change'],
  ['/', 'search this list'],
  [':', 'command (:cost :checks :undo :q …)'],
  ['^p', 'palette: jump to anything'],
  ['\\', 'hide / show sidebar'],
  ['r', 'rescan'],
  ['q', 'quit'],
];

export function helpLines(): Line[] {
  return [
    ...KEYS.map(([k, d]) => ({ text: `${k.padEnd(12)} ${d}` })),
    { text: '' },
    { text: 'Nothing changes without a confirm; every fix is backed up and undoable.', dim: true },
    { text: 'Archive hides an item from the agent but keeps a copy in ~/.mindstash.', dim: true },
  ];
}

export interface PaletteItem {
  label: string;
  hint: string;
  run(): void;
}

/** Subsequence fuzzy match: "stl" matches "Stale". Higher is better; -1 means no match. */
export function fuzzy(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at === -1) return -1;
    score += at === ti ? 2 : 1;
    ti = at + 1;
  }
  return score;
}

export function paletteLines(items: PaletteItem[], query: string, cursor: number, inner: number): Hl[] {
  const out: Hl[] = [{ text: `> ${query}▏`, color: theme.accent, bold: true }, { text: '' }];
  if (!items.length) out.push({ text: 'No matches', dim: true });
  const hintW = Math.min(22, Math.floor(inner * 0.35));
  items.forEach((it, i) => {
    const on = i === cursor;
    out.push({
      text: `${on ? '▌' : ' '} ${fit(it.label, inner - hintW - 3)} ${fit(it.hint, hintW, 'right')}`,
      color: on ? theme.accent : theme.fg,
      bold: on,
      bg: on ? theme.paletteCursor : undefined,
    });
  });
  return out;
}
