import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { itemsOf } from '../../cli/format.js';
import { agentName } from '../../adapters/index.js';
import { describe } from '../../core/fix.js';
import type { FixKind, Item } from '../../core/types.js';
import type { Nav } from '../types.js';
import { CONFIDENCE_COLOR, Content, fmt, Header, Hints, RULE_LABEL, useSize } from '../ui.js';

const FIX_KEYS: [string, FixKind, string][] = [
  ['d', 'delete', 'Delete'],
  ['a', 'archive', 'Archive'],
  ['m', 'move', 'Move to project'],
  ['i', 'ignore', 'Not a problem'],
];

function bodyOf(i: Item): string {
  return i.kind === 'skill' ? i.description ?? '' : i.body;
}

export function Detail({ nav, id }: { nav: Nav; id: string }) {
  const { cols, rows } = useSize();
  const [offset, setOffset] = useState(0);
  const f = nav.result.findings.find((x) => x.id === id);
  const items = f ? itemsOf(f, nav.result) : [];
  const sideBySide = items.length === 2 && (f?.rule === 'similar' || f?.rule === 'skill-overlap');

  useInput((input, key) => {
    if (!f) return nav.common(input, { escape: true });
    if (input === 'j' || key.downArrow) setOffset((o) => o + 1);
    else if (input === 'k' || key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (input === 'e') nav.edit(items.map((i) => i.path));
    else {
      const fix = FIX_KEYS.find(([k]) => k === input);
      if (fix && f.fixes.includes(fix[1])) nav.act({ [fix[1]]: [f.id] });
      else if (fix) nav.toast({ tone: 'error', text: `${RULE_LABEL[f.rule]}: ${fix[2].toLowerCase()} isn't offered here.` });
      else nav.common(input, key);
    }
  });

  // The finding is gone (fixed or ignored): nothing to show.
  if (!f) {
    return (
      <Box paddingX={1} flexDirection="column">
        <Text dimColor>This finding is resolved.</Text>
        <Hints keys={[['Esc', 'Back']]} />
      </Box>
    );
  }

  const first = items[0];
  const reasonLines = f.reasons.length + (f.tokens ? 1 : 0);
  const contentLines = Math.max(4, rows - 15 - reasonLines - (sideBySide ? 0 : items.length * 3));
  const perItem = sideBySide ? contentLines : Math.max(3, Math.floor(contentLines / Math.max(1, items.length)));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        title={sideBySide ? `${RULE_LABEL[f.rule]}` : first?.name ?? f.title}
        right={first ? `${first.scope.label} · ${agentName(first.agent)}` : undefined}
      />
      <Text>
        <Text color={CONFIDENCE_COLOR[f.confidence]}>● </Text>
        <Text bold>{f.title}</Text>
        <Text dimColor>
          {'  '}
          {f.confidence} confidence · {f.id}
        </Text>
      </Text>
      <Text> </Text>
      <Text bold>Why flagged</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {f.reasons.map((r, i) => (
          <Text key={i}>{r}</Text>
        ))}
        {f.tokens ? <Text>Costs ~{fmt(f.tokens)} tokens per session.</Text> : null}
      </Box>
      <Text> </Text>

      {items.length > 2 ? (
        <ManyItems items={items} offset={offset} height={Math.max(4, rows - 14 - reasonLines)} />
      ) : sideBySide ? (
        <Box>
          {items.map((it) => (
            <Box key={it.id} flexDirection="column" width={Math.floor((cols - 4) / 2)} marginRight={1}>
              <Text bold wrap="truncate-end">
                {it.name}
              </Text>
              <Text dimColor wrap="truncate-end">
                {it.scope.label}
              </Text>
              <Content text={bodyOf(it)} lines={perItem} offset={offset} />
            </Box>
          ))}
        </Box>
      ) : (
        items.map((it) => (
          <Box key={it.id} flexDirection="column" marginBottom={1}>
            {items.length > 1 ? (
              <Text bold>
                {it.name} <Text dimColor>· {it.scope.label}</Text>
              </Text>
            ) : (
              <Text bold>Content</Text>
            )}
            <Content text={bodyOf(it)} lines={perItem} offset={offset} />
            <Text dimColor wrap="truncate-middle">
              File  {it.path}
              {it.readOnly ? '  (read-only for MindStash)' : ''}
            </Text>
          </Box>
        ))
      )}

      {sideBySide ? <Text dimColor>These may say the same thing. MindStash won't merge them for you.</Text> : null}
      {f.moveTo ? <Text dimColor>Move target: {f.moveTo.label}</Text> : null}
      <Hints
        keys={[
          ...FIX_KEYS.filter(([, k]) => f.fixes.includes(k)).map(([k, , label]) => [k, label] as [string, string]),
          ['e', items.length > 2 ? 'Edit all in $EDITOR' : items.length > 1 ? 'Edit both in $EDITOR' : 'Edit in $EDITOR'],
          ['Esc', 'Back'],
        ]}
      />
    </Box>
  );
}

/** Findings over many files (e.g. a whole vanished project): list them, don't dump every body. */
function ManyItems({ items, offset, height }: { items: Item[]; offset: number; height: number }) {
  const start = Math.min(offset, Math.max(0, items.length - height));
  return (
    <Box flexDirection="column">
      <Text bold>{items.length} files</Text>
      {items.slice(start, start + height).map((it) => (
        <Box key={it.id}>
          <Box width={44} marginRight={2}>
            <Text wrap="truncate-end">  {it.name}</Text>
          </Box>
          <Text dimColor wrap="truncate-start">
            {it.path.split('/').pop()}
          </Text>
        </Box>
      ))}
      {items.length > height ? (
        <Text dimColor>
          {'  '}
          {start + 1}–{Math.min(items.length, start + height)} of {items.length} (j/k to scroll, e opens all)
        </Text>
      ) : null}
    </Box>
  );
}

export function ItemView({ nav, id }: { nav: Nav; id: string }) {
  const { rows } = useSize();
  const [offset, setOffset] = useState(0);
  const it = nav.result.items.find((i) => i.id === id);
  useInput((input, key) => {
    if (input === 'j' || key.downArrow) setOffset((o) => o + 1);
    else if (input === 'k' || key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (input === 'e' && it) nav.edit([it.path]);
    else nav.common(input, key);
  });
  if (!it) return <Text dimColor> Not found.</Text>;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title={it.name} right={`${it.kind} · ${it.scope.label} · ${agentName(it.agent)}`} />
      {it.description ? <Text dimColor>{it.description}</Text> : null}
      <Text color="green">✓ Nothing flagged</Text>
      <Text>
        Loads ~{fmt(it.loadTokens)} tokens per session <Text dimColor>(whole file ~{fmt(it.sizeTokens)})</Text>
      </Text>
      <Text> </Text>
      <Content text={bodyOf(it)} lines={Math.max(4, rows - 12)} offset={offset} />
      <Text dimColor wrap="truncate-middle">
        File  {it.path}
      </Text>
      <Hints keys={[['e', 'Edit in $EDITOR'], ['Esc', 'Back']]} />
    </Box>
  );
}

export function Confirm({ nav, plan }: { nav: Nav; plan: import('../../core/fix.js').Plan }) {
  useInput((input, key) => {
    if (input === 'y') nav.apply(plan);
    else if (input === 'n' || key.escape) nav.pop();
    else if (input === 'q') nav.quit();
  });
  const n = plan.actions.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Apply {n} change{n === 1 ? '' : 's'}?
      </Text>
      {plan.actions.map((a, i) => (
        <Text key={i} wrap="truncate-end">
          {'  '}
          {describe(a)}
        </Text>
      ))}
      <Text> </Text>
      {plan.tokensSaved ? <Text>Saves ~{fmt(plan.tokensSaved)} tokens per session.</Text> : null}
      <Text dimColor>A backup is saved first. Undo any time with [u] or `mindstash undo`.</Text>
      <Hints keys={[['y', 'Apply'], ['n', 'Cancel']]} />
    </Box>
  );
}

export function ConfirmUndo({ nav, op }: { nav: Nav; op: import('../../core/state.js').Operation }) {
  useInput((input, key) => {
    if (input === 'y') nav.undo();
    else if (input === 'n' || key.escape) nav.pop();
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Undo the change from {new Date(op.at).toLocaleString()}?</Text>
      {op.summary.split('\n').map((l, i) => (
        <Text key={i} wrap="truncate-end">
          {'  '}
          {l}
        </Text>
      ))}
      <Hints keys={[['y', 'Undo'], ['n', 'Cancel']]} />
    </Box>
  );
}
