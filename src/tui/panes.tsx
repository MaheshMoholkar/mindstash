import { Box, Text } from 'ink';
import type { Entry, Row } from './data.js';
import { CATEGORY_COLOR, CONFIDENCE, MODE_COLOR, theme } from './theme.js';
import { CATEGORIES } from '../cli/format.js';
import { KIND_GLYPH } from './doc.js';
import { fit, Lines, Panel, short, windowOf, wrap, type Line } from './ui.js';

/** Keep the end of long paths: "…/api-server" is what tells them apart. */
const fitStart = (t: string, w: number) => (t.length > w && w > 1 ? '…' + t.slice(t.length - w + 1) : t.padEnd(w));

const HILITE = theme.cursor;

export function Sidebar({
  entries,
  cursor,
  focused,
  width,
  height,
  about,
}: {
  entries: Entry[];
  cursor: number;
  focused: boolean;
  width: number;
  height: number;
  /** Explanation of the highlighted entry, shown in a box below. */
  about?: string;
}) {
  const inner = width - 4;
  const aboutLines = about ? wrap(about, inner) : [];
  const aboutH = about ? Math.min(aboutLines.length + 2, Math.max(4, Math.floor(height / 3))) : 0;
  const listH = height - aboutH;
  const visible = listH - 2;
  const { start, end } = windowOf(entries.length, cursor, visible);
  return (
    <Box flexDirection="column" width={width} height={height}>
    <Panel title="MindStash" width={width} height={listH} focused={focused}>
      {entries.slice(start, end).map((e, i) => {
        const on = start + i === cursor;
        if (e.kind === 'gap') return <Text key={e.key}> </Text>;
        if (e.kind === 'header') {
          return (
            <Text key={e.key}>
              <Text color={theme.accent2} bold>
                {e.label}
              </Text>
              <Text color={theme.rule}> {'─'.repeat(Math.max(0, inner - e.label.length - 1))}</Text>
            </Text>
          );
        }
        const [left, right, color, dim] =
          e.kind === 'category'
            ? [`● ${e.label}`, String(e.count), e.color, false]
            : e.kind === 'view'
              ? [`◇ ${e.label}`, e.badge ? String(e.badge) : '', theme.accent2, false]
              : [
                  `${e.group.gone ? '✕' : '›'} ${e.group.label}`,
                  [e.group.memories && `${e.group.memories}m`, e.group.skills && `${e.group.skills}s`].filter(Boolean).join(' '),
                  e.group.gone ? theme.muted : theme.fg,
                  e.group.gone,
                ];
        const r = right ? ` ${right}` : '';
        const label = fit(left, inner - r.length);
        return (
          <Text
            key={e.key}
            backgroundColor={on && focused ? HILITE : undefined}
            color={on ? theme.accent : dim ? theme.muted : undefined}
            bold={on}
          >
            <Text color={color} backgroundColor={on && focused ? HILITE : undefined}>
              {label.slice(0, 1)}
            </Text>
            <Text backgroundColor={on && focused ? HILITE : undefined}>{label.slice(1)}</Text>
            <Text color={on ? theme.accent : e.kind === 'category' ? color : theme.warn} bold backgroundColor={on && focused ? HILITE : undefined}>
              {r}
            </Text>
          </Text>
        );
      })}
    </Panel>
    {about ? (
      <Panel title="About" width={width} height={aboutH}>
        {aboutLines.slice(0, aboutH - 2).map((t, j) => (
          <Text key={j} color={theme.fg}>
            {t}
          </Text>
        ))}
      </Panel>
    ) : null}
    </Box>
  );
}

