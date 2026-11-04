import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { decodeProjectKey, guessPath } from '../src/adapters/claude-code.js';
import { extractPaths, findDates } from '../src/core/rules/stale.js';
import { sanitizePath } from '../src/core/text.js';
import { signature, similarity } from '../src/core/minhash.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const rules = async () => (await scan(fx.ctx(), { save: false })).findings;
const byRule = async (rule: string) => (await rules()).filter((f) => f.rule === rule);

describe('project folder names', () => {
  it('decodes dashed names using the real folders on disk', () => {
    const a = fx.project('work/api-server');
    const b = fx.project('work/api/server');
    expect(decodeProjectKey(sanitizePath(a))).toBeDefined();
    expect([a, b]).toContain(decodeProjectKey(sanitizePath(a)));
    const c = fx.project('portfolio/my.site');
    expect(decodeProjectKey(sanitizePath(c))).toBe(c);
  });

  it('shows a readable path for folders that are gone', () => {
    fx.project('portfolio');
    const gone = join(fx.home, 'portfolio', 'old-app');
    expect(decodeProjectKey(sanitizePath(gone))).toBeUndefined();
    expect(guessPath(sanitizePath(gone))).toBe(gone);
  });
});

describe('stale: missing project', () => {
  it('flags all memories of a vanished project in one finding', async () => {
    const gone = join(fx.home, 'old-project');
    fx.memory(gone, 'a.md', 'Something about the old project build.');
    fx.memory(gone, 'b.md', 'Another note.');
    const fs = await byRule('missing-project');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.itemIds).toHaveLength(2);
    expect(fs[0]!.confidence).toBe('high');
  });

  it('does not repeat vanished-project memories under other rules', async () => {
    const gone = join(fx.home, 'old-project');
    fx.memory(gone, 'a.md', 'See `src/missing.ts` for details.', { indexed: false });
    const all = await rules();
    expect(all.map((f) => f.rule)).toEqual(['missing-project']);
  });
});

describe('stale: missing path', () => {
  it('finds home and backticked relative paths', () => {
    const { abs, rel } = extractPaths('See ~/notes/plan.md and `src/api/v1/` and `docs/a.md`.', '/Users/me');
    expect(abs).toEqual(['/Users/me/notes/plan.md']);
    expect(rel).toEqual([]); // relative paths next to an absolute one are skipped
    expect(extractPaths('Edit `src/api/v1/` and `docs/a.md`.', '/Users/me').rel).toEqual(['src/api/v1/', 'docs/a.md']);
  });

  it('ignores things that only look like paths', () => {
    const t =
      'Use `owner/repo`, `@types/node`, `cgr.dev/chainguard/minio`, `Classes/Json.Apply`, ' +
      '`docs/adr/NNNN-title.md`, `draft/posted/cancelled`, `dist/`, `https://x.dev/a.md`.';
    expect(extractPaths(t, '/Users/me').rel).toEqual([]);
  });

  it('matches partial paths anywhere in a git repo and skips gitignored ones', async () => {
    const repo = fx.project(
      'repo',
      { 'apps/api/internal/service/payments/service.go': 'package x', '.gitignore': 'generated/\n' },
      true,
    );
    fx.memory(repo, 'ok.md', 'Logic is in `service/payments/service.go`. Output goes to `generated/`.');
    fx.memory(repo, 'bad.md', 'Logic is in `service/refunds/service.go`.');
    const fs = await byRule('missing-path');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.title).toContain('service/refunds/service.go');
  });

  it('skips paths the memory already says are gone', async () => {
    const repo = fx.project('repo2', {}, true);
    fx.memory(repo, 'm.md', 'The `docs/old.md` file was removed last week.');
    expect(await byRule('missing-path')).toHaveLength(0);
  });

  it('checks absolute home paths', async () => {
    const repo = fx.project('repo3');
    fx.write(join(fx.home, 'notes', 'real.md'), 'x');
    fx.memory(repo, 'm.md', 'Plans live in ~/notes/real.md and ~/notes/gone.md.');
    const fs = await byRule('missing-path');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.reasons[0]).toContain('~/notes/gone.md');
    expect(fs[0]!.reasons[0]).not.toContain('real.md');
  });
});

