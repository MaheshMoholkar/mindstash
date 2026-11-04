import { Text } from 'ink';
import type { Entry, Row } from './data.js';
import { CONFIDENCE, MODE_COLOR, theme } from './theme.js';
import { fit, Lines, Panel, short, windowOf, type Line } from './ui.js';

/** Keep the end of long paths: "…/api-server" is what tells them apart. */
const fitStart = (t: string, w: number) => (t.length > w && w > 1 ? '…' + t.slice(t.length - w + 1) : t.padEnd(w));

const HILITE = '#292e42';

export function Sidebar({
  entries,
  cursor,
  focused,
  width,
  height,
}: {
  entries: Entry[];
  cursor: number;
  focused: boolean;
  width: number;
  height: number;
}) {
  const inner = width - 4;
  const visible = height - 2;
  const { start, end } = windowOf(entries.length, cursor, visible);
  return (
    <Panel title="MindStash" width={width} height={height} focused={focused}>
      {entries.slice(start, end).map((e, i) => {
        const on = start + i === cursor;
        if (e.kind === 'header') {
          return (
            <Text key={e.key} color={theme.muted} bold>
              {fit(e.label, inner)}
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
        const text = fit(left, inner - r.length) + r;
        return (
          <Text
            key={e.key}
            backgroundColor={on && focused ? HILITE : undefined}
            color={on ? theme.accent : dim ? theme.muted : undefined}
            bold={on}
          >
            {e.kind === 'category' && !on ? (
              <>
                <Text color={color}>●</Text>
                {text.slice(1)}
              </>
            ) : (
              text
            )}
          </Text>
        );
      })}
    </Panel>
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
  const visible = height - 2;
  const { start, end } = windowOf(rows.length, cursor, visible);
  const tagW = Math.min(16, Math.max(12, Math.floor(inner * 0.18)));
  const secW = Math.min(30, Math.max(0, Math.floor(inner * 0.26)));
  const priW = Math.max(8, inner - 4 - secW - tagW - 2);
  const pos = rows.length ? `${cursor + 1}/${rows.length}` : '0';
  return (
    <Panel title={title} right={pos} width={width} height={height} focused={focused}>
      {rows.length === 0 ? <Text color={theme.muted}>{fit(empty, inner)}</Text> : null}
      {rows.slice(start, end).map((row, i) => {
        const on = start + i === cursor;
        const sel = selected.has(row.key);
        const conf = row.finding ? CONFIDENCE[row.finding.confidence] : theme.ok;
        return (
          <Text key={row.key} backgroundColor={on && focused ? HILITE : undefined}>
            <Text color={theme.accent}>{on ? '▌' : ' '}</Text>
            <Text color={theme.accent2}>{sel ? '◆' : ' '}</Text>
            <Text color={row.finding || row.pair ? conf : theme.muted}>{row.finding || row.pair ? '●' : '·'}</Text>
            <Text> </Text>
            <Text bold={on} color={on ? theme.fg : undefined}>
              {fit(row.primary, priW)}
            </Text>
            <Text> </Text>
            <Text color={theme.muted}>{fitStart(row.secondary, secW)}</Text>
            <Text> </Text>
            <Text color={row.color || theme.ok}>{fit(row.tag, tagW, 'right')}</Text>
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
