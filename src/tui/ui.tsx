import { Box, Text, useStdout } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';

export function useSize(): { cols: number; rows: number } {
  const stdout = useStdout().stdout as NodeJS.WriteStream;
  const read = () => ({ cols: Math.max(60, Math.min(stdout.columns || 80, 120)), rows: Math.max(16, stdout.rows || 24) });
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

export function Header({ title, right }: { title: ReactNode; right?: ReactNode }) {
  const { cols } = useSize();
  return (
    <Box flexDirection="column">
      <Box width={cols - 1} justifyContent="space-between">
        <Text bold>{title}</Text>
        {right ? <Text dimColor>{right}</Text> : null}
      </Box>
      <Text dimColor>{'─'.repeat(cols - 2)}</Text>
    </Box>
  );
}

/** "[Enter] Open  [q] Quit", wrapped to the terminal width. */
export function Hints({ keys }: { keys: [string, string][] }) {
  return (
    <Box flexWrap="wrap" columnGap={2} marginTop={1}>
      {keys.map(([k, label]) => (
        <Text key={k + label}>
          <Text color="cyan">[{k}]</Text> {label}
        </Text>
      ))}
    </Box>
  );
}

/** Which slice of a long list to show so the cursor stays visible. */
export function windowOf(count: number, cursor: number, height: number): { start: number; end: number } {
  const h = Math.max(1, height);
  if (count <= h) return { start: 0, end: count };
  const start = Math.min(Math.max(0, cursor - Math.floor(h / 2)), count - h);
  return { start, end: start + h };
}

export function Scrollbar({ start, end, count }: { start: number; end: number; count: number }) {
  if (count <= end - start) return null;
  return (
    <Text dimColor>
      {'  '}
      {start + 1}–{end} of {count}
    </Text>
  );
}

/** Plain line-by-line text with a dim gutter, clipped to the terminal width. */
export function Content({ text, lines, offset = 0, width }: { text: string; lines: number; offset?: number; width?: number }) {
  const all = text.replace(/\s+$/, '').split('\n');
  const shown = all.slice(offset, offset + lines);
  return (
    <Box flexDirection="column" width={width}>
      {shown.map((l, i) => (
        <Text key={i} wrap="truncate-end">
          <Text dimColor>│ </Text>
          {l || ' '}
        </Text>
      ))}
      {all.length > offset + lines ? <Text dimColor>│ … {all.length - offset - lines} more lines (j/k to scroll)</Text> : null}
    </Box>
  );
}

export const CONFIDENCE_COLOR = { high: 'red', medium: 'yellow', low: 'gray' } as const;

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
};
