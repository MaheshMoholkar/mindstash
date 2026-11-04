import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_LOAD_LINES, indexLinks } from '../../adapters/claude-code.js';
import { AGENTS_MAX_BYTES, agentsChainBytes } from '../../adapters/codex.js';
import { tildify } from '../text.js';
import type { Finding } from '../types.js';
import { plural, tokens } from '../text.js';
import { findingId, type Rule } from './context.js';

/** MEMORY.md longer than the agent reads. */
export const tooLong: Rule = ({ items }) => {
  const out: Finding[] = [];
  for (const idx of items) {
    if (idx.kind !== 'index' || idx.agent !== 'claude-code' || (idx.lines ?? 0) <= INDEX_LOAD_LINES) continue;
    const unseen = idx.raw.split('\n').slice(INDEX_LOAD_LINES);
    const unseenLinks = unseen.filter((l) => /\]\([^)]+\.md\)/.test(l)).length;
    out.push({
      id: findingId('too-long', [idx.id]),
      rule: 'too-long',
      category: 'index',
      confidence: 'high',
      title: `MEMORY.md is ${idx.lines} lines; only the first ${INDEX_LOAD_LINES} load`,
      reasons: [
        `Claude Code reads only the first ${INDEX_LOAD_LINES} lines of MEMORY.md.`,
        `${plural(unseen.length, 'line')} (${plural(unseenLinks, 'memory link')}) are never seen.`,
      ],
      itemIds: [idx.id],
      tokens: 0,
      fixes: ['ignore'],
    });
  }
  return out;
};

/** MEMORY.md links to a file that isn't there. */
export const brokenLink: Rule = ({ items }) => {
  const out: Finding[] = [];
  for (const idx of items) {
    if (idx.kind !== 'index' || idx.agent !== 'claude-code') continue;
    const dir = idx.path.replace(/\/MEMORY\.md$/, '');
    for (const [file, line] of indexLinks(idx.raw)) {
      if (existsSync(join(dir, file))) continue;
      out.push({
        id: findingId('broken-link', [idx.id, file]),
        rule: 'broken-link',
        category: 'index',
        confidence: 'high',
        title: `MEMORY.md links to ${file}, which doesn't exist`,
        reasons: [
          `The index line "${line.trim()}" points at a missing file.`,
          `It still loads every session (~${tokens(line)} tokens) but leads nowhere.`,
        ],
        itemIds: [idx.id],
        tokens: tokens(line),
        // "delete" here removes only the dangling index line.
        fixes: ['delete', 'ignore'],
        missingLink: file,
      });
    }
  }
  return out;
};

/** A memory file the index doesn't list: the agent won't know it exists. */
export const unindexed: Rule = ({ items }) => {
  const out: Finding[] = [];
  for (const m of items) {
    if (m.kind !== 'memory' || m.indexed || !m.indexPath) continue;
    out.push({
      id: findingId('unindexed', [m.id]),
      rule: 'unindexed',
      category: 'index',
      confidence: 'medium',
      title: `not listed in MEMORY.md, so it never loads`,
      reasons: [
        `The file exists but MEMORY.md has no link to it.`,
        `Claude Code only sees memories through the index, so this one is effectively invisible.`,
      ],
      itemIds: [m.id],
      tokens: 0,
      fixes: ['relink', 'delete', 'archive', 'ignore'],
    });
  }
  return out;
};

/** Codex stops reading AGENTS.md files once the chain passes project_doc_max_bytes (32 KiB). */
export const agentsTooLong: Rule = ({ ctx, projects, items }) => {
  const out: Finding[] = [];
  const byPath = new Map(items.map((i) => [i.path, i]));
  const seen = new Set<string>();
  for (const p of projects) {
    const chain = p.instructionChain ?? [];
    if (p.agent !== 'codex' || chain.length === 0) continue;
    const globalAgents = items.find((i) => i.agent === 'codex' && i.kind === 'instructions' && i.scope.kind === 'global');
    const all = [...(globalAgents ? [globalAgents.path] : []), ...chain];
    const bytes = agentsChainBytes(all);
    if (bytes <= AGENTS_MAX_BYTES) continue;
    const key = all.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const kib = (n: number) => `${Math.round(n / 1024)} KiB`;
    const its = chain.map((f) => byPath.get(f)).filter((i): i is NonNullable<typeof i> => Boolean(i));
    out.push({
      id: findingId('agents-too-long', its.map((i) => i.id)),
      rule: 'agents-too-long',
      category: 'index',
      confidence: 'high',
      title: `AGENTS.md files for ${tildify(p.path, ctx.home)} total ${kib(bytes)}; Codex reads ${kib(AGENTS_MAX_BYTES)}`,
      reasons: [
        `Codex stops adding AGENTS.md files once their combined size reaches ${kib(AGENTS_MAX_BYTES)} (project_doc_max_bytes).`,
        `Files nearest the working folder come last, so they are the ones cut: ${chain.map((f) => tildify(f, ctx.home)).join(' → ')}.`,
      ],
      itemIds: its.map((i) => i.id),
      tokens: 0,
      fixes: ['ignore'],
    });
  }
  return out;
};