describe('stale: past event', () => {
  it('parses ranges and missing years', () => {
    const [d] = findDates('hackathon Oct 15–18', 2026);
    expect(d!.end.getDate()).toBe(18);
    expect(d!.end.getMonth()).toBe(9);
    expect(findDates('on 2026-10-03', 2020)[0]!.end.getFullYear()).toBe(2026);
    expect(findDates('15-18 October 2026 trip', 2020)[0]!.end.getDate()).toBe(18);
  });

  it('flags events that were upcoming when written and have passed', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'hack.md', 'User is at the hackathon Oct 15–18 2026, keep answers short.', {
      modified: '2026-10-10T10:00:00Z',
    });
    const fs = await byRule('past-event');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.reasons[0]).toMatch(/ended 17 days ago/);
  });

  it('does not flag log entries or passing mentions', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'log.md', 'Deploy on 2026-09-28: demo reseeded.', { modified: '2026-09-28T10:00:00Z' });
    fx.memory(repo, 'dec.md', 'We decided on Oct 20 2026 to drop the meeting.', { modified: '2026-10-10T10:00:00Z' });
    fx.memory(repo, 'future.md', 'Conference is Dec 2 2026.', { modified: '2026-10-10T10:00:00Z' });
    expect(await byRule('past-event')).toHaveLength(0);
  });
});

describe('scope', () => {
  it('flags a note about one project saved in a parent folder, with a move target', async () => {
    const child = fx.project('portfolio/pagersage');
    fx.memory(fx.home, 'pagersage-plan.md', 'Build plan for the incident tool.');
    fx.memory(fx.home, 'general.md', 'User prefers short answers in every project.');
    // The child project needs to be known to Claude Code.
    fx.memory(child, 'x.md', 'Some child note here.');
    const fs = await byRule('wrong-scope');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.moveTo?.projectPath).toBe(child);
    expect(fs[0]!.fixes).toContain('move');
  });
});

describe('similar and skills', () => {
  it('minhash scores near-copies high and unrelated text low', () => {
    const a = signature('Always run the full test suite with vitest before committing any change to the repo');
    const b = signature('Always run the full test suite with vitest before committing a change to this repo');
    const c = signature('The deploy target is Railway with a Postgres database and a Redis cache');
    expect(similarity(a, b)).toBeGreaterThan(0.6);
    expect(similarity(a, c)).toBeLessThan(0.2);
  });

  it('pairs near-duplicate memories but never merges them', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'a.md', 'Always run the full test suite with vitest before committing any change to the repo.');
    fx.memory(repo, 'b.md', 'Always run the full test suite with vitest before committing a change to this repo.');
    fx.memory(repo, 'c.md', 'The deploy target is Railway with a Postgres database and Redis cache for sessions.');
    const fs = await byRule('similar');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.fixes).toEqual(['ignore']);
  });

  it('flags a skill installed both as a user skill and by a plugin', async () => {
    fx.skill(join(fx.claudeDir, 'skills'), 'use-railway', 'Deploy to Railway');
    fx.plugin('railway', { 'use-railway': 'Deploy to Railway' });
    const fs = await byRule('skill-duplicate');
    expect(fs).toHaveLength(1);
  });

  it('does not flag the same project skill in two repos (they never load together)', async () => {
    const a = fx.project('a');
    const b = fx.project('b');
    fx.memory(a, 'x.md', 'note one for project a');
    fx.memory(b, 'x.md', 'note one for project b');
    fx.skill(join(a, '.claude', 'skills'), 'slice', 'Build a vertical slice');
    fx.skill(join(b, '.claude', 'skills'), 'slice', 'Build a vertical slice');
    expect(await byRule('skill-duplicate')).toHaveLength(0);
  });
});

describe('index', () => {
  it('flags MEMORY.md over 200 lines, broken links and unlisted files', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'listed.md', 'A listed note.');
    fx.memory(repo, 'hidden.md', 'Not in the index.', { indexed: false });
    fx.indexLine(repo, '- [Gone](gone.md) — was deleted');
    for (let i = 0; i < 210; i++) fx.indexLine(repo, `line ${i}`);
    expect(await byRule('too-long')).toHaveLength(1);
    expect((await byRule('broken-link'))[0]!.missingLink).toBe('gone.md');
    expect((await byRule('unindexed'))[0]!.title).toContain('never loads');
  });
});

describe('cost', () => {
  it('counts the index line, not the whole memory file', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'big.md', 'x'.repeat(4000));
    const r = await scan(fx.ctx(), { save: false });
    const m = r.items.find((i) => i.kind === 'memory')!;
    expect(m.sizeTokens).toBeGreaterThan(1000);
    expect(m.loadTokens).toBeLessThan(30);
  });
});
