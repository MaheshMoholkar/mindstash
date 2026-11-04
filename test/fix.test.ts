import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { apply, FixError, moveTargetFor, plan, undo } from '../src/core/fix.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const index = (projectPath: string) => readFileSync(join(fx.memoryDir(projectPath), 'MEMORY.md'), 'utf8');

const STALE_TEXT = 'Old billing API endpoints live in `src/api/v1/old.ts` and use session cookies for auth.';

async function staleSetup() {
  const repo = fx.project('repo', { 'src/keep.ts': 'x' }, true);
  const stale = fx.memory(repo, 'stale.md', STALE_TEXT);
  const keep = fx.memory(repo, 'keep.md', 'Code lives in `src/keep.ts`.');
  const r = await scan(fx.ctx());
  const f = r.findings.find((x) => x.rule === 'missing-path')!;
  return { repo, stale, keep, f };
}

describe('apply + undo', () => {
  it('deletes a memory and its index line, then undo restores both', async () => {
    const { repo, stale, keep, f } = await staleSetup();
    const before = index(repo);
    const p = plan(fx.ctx(), { delete: [f.id] });
    expect(p.actions).toHaveLength(1);
    expect(p.tokensSaved).toBeGreaterThan(0);
    apply(fx.ctx(), p);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(keep)).toBe(true);
    expect(index(repo)).not.toContain('stale.md');
    expect(index(repo)).toContain('keep.md');

    undo(fx.ctx());
    expect(existsSync(stale)).toBe(true);
    expect(index(repo)).toBe(before);
    expect(undo(fx.ctx())).toBeUndefined();
  });

  it('archives into ~/.mindstash/archive and undo removes the copy', async () => {
    const { repo, stale, f } = await staleSetup();
    apply(fx.ctx(), plan(fx.ctx(), { archive: [f.id] }));
    expect(existsSync(stale)).toBe(false);
    const archived = join(fx.mindstashDir, 'archive', 'claude-code', repo.replace(/[^a-zA-Z0-9]/g, '-'), 'stale.md');
    expect(existsSync(archived)).toBe(true);
    undo(fx.ctx());
    expect(existsSync(stale)).toBe(true);
    expect(existsSync(archived)).toBe(false);
  });

  it('moves a wrong-scope memory to its project, index line included', async () => {
    const child = fx.project('portfolio/pagersage');
    fx.memory(child, 'x.md', 'child note');
    const src = fx.memory(fx.home, 'pagersage-plan.md', 'Build plan.');
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'wrong-scope')!;
    apply(fx.ctx(), plan(fx.ctx(), { move: [f.id] }));
    expect(existsSync(src)).toBe(false);
    expect(existsSync(join(fx.memoryDir(child), 'pagersage-plan.md'))).toBe(true);
    expect(index(child)).toContain('(pagersage-plan.md)');
    expect(index(fx.home)).not.toContain('pagersage-plan.md');
    undo(fx.ctx());
    expect(existsSync(src)).toBe(true);
    expect(index(child)).not.toContain('pagersage-plan.md');
  });

  it('rejects a batch of same-named memories headed for one destination', async () => {
    const first = fx.memory(join(fx.home, 'gone-a'), 'shared.md', 'First note');
    const second = fx.memory(join(fx.home, 'gone-b'), 'shared.md', 'Second note');
    const moveTo = moveTargetFor(fx.ctx(), fx.project('destination'));
    const result = await scan(fx.ctx());
    const move = result.findings.filter((f) => f.rule === 'missing-project').map((f) => f.id);

    expect(() => plan(fx.ctx(), { move }, { moveTo })).toThrow('more than one memory');
    expect(existsSync(first) && existsSync(second)).toBe(true);
  });

  it('leaves the source and destination untouched if a file arrives before confirmation', async () => {
    const source = fx.memory(join(fx.home, 'gone'), 'note.md', 'Source note');
    const moveTo = moveTargetFor(fx.ctx(), fx.project('destination'));
    const result = await scan(fx.ctx());
    const id = result.items.find((item) => item.path === source)!.id;
    const p = plan(fx.ctx(), { move: [id] }, { moveTo });
    const dest = fx.write(join(moveTo.memoryDir, 'note.md'), 'New destination note');

    expect(() => apply(fx.ctx(), p)).toThrow('already exists');
    expect(readFileSync(source, 'utf8')).toContain('Source note');
    expect(readFileSync(dest, 'utf8')).toBe('New destination note');
  });

  it('removes a dangling index line for a broken link', async () => {
    const repo = fx.project('repo');
    fx.memory(repo, 'a.md', 'note');
    fx.indexLine(repo, '- [Gone](gone.md) — deleted');
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'broken-link')!;
    apply(fx.ctx(), plan(fx.ctx(), { delete: [f.id] }));
    expect(index(repo)).not.toContain('gone.md');
    expect(index(repo)).toContain('a.md');
  });

  it('"not a problem" hides a finding until undone', async () => {
    const { f } = await staleSetup();
    apply(fx.ctx(), plan(fx.ctx(), { ignore: [f.id] }));
    let r = await scan(fx.ctx());
    expect(r.findings.find((x) => x.id === f.id)).toBeUndefined();
    expect(r.ignoredCount).toBe(1);
    undo(fx.ctx());
    r = await scan(fx.ctx());
    expect(r.findings.find((x) => x.id === f.id)).toBeDefined();
  });
});

