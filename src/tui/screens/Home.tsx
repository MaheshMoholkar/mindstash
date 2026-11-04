import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { baselineLine, CATEGORIES } from '../../cli/format.js';
import { plural } from '../../core/text.js';
import type { Nav } from '../types.js';
import { fmt, Header, Hints, useSize } from '../ui.js';

export function FirstRun({ nav }: { nav: Nav }) {
  useInput((input, key) => {
    if (key.return) nav.skillInstalled() ? nav.reset({ kind: 'home' }) : nav.push({ kind: 'offer-skill' });
    else nav.common(input, key);
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>MindStash</Text>
      <Text> </Text>
      <Text>Looking for agents...</Text>
      {nav.result.agents.map((a) => (
        <Text key={a.id}>
          {'  '}
          {a.found ? <Text color="green">✓</Text> : <Text color="red">✗</Text>} {a.name.padEnd(14)}
          <Text dimColor>
            {a.found
              ? `${plural(a.projects, 'project')} · ${plural(a.memories, 'memory', 'memories')} · ${plural(a.skills, 'skill')}`
              : 'not found'}
          </Text>
        </Text>
      ))}
      <Text dimColor>{'  '}Gemini CLI and Cursor support is coming.</Text>
      <Text> </Text>
      <Text>Nothing will be changed without asking you.</Text>
      <Text>Fixes are backed up and can be undone.</Text>
      <Hints keys={[['Enter', 'Continue'], ['q', 'Quit']]} />
    </Box>
  );
}

export function OfferSkill({ nav }: { nav: Nav }) {
  useInput((input, key) => {
    if (input === 'y') {
      nav.reset({ kind: 'home' });
      nav.installSkill();
    } else if (input === 'n' || key.return) nav.reset({ kind: 'home' });
    else nav.common(input, key);
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>MindStash</Text>
      <Text> </Text>
      <Text>Add the MindStash skill to your agents ({nav.result.agents.filter((a) => a.found).map((a) => a.name).join(', ')}) so you can use it from chat?</Text>
      <Text dimColor>One skill file per agent (/mindstash in Claude Code, $mindstash in Codex). Only its short description loads per session.</Text>
      <Hints keys={[['y', 'Yes, add it'], ['n', 'Not now']]} />
    </Box>
  );
}

export function Home({ nav }: { nav: Nav }) {
  const { cols } = useSize();
  const r = nav.result;
  const cats = CATEGORIES.map((c) => {
    const fs = r.findings.filter((f) => f.category === c.id);
    return { ...c, count: fs.length, tokens: fs.reduce((s, f) => s + f.tokens, 0) };
  }).filter((c) => c.count > 0);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(cats.length - 1, c + 1));
    else if (key.return && cats[cursor]) nav.push({ kind: 'findings', category: cats[cursor]!.id });
    else if (input === 'b') nav.push({ kind: 'browse' });
    else if (input === 'c') nav.push({ kind: 'cost' });
    else if (key.escape) return; // Home is the bottom of the stack
    else nav.common(input, key);
  });

  const memories = r.items.filter((i) => i.kind === 'memory').length;
  const skills = r.items.filter((i) => i.kind === 'skill').length;
  const flagged = new Set(r.findings.flatMap((f) => f.itemIds));
  const fine = r.items.filter((i) => i.kind === 'memory' && !flagged.has(i.id)).length;
  const agents = r.agents.filter((a) => a.found).map((a) => a.name).join(' · ');
  const hintW = Math.max(10, cols - 46);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title="MindStash" right={agents} />
      <Text>
        {plural(memories, 'memory', 'memories')} · {plural(skills, 'skill')}
      </Text>
      <Text dimColor>Tokens loaded in every session: {baselineLine(r)}</Text>
      <Text> </Text>
      {cats.length === 0 ? (
        <Text color="green">✓ Nothing needs attention.</Text>
      ) : (
        <>
          <Box>
            <Text bold>{'Needs attention'.padEnd(cols - 12)}</Text>
            <Text dimColor>tokens</Text>
          </Box>
          {cats.map((c, i) => (
            <Box key={c.id}>
              <Text color={i === cursor ? 'cyan' : undefined}>{i === cursor ? ' ▸ ' : '   '}</Text>
              <Text color="yellow">● </Text>
              <Text bold={i === cursor}>{String(c.count).padStart(3)}  {c.label.padEnd(16)}</Text>
              <Box width={hintW}>
                <Text dimColor wrap="truncate-end">
                  {c.hint}
                </Text>
              </Box>
              <Text>{(c.tokens ? fmt(c.tokens) : '-').padStart(8)}</Text>
            </Box>
          ))}
        </>
      )}
      <Text> </Text>
      {r.pendingChecks ? (
        <Text dimColor>   ○ {plural(r.pendingChecks, 'pair')} may disagree · ask your agent to check (/mindstash, $mindstash)</Text>
      ) : null}
      <Text color="green">   ✓ {plural(fine, 'memory looks', 'memories look')} fine</Text>
      {r.ignoredCount ? <Text dimColor>   {plural(r.ignoredCount, 'finding')} marked "not a problem"</Text> : null}
      <Hints
        keys={[
          ...(cats.length ? ([['Enter', 'Review findings']] as [string, string][]) : []),
          ['b', 'Browse all'],
          ['c', 'Cost'],
          ['u', 'Undo'],
          ['?', 'Help'],
          ['q', 'Quit'],
        ]}
      />
    </Box>
  );
}
