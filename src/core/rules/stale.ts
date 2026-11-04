import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { RepoIndex } from '../repo.js';
import type { Finding, Item } from '../types.js';
import { clip, plural, sentences, tildify, untildify } from '../text.js';
import { findingId, memoryFixes, sumLoad, type Rule } from './context.js';

/* ------------------------------------------------------------------ */
/* Missing project: the memory belongs to a folder that no longer exists. */

export const missingProject: Rule = ({ ctx, projects, items }) => {
  const out: Finding[] = [];
  for (const p of projects) {
    if (p.exists) continue;
    const mems = items.filter((i) => i.projectKey === p.key && i.kind === 'memory');
    if (mems.length === 0) continue;
    out.push({
      id: findingId('missing-project', mems.map((m) => m.id)),
      rule: 'missing-project',
      category: 'stale',
      confidence: 'high',
      title: `${plural(mems.length, 'memory', 'memories')} for a project folder that no longer exists`,
      reasons: [
        `The project folder ${tildify(p.path, ctx.home)} was not found on disk (moved, renamed or deleted).`,
        `These memories only apply to sessions started in that folder.`,
      ],
      itemIds: mems.map((m) => m.id),
      tokens: sumLoad(mems),
      fixes: memoryFixes(mems),
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Missing path: the memory points at a file or folder that is gone. */

/** The sentence already says the path is gone, so the memory knows. */
const ACKNOWLEDGED_GONE =
  /\b(removed|deleted|no longer|nowhere|gone|missing|does ?n[o']t exist|not exist|renamed|moved)\b/i;

const PATH_CHARS = String.raw`[\w.\-@+%/]`;

/** Generated folders: often absent in a clean checkout, so their absence means nothing. */
const BUILD_DIRS = new Set([
  'dist', 'build', 'out', '.next', '.nuxt', 'node_modules', 'coverage', 'bin', 'obj', 'target',
  '.venv', 'venv', '__pycache__', '.turbo', '.cache', '.expo', 'tmp', '.tmp',
]);

export function extractPaths(text: string, home: string): { abs: string[]; rel: string[] } {
  const abs = new Set<string>();
  const rel = new Set<string>();
  const clean = (p: string) => p.replace(/[.,;:!?)\]'"]+$/, '');
  const skip = (p: string) =>
    /[*<>{}$]|\.\.\.|…|N{3,}|X{3,}|YYYY|MM-DD/.test(p) || /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
  // "dag-<id>" or "flows/$NAME": the path continues with a placeholder, so it isn't literal.
  const truncated = (src: string, end: number) => /[<{$*]/.test(src[end] ?? '');

  // ~/... and $HOME/... anywhere in the text.
  const homeRe = new RegExp(String.raw`(?:^|[\s\`'"(\[])((?:~|${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})/${PATH_CHARS}+)`, 'g');
  for (const m of text.matchAll(homeRe)) {
    const p = clean(m[1]!);
    if (truncated(text, m.index! + m[0].length)) continue;
    if (!skip(p) && p.length > 2) abs.add(untildify(p, home));
  }

  // Relative paths only inside backticks, where they are clearly paths.
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const p = clean(m[1]!);
    if (skip(p) || isAbsolute(p) || p.startsWith('~') || p.includes('@')) continue;
    if (!/^[\w.\-+%]+(\/[\w.\-+%]*)+$/.test(p)) continue;
    const segs = p.split('/').filter(Boolean);
    const first = segs[0] ?? '';
    const last = segs.at(-1) ?? '';
    // Domains and image names ("cgr.dev/x/y", "github.com/a/b") aren't local paths.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(first) && !first.startsWith('.') && segs.length > 1 && !/\.(md|json|ts|js|go|py|cs|tsx|jsx|yml|yaml|toml)$/i.test(first)) continue;
    // "owner/repo", "draft/posted/cancelled" are too ambiguous; need a file extension,
    // a trailing slash (a folder) or a dot-folder.
    // Extensions are lowercase; "JsonSettings.Apply" is a method, not a file.
    const pathy = p.endsWith('/') || first.startsWith('.') || /\.[a-z][a-z0-9]{0,5}$/.test(last);
    if (pathy && !BUILD_DIRS.has(first.replace(/\/$/, ''))) rel.add(p);
  }
  // Relative paths next to an absolute one are usually relative to it, not to the project.
  if (abs.size) rel.clear();
  return { abs: [...abs], rel: [...rel] };
}

export const missingPath: Rule = ({ ctx, items, projectOf }) => {
  const out: Finding[] = [];
  for (const item of items) {
    if (item.kind !== 'memory' && item.kind !== 'instructions') continue;
    const project = projectOf(item);
    if (project && !project.exists) continue; // covered by missing-project

    const base = item.kind === 'instructions' ? item.scope.dir ?? ctx.home : project?.path;
    const missing: string[] = [];
    for (const s of sentences(item.body)) {
      // Check the prose only: a path like `docs/missing.md` shouldn't count as "says it's missing".
      const prose = s.replace(/`[^`]*`/g, ' ').replace(/[~/][\w.\-@+%/]*/g, ' ');
      if (ACKNOWLEDGED_GONE.test(prose)) continue;
      const { abs, rel } = extractPaths(s, ctx.home);
      for (const p of abs) if (!existsSync(p)) missing.push(tildify(p, ctx.home));
      if (base) for (const p of rel) if (RepoIndex.for(base).missing(p)) missing.push(p);
    }
    const unique = [...new Set(missing)];
    if (unique.length === 0) continue;

    out.push({
      id: findingId('missing-path', [item.id]),
      rule: 'missing-path',
      category: 'stale',
      confidence: 'high',
      title: `mentions ${unique[0]}${unique.length > 1 ? ` (+${unique.length - 1} more)` : ''}, which no longer exists`,
      reasons: [
        `Refers to ${plural(unique.length, 'path')} that no longer exist${unique.length === 1 ? 's' : ''}: ${unique.slice(0, 5).join(', ')}${unique.length > 5 ? ', …' : ''}.`,
        base ? `Relative paths were checked against the files in ${tildify(base, ctx.home)}.` : '',
      ].filter(Boolean),
      itemIds: [item.id],
      // A stale line in a CLAUDE.md doesn't make the whole file waste; only count memories.
      tokens: item.kind === 'memory' ? item.loadTokens : 0,
      fixes: memoryFixes([item]),
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Past event: a date tied to an event that has already ended. */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DASH = String.raw`\s*(?:[-–—]|to|until|through)\s*`;
const ORD = '(?:st|nd|rd|th)?';

const MDY = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})${ORD}(?:${DASH}(\d{1,2})${ORD})?(?:,?\s+(\d{4}))?\b`, 'gi');
const DMY = new RegExp(String.raw`\b(\d{1,2})${ORD}(?:${DASH}(\d{1,2})${ORD})?\s+${MONTH}\.?(?:,?\s+(\d{4}))?\b`, 'gi');
const ISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;

/** Words that make a date describe an event rather than when something happened. */
const EVENT =
  /\b(hackathon|conference|meetup|meeting|interview|deadline|due|demo|launch|trip|vacation|holiday|leave|out of office|ooo|sprint|workshop|webinar|exam|appointment|event|scheduled|until|till|freeze|on-?call|travel\w*|offsite|presentation|talk|next round|expires?|ends?|upcoming|this week|next week|tomorrow)\b/i;

/** Words that mark a passing mention ("decided on Oct 3"), not an event. */
const PASSING =
  /\b(decided|said|chose|chosen|agreed|ended|parked|deployed|audit|wrote|written|created|added|submitted|finished|done|completed|shipped|fixed|as of|since|updated|rewritten|measured|finali[sz]ed|installed|asked|confirmed|switched|migrated|started|learned|noted|recorded)\b/i;

export interface FoundDate {
  end: Date;
  text: string;
}

/** All dates in a sentence; ranges count by their last day. Missing years come from `fallbackYear`. */
export function findDates(s: string, fallbackYear: number): FoundDate[] {
  const out: FoundDate[] = [];
  const mk = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59);
  const valid = (m: number, d: number) => m >= 0 && m < 12 && d >= 1 && d <= 31;

  for (const m of s.matchAll(MDY)) {
    const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()]!;
    const day = Number(m[3] ?? m[2]);
    if (valid(mon, day)) out.push({ end: mk(Number(m[4] ?? fallbackYear), mon, day), text: m[0] });
  }
  for (const m of s.matchAll(DMY)) {
    const mon = MONTHS[m[3]!.slice(0, 3).toLowerCase()]!;
    const day = Number(m[2] ?? m[1]);
    if (valid(mon, day)) out.push({ end: mk(Number(m[4] ?? fallbackYear), mon, day), text: m[0] });
  }
  for (const m of s.matchAll(ISO)) {
    const mon = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (valid(mon, day)) out.push({ end: mk(Number(m[1]), mon, day), text: m[0] });
  }
  return out;
}

/** Calendar days from a to b, so "ended Oct 18" read on Nov 4 is 17 days ago. */
function daysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / 86_400_000);
}

/**
 * A date only marks an event if it was still ahead when the memory was written
 * ("hackathon Oct 15–18", saved Oct 10). Dates already past at writing time are
 * history ("deployed 2026-09-28") and never expire.
 */
export function pastEvents(item: Item, now: Date): { snippet: string; days: number }[] {
  const hits: { snippet: string; days: number }[] = [];
  // Must be after the day it was written: same-day dates are almost always log entries.
  const written = new Date(item.modified);
  written.setHours(23, 59, 59, 999);
  for (const s of sentences(item.body)) {
    if (!EVENT.test(s) || PASSING.test(s)) continue;
    const dates = findDates(s, item.modified.getFullYear());
    if (dates.length === 0) continue;
    const last = dates.reduce((a, b) => (b.end > a.end ? b : a));
    if (last.end <= written) continue;
    const days = daysBetween(last.end, now);
    if (days >= 1) hits.push({ snippet: s, days });
  }
  return hits;
}

export const pastEvent: Rule = ({ ctx, items, projectOf }) => {
  const out: Finding[] = [];
  for (const item of items) {
    if (item.kind !== 'memory') continue;
    if (projectOf(item)?.exists === false) continue;
    const hits = pastEvents(item, ctx.now);
    if (hits.length === 0) continue;
    const ago = (d: number) => (d === 1 ? 'yesterday' : `${d} days ago`);
    out.push({
      id: findingId('past-event', [item.id]),
      rule: 'past-event',
      category: 'stale',
      confidence: 'medium',
      title: `"${clip(hits[0]!.snippet, 40)}" ended ${ago(hits[0]!.days)}`,
      reasons: hits.slice(0, 3).map((h) => `Mentions "${clip(h.snippet, 90)}", which ended ${ago(h.days)}.`),
      itemIds: [item.id],
      tokens: item.loadTokens,
      fixes: memoryFixes([item]),
    });
  }
  return out;
};
