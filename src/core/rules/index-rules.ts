import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_LOAD_LINES, indexLinks } from '../../adapters/claude-code.js';
import type { Finding } from '../types.js';
import { plural, tokens } from '../text.js';
import { findingId, type Rule } from './context.js';

/** MEMORY.md longer than the agent reads. */
export const tooLong: Rule = ({ items }) => {
  const out: Finding[] = [];
  for (const idx of items) {
    if (idx.kind !== 'index' || (idx.lines ?? 0) <= INDEX_LOAD_LINES) continue;
    const unseen = idx.raw.split('\n').slice(INDEX_LOAD_LINES);
    const unseenLinks = unseen.filter((l) => /\]\([^)]+\.md\)/.test(l)).length;
    out.push({
      id: findingId('too-long', [idx.path]),
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
    if (idx.kind !== 'index') continue;
    const dir = idx.path.replace(/\/MEMORY\.md$/, '');
    for (const [file, line] of indexLinks(idx.raw)) {
      if (existsSync(join(dir, file))) continue;
      out.push({
        id: findingId('broken-link', [idx.path, file]),
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
      id: findingId('unindexed', [m.path]),
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
      fixes: ['delete', 'archive', 'ignore'],
    });
  }
  return out;
};