export function List({
  title,
  rows,
  cursor,
  selected,
  focused,
  width,
  height,
  empty,
  grouped,
}: {
  title: string;
  rows: Row[];
  cursor: number;
  selected: Set<string>;
  focused: boolean;
  width: number;
  height: number;
  empty: string;
  /** Insert a coloured band before each category (the All view). */
  grouped?: boolean;
}) {
  const inner = width - 4;
  const tagW = Math.min(18, Math.max(16, Math.floor(inner * 0.18)));
  const secW = Math.min(30, Math.max(0, Math.floor(inner * 0.26)));
  const priW = Math.max(8, inner - 6 - secW - tagW - 2);
  const pos = rows.length ? `${cursor + 1}/${rows.length}` : '0';

  // Display lines: optional category bands, then rows. The cursor indexes rows only.
  type D = { band: string; color: string; count: number } | { row: Row; index: number };
  const display: D[] = [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.category ?? r.finding?.category;
    if (c) counts.set(c, (counts.get(c) ?? 0) + (r.folder ? r.folder.children.length : r.depth ? 0 : 1));
  }
  rows.forEach((row, index) => {
    const cat = row.category ?? row.finding?.category;
    const prev = rows[index - 1];
    if (grouped && cat && cat !== (prev?.category ?? prev?.finding?.category)) {
      const label = CATEGORIES.find((c) => c.id === cat)?.label ?? cat;
      display.push({ band: label, color: CATEGORY_COLOR[cat] ?? theme.fg, count: counts.get(cat) ?? 0 });
    }
    display.push({ row, index });
  });
  const at = display.findIndex((d) => 'row' in d && d.index === cursor);
  const visible = height - 3; // minus the column header
  const { start, end } = windowOf(display.length, Math.max(0, at), visible);

  return (
    <Panel title={title} right={pos} width={width} height={height} focused={focused}>
      <Text color={theme.muted} bold>
        {fit('    NAME', priW + 6)} {fit('SCOPE', secW)} {fit('TYPE', tagW, 'right')}
      </Text>
      {rows.length === 0 ? <Text color={theme.muted}>{fit(empty, inner)}</Text> : null}
      {display.slice(start, end).map((d, i) => {
        if ('band' in d) {
          const t = ` ${d.band.toUpperCase()} · ${d.count} `;
          return (
            <Text key={`b${start + i}`}>
              <Text color={d.color}>━━</Text>
              <Text color={d.color} bold>
                {t}
              </Text>
              <Text color={theme.rule}>{'─'.repeat(Math.max(0, inner - t.length - 2))}</Text>
            </Text>
          );
        }
        const { row } = d;
        const on = d.index === cursor;
        const sel = selected.has(row.key) || Boolean(row.folder?.children.every((c) => selected.has(c.key)));
        const conf = row.finding ? CONFIDENCE[row.finding.confidence] : row.pair ? theme.warn : theme.ok;
        const k = row.folder
          ? { g: row.folder.collapsed ? '▸' : '▾', color: theme.accent }
          : KIND_GLYPH[row.kind ?? ''] ?? { g: '·', color: theme.muted };
        const indent = row.depth ? '  └ ' : '';
        const bg = on ? (focused ? theme.cursor : theme.cursorDim) : sel ? theme.picked : undefined;
        const tag = fit(row.tag, tagW - 2).trimEnd();
        const tagColor = row.color || theme.ok;
        return (
          <Text key={row.key} backgroundColor={bg}>
            <Text color={on ? '#ffffff' : theme.accent} backgroundColor={bg}>{on ? '▌' : ' '}</Text>
            <Text color={theme.accent2} backgroundColor={bg}>{sel ? '◆' : ' '}</Text>
            <Text color={conf} backgroundColor={bg}>{row.finding || row.pair ? '●' : ' '}</Text>
            <Text color={k.color} backgroundColor={bg}>{` ${k.g} `}</Text>
            <Text color={theme.rule} backgroundColor={bg}>{indent}</Text>
            <Text bold={on || sel || Boolean(row.folder)} color={on ? '#ffffff' : row.folder ? theme.accent : theme.fg} backgroundColor={bg}>
              {row.folder ? fitStart(row.primary, priW - indent.length) : fit(row.primary, priW - indent.length)}
            </Text>
            <Text backgroundColor={bg}> </Text>
            <Text color={on ? '#e0e6ff' : theme.info} backgroundColor={bg}>
              {/^[~/]/.test(row.secondary) ? fitStart(row.secondary, secW) : fit(row.secondary, secW)}
            </Text>
            <Text backgroundColor={bg}>{' '.repeat(Math.max(1, tagW - tag.length - 1))}</Text>
            {/* Plain coloured text: a column of filled pills reads as one solid block. */}
            <Text color={row.tag === '✓' ? theme.ok : tagColor} backgroundColor={bg} bold={on}>
              {`${row.tag === '✓' ? '✓' : tag}  `}
            </Text>
          </Text>
        );
      })}
    </Panel>
  );
}

