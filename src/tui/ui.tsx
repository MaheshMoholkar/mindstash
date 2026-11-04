import { Box, Text, useStdout } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { theme } from './theme.js';

export function useSize(): { cols: number; rows: number } {
  const stdout = useStdout().stdout as NodeJS.WriteStream;
  const read = () => ({ cols: Math.max(60, stdout.columns || 100), rows: Math.max(18, stdout.rows || 30) });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    stdout.on('resize', on);
    return () => {
      stdout.off('resize', on);
    };
  }, [stdout]);
  return size;
}

export const fmt = (n: number) => n.toLocaleString('en-US');

/** "14,540" → "15k" for tight spaces. */
export function short(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Clip or pad to exactly `width` columns. */
export function fit(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return '';
  const t = text.replace(/\s+/g, ' ');
  if (t.length > width) return width === 1 ? '…' : t.slice(0, width - 1) + '…';
  return align === 'left' ? t.padEnd(width) : t.padStart(width);
}

/** Word-wrap each line to `width`, keeping list indents. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(10, width);
  const out: string[] = [];
  for (const raw of text.replace(/\t/g, '  ').split('\n')) {
    if (raw.length <= w) {
      out.push(raw);
      continue;
    }
    const indent = /^\s*(?:[-*>]\s+|\d+\.\s+)?/.exec(raw)?.[0].length ?? 0;
    const pad = ' '.repeat(Math.min(indent, Math.floor(w / 3)));
    let line = '';
    for (const word of raw.split(/(\s+)/)) {
      if ((line + word).length > w && line.trim()) {
        out.push(line.trimEnd());
        line = pad + word.trimStart();
      } else line += word;
      while (line.length > w) {
        out.push(line.slice(0, w));
        line = pad + line.slice(w);
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

/** Which slice of a long list to show so the cursor stays visible. */
export function windowOf(count: number, cursor: number, height: number): { start: number; end: number } {
  const h = Math.max(1, height);
  if (count <= h) return { start: 0, end: count };
  const start = Math.min(Math.max(0, cursor - Math.floor(h / 2)), count - h);
  return { start, end: start + h };
}

/** A rounded panel with its title set into the top border. */
export function Panel({
  title,
  right,
  width,
  height,
  focused,
  children,
}: {
  title: string;
  right?: string;
  width: number;
  height: number;
  focused?: boolean;
  children?: ReactNode;
}) {
  const color = focused ? theme.accent : theme.border;
  const inner = width - 2;
  const r = right ? ` ${right} ` : '';
  const t = ` ${fit(title, Math.max(4, inner - 6 - r.length)).trimEnd()} `;
  const fill = Math.max(0, inner - 2 - t.length - r.length);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text>
        <Text color={color}>╭─</Text>
        <Text color={focused ? theme.accent : theme.fg} bold>
          {t}
        </Text>
        <Text color={color}>{'─'.repeat(fill)}</Text>
        <Text color={theme.muted}>{r}</Text>
        <Text color={color}>─╮</Text>
      </Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        flexDirection="column"
        width={width}
        height={height - 1}
        paddingX={1}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
}

/** A styled line, as produced by the document builders in doc.ts. */
export interface Line {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  /** Quote gutter, for file content. */
  gutter?: boolean;
}

export function Lines({ lines, width }: { lines: Line[]; width: number }) {
  return (
    <>
      {lines.map((l, i) => (
        <Text key={i} wrap="truncate-end">
          {l.gutter ? <Text color={theme.border}>│ </Text> : null}
          <Text color={l.color ?? (l.dim ? theme.muted : theme.fg)} bold={l.bold}>
            {fit(l.text, l.gutter ? width - 2 : width).trimEnd() || ' '}
          </Text>
        </Text>
      ))}
    </>
  );
}
