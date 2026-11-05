import { Box, Text } from 'ink';
import { basename, dirname, isAbsolute } from 'node:path';
import type { Entry, Row } from './data.js';
import { MODE_COLOR, theme } from './theme.js';
import { fit, Lines, Panel, short, windowOf, wrap, type Line } from './ui.js';

/** Keep the end of long paths: "…/api-server" is what tells them apart. */
const fitStart = (t: string, w: number) => (t.length > w && w > 1 ? '…' + t.slice(t.length - w + 1) : t.padEnd(w));


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
        const label = e.kind === 'scope' ? e.group.label : e.label;
        const count = e.kind === 'category' ? String(e.count) : e.kind === 'view' && e.badge ? String(e.badge) : '';
        const activeBg = on && focused ? theme.cursor : undefined;
        return (
          <Text key={e.key} backgroundColor={activeBg}>
            <Text color={on ? theme.accent : theme.fg} backgroundColor={activeBg} bold={on}>
              {fit(`${on ? '› ' : '  '}${label}`, inner - count.length - 1)}
            </Text>
            <Text color={theme.muted} backgroundColor={activeBg}>{` ${count}`}</Text>
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
}: {
  title: string;
  rows: Row[];
  cursor: number;
  selected: Set<string>;
  focused: boolean;
  width: number;
  height: number;
  empty: string;
}) {
  const inner = width - 4;
  const scopeW = Math.min(48, Math.floor(inner * 0.44));
  const nameW = inner - scopeW - 1;
  const numberW = String(rows.length).length;
  const pos = rows.length ? `${cursor + 1}/${rows.length}` : '0';
  const { start, end } = windowOf(rows.length, cursor, height - 3);

  return (
    <Panel title={title} right={pos} width={width} height={height} focused={focused}>
      <Text color={theme.muted} bold>
        {'  '}{fit('#', numberW, 'right')} {fit('NAME', nameW - numberW - 3)} {fit('SCOPE', scopeW)}
      </Text>
      {rows.length === 0 ? <Text color={theme.muted}>{fit(empty, inner)}</Text> : null}
      {rows.slice(start, end).map((row, i) => {
        const on = start + i === cursor;
        const sel = selected.has(row.key) || Boolean(row.folder?.children.every((c) => selected.has(c.key)));
        const bg = on ? (focused ? theme.cursor : theme.cursorDim) : sel ? theme.picked : undefined;
        const prefix = row.folder ? (row.folder.collapsed ? '▸ ' : '▾ ') : row.depth ? '  ' : '';
        const nameWidth = nameW - numberW - prefix.length - 3;
        const project = row.folder?.label ?? row.group?.label
          ?? (row.finding?.rule === 'missing-project' && !row.item ? row.secondary : undefined);
        const path = project && (project.startsWith('~/') || isAbsolute(project)) ? project : '';
        const name = path ? basename(path) || path : project || row.primary;
        const scope = row.depth ? '' : project ? (path && name !== path ? dirname(path) : '') : row.secondary;
        return (
          <Text key={row.key} backgroundColor={bg}>
            <Text color={theme.cursorFg} backgroundColor={bg}>{on ? '▌' : ' '}{sel ? '✓' : ' '}</Text>
            <Text color={on ? theme.cursorInfo : theme.muted} backgroundColor={bg}>
              {fit(String(start + i + 1), numberW, 'right')}{' '}
            </Text>
            <Text color={on ? theme.cursorFg : row.folder ? theme.accent : theme.fg} backgroundColor={bg} bold={on || Boolean(row.folder)}>
              {prefix}{fit(name, nameWidth)}
            </Text>
            <Text color={on ? theme.cursorInfo : theme.muted} backgroundColor={bg}>
              {' '}{/^[~/]/.test(scope) ? fitStart(scope, scopeW) : fit(scope, scopeW)}
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
  overflowHint,
  focused,
  width,
  height,
}: {
  title: string;
  right?: string;
  lines: Line[];
  offset: number;
  overflowHint: string;
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
      <Lines lines={more ? [...shown.slice(0, -1), { text: overflowHint, dim: true }] : shown} width={width - 4} />
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
  const help = mode === 'TOUR' ? ' Esc exit tour ' : ' ? help  : cmd  ^p palette ';
  const room = width - pill.length - sel.length - tk.length - help.length;
  return (
    <Text>
      <Text backgroundColor={MODE_COLOR[mode]} color={theme.ink} bold>
        {pill}
      </Text>
      <Text backgroundColor={theme.cursor} color={theme.cursorFg}>
        {fit(` ${crumb}`, Math.max(0, room))}
      </Text>
      {sel ? (
        <Text backgroundColor={theme.accent2} color={theme.ink}>
          {sel}
        </Text>
      ) : null}
      <Text backgroundColor={theme.cursor} color={theme.cursorInfo}>
        {room >= 0 ? tk : ''}
      </Text>
      <Text backgroundColor={theme.border} color={theme.ink}>
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