export function Doc({
  title,
  right,
  lines,
  offset,
  focused,
  width,
  height,
}: {
  title: string;
  right?: string;
  lines: Line[];
  offset: number;
  focused: boolean;
  width: number;
  height: number;
}) {
  const visible = height - 2;
  const shown = lines.slice(offset, offset + visible);
  const more = lines.length > offset + visible;
  return (
    <Panel
      title={title}
      right={right ?? (lines.length > visible ? `${Math.min(lines.length, offset + visible)}/${lines.length}` : undefined)}
      width={width}
      height={height}
      focused={focused}
    >
      <Lines lines={more ? [...shown.slice(0, -1), { text: '… more below (j/k)', dim: true }] : shown} width={width - 4} />
    </Panel>
  );
}

export type Mode = keyof typeof MODE_COLOR;

/** Vim-style status line: mode pill, where you are, what loads, how to get help. */
export function StatusLine({
  mode,
  crumb,
  selected,
  tokens,
  width,
}: {
  mode: Mode;
  crumb: string;
  selected: number;
  tokens: { name: string; tokens: number }[];
  width: number;
}) {
  const pill = ` ${mode} `;
  const sel = selected ? ` ◆ ${selected} selected ` : '';
  const tk = ` ${tokens.map((t) => `${t.name} ${short(t.tokens)}`).join(' · ')} tk/session `;
  const help = ' ? help  : cmd  ^p palette ';
  const room = width - pill.length - sel.length - tk.length - help.length;
  return (
    <Text>
      <Text backgroundColor={MODE_COLOR[mode]} color={theme.ink} bold>
        {pill}
      </Text>
      <Text backgroundColor={HILITE} color={theme.fg}>
        {fit(` ${crumb}`, Math.max(0, room))}
      </Text>
      {sel ? (
        <Text backgroundColor={theme.accent2} color={theme.ink}>
          {sel}
        </Text>
      ) : null}
      <Text backgroundColor={HILITE} color={theme.info}>
        {room >= 0 ? tk : ''}
      </Text>
      <Text backgroundColor={theme.border} color={theme.fg}>
        {room >= -tk.length ? help : ''}
      </Text>
    </Text>
  );
}

/** Bottom line: what you type in : or / mode, otherwise the last message or key hints. */
export function CommandLine({
  mode,
  input,
  completion,
  message,
  hints,
  width,
}: {
  mode: Mode;
  input: string;
  completion?: string;
  message?: { tone: 'ok' | 'error' | 'info'; text: string };
  hints: string;
  width: number;
}) {
  if (mode === 'COMMAND' || mode === 'SEARCH') {
    const prefix = mode === 'COMMAND' ? ':' : '/';
    return (
      <Text>
        <Text color={MODE_COLOR[mode]} bold>
          {prefix}
        </Text>
        <Text>{input}</Text>
        <Text inverse> </Text>
        {completion ? <Text color={theme.muted}>{fit(`  ${completion}`, width - input.length - 3)}</Text> : null}
      </Text>
    );
  }
  if (message) {
    const color = message.tone === 'ok' ? theme.ok : message.tone === 'error' ? theme.error : theme.info;
    return <Text color={color}>{fit(message.text, width)}</Text>;
  }
  return <Text color={theme.muted}>{fit(hints, width)}</Text>;
}