describe('safety', () => {
  it('rejects ids that are not in the latest scan', async () => {
    await staleSetup();
    expect(() => plan(fx.ctx(), { delete: ['nope00'] })).toThrow(FixError);
  });

  it('rejects a fix the finding does not allow', async () => {
    const repo = fx.project('p');
    fx.memory(repo, 'a.md', 'Always run the full test suite with vitest before committing any change to the repo.');
    fx.memory(repo, 'b.md', 'Always run the full test suite with vitest before committing a change to this repo.');
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'similar')!;
    expect(() => plan(fx.ctx(), { delete: [f.id] })).toThrow(/can't be fixed with delete/);
  });

  it('refuses to touch a file changed since the scan', async () => {
    const { stale, f } = await staleSetup();
    writeFileSync(stale, readFileSync(stale, 'utf8') + '\nedited by the agent');
    expect(() => plan(fx.ctx(), { delete: [f.id] })).toThrow(/changed since the last scan/);
  });

  it('never touches read-only items like CLAUDE.md', async () => {
    const repo = fx.project('repo', {}, true);
    fx.memory(repo, 'a.md', 'note');
    fx.write(join(repo, 'CLAUDE.md'), 'Read `docs/missing.md` first.');
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'missing-path')!;
    expect(f.fixes).toEqual(['ignore']);
    expect(() => plan(fx.ctx(), { delete: [f.id] })).toThrow(FixError);
  });
});

describe('re-learning guard', () => {
  it('flags a memory the agent saves again after the user deleted it', async () => {
    const { repo, f } = await staleSetup();
    apply(fx.ctx(), plan(fx.ctx(), { delete: [f.id] }));

    // Later, the agent writes nearly the same memory again.
    const later = fx.ctx(new Date('2026-11-10T12:00:00'));
    fx.memory(repo, 'old-api-again.md', STALE_TEXT.replace('`src/api/v1/old.ts`', 'the v1 folder'), {
      modified: '2026-11-08T10:00:00Z',
    });
    const r = await scan(later);
    const re = r.findings.find((x) => x.rule === 'relearned');
    expect(re).toBeDefined();
    expect(re!.title).toContain('stale');
  });
});

describe('acting on one memory or skill directly', () => {
  it('deletes a whole skill folder by item id, and undo brings every file back', async () => {
    const skill = fx.skill(join(fx.claudeDir, 'skills'), 'old-helper', 'Helps with an old workflow');
    const ref = fx.write(join(fx.claudeDir, 'skills', 'old-helper', 'references', 'notes.md'), 'extra');
    const r = await scan(fx.ctx());
    const item = r.items.find((i) => i.kind === 'skill' && i.name === 'old-helper')!;
    const p = plan(fx.ctx(), { delete: [item.id] });
    expect(p.actions[0]!.kind).toBe('delete-skill');
    apply(fx.ctx(), p);
    expect(existsSync(skill)).toBe(false);
    expect(existsSync(ref)).toBe(false);
    undo(fx.ctx());
    expect(readFileSync(ref, 'utf8')).toBe('extra');
    expect(existsSync(skill)).toBe(true);
  });

  it('archives a skill into ~/.mindstash/archive', async () => {
    const skill = fx.skill(join(fx.claudeDir, 'skills'), 'rarely-used', 'Something rarely used');
    const r = await scan(fx.ctx());
    const item = r.items.find((i) => i.name === 'rarely-used')!;
    apply(fx.ctx(), plan(fx.ctx(), { archive: [item.id] }));
    expect(existsSync(skill)).toBe(false);
    expect(existsSync(join(fx.mindstashDir, 'archive', 'claude-code', 'skills', 'rarely-used', 'SKILL.md'))).toBe(true);
  });

  it('deletes an unflagged memory by item id, removing its index line', async () => {
    const repo = fx.project('repo');
    const m = fx.memory(repo, 'fine.md', 'A perfectly fine note the user no longer wants.');
    const r = await scan(fx.ctx());
    const item = r.items.find((i) => i.kind === 'memory')!;
    apply(fx.ctx(), plan(fx.ctx(), { delete: [item.id] }));
    expect(existsSync(m)).toBe(false);
    expect(index(repo)).not.toContain('fine.md');
  });

  it('refuses plugin skills and linked skill folders', async () => {
    fx.plugin('railway', { 'use-railway': 'Deploy to Railway' });
    const target = fx.skill(join(fx.root, 'elsewhere'), 'linked', 'A linked skill');
    const { mkdirSync, symlinkSync } = await import('node:fs');
    mkdirSync(join(fx.claudeDir, 'skills'), { recursive: true });
    symlinkSync(join(target, '..'), join(fx.claudeDir, 'skills', 'linked'));
    const r = await scan(fx.ctx());
    const plugin = r.items.find((i) => i.name === 'railway:use-railway')!;
    const linked = r.items.find((i) => i.name === 'linked')!;
    expect(() => plan(fx.ctx(), { delete: [plugin.id] })).toThrow(/Unknown id/);
    expect(() => plan(fx.ctx(), { delete: [linked.id] })).toThrow(/link to another folder/);
    expect(existsSync(target)).toBe(true);
  });
});
