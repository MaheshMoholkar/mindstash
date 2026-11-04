import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { apply, plan, undo } from '../src/core/fix.js';
import { loadState, saveState } from '../src/core/state.js';
import { installHook, installStatusLine, markSeen, sessionNote, statusText } from '../src/core/notify.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const byRule = async (rule: string) => (await scan(fx.ctx(), { save: false })).findings.filter((f) => f.rule === rule);
const index = (p: string) => readFileSync(join(fx.memoryDir(p), 'MEMORY.md'), 'utf8');

describe('new rules', () => {
  it('missing skill: flags command phrasing only, and only when not installed', async () => {
    const repo = fx.project('app');
    fx.skill(join(fx.claudeDir, 'skills'), 'comment', 'Tidy comments');
    fx.memory(repo, 'a.md', 'Always run `/old-deploy` before shipping a release.');
    fx.memory(repo, 'b.md', 'Invoke the `/comment` skill before every commit.');
    fx.memory(repo, 'c.md', 'The page lives at `/settings` in the web app.');
    const fs = await byRule('missing-skill');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.title).toContain('/old-deploy');
  });

  it('version mismatch: memory vs what the repo declares', async () => {
    const repo = fx.project('svc', { 'package.json': JSON.stringify({ engines: { node: '>=22' } }) });
    fx.memory(repo, 'a.md', 'Always build this service with Node 16.');
    fx.memory(repo, 'b.md', 'We migrated from Node 14 last year.');
    const fs = await byRule('version-mismatch');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.title).toContain('package.json engines says 22');
  });

  it('broad instructions: a CLAUDE.md in a parent folder of many projects', async () => {
    for (const n of ['a', 'b', 'c']) fx.memory(fx.project(`work/${n}`, {}, true), 'm.md', `note for ${n}`);
    fx.write(join(fx.home, 'work', 'CLAUDE.md'), 'Use the internal graph tool for everything.');
    const fs = await byRule('broad-instructions');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.title).toContain('loads in 3 projects');
  });

  it('instructions too big: names the biggest and log-like sections', async () => {
    const repo = fx.project('big', {}, true);
    fx.memory(repo, 'm.md', 'note');
    const log = Array.from({ length: 500 }, (_, i) => `- 2026-0${(i % 9) + 1}-1${i % 9} shipped thing ${i} with details`).join('\n');
    fx.write(join(repo, 'CLAUDE.md'), `# Rules\n\nUse pnpm.\n\n## History\n\n${log}\n`);
    const fs = await byRule('instructions-too-big');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.reasons[1]).toContain('History');
    expect(fs[0]!.reasons[2]).toContain('look like history');
  });

  it('codex skill budget: many long descriptions', async () => {
    for (let i = 0; i < 12; i++) fx.skill(join(fx.home, '.agents', 'skills'), `skill-${i}`, 'x'.repeat(900));
    fx.write(join(fx.codexDir, 'config.toml'), '');
    const fs = await byRule('codex-skill-budget');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.confidence).toBe('low');
  });
});

describe('relink and restore', () => {
  it('links an unlisted memory back into MEMORY.md', async () => {
    const repo = fx.project('r');
    fx.memory(repo, 'listed.md', 'listed');
    fx.memory(repo, 'lost.md', 'A useful lost note.', { indexed: false, description: 'the lost one' });
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'unindexed')!;
    expect(f.fixes).toContain('relink');
    apply(fx.ctx(), plan(fx.ctx(), { relink: [f.id] }));
    expect(index(repo)).toContain('- [lost](lost.md) — the lost one');
    expect((await scan(fx.ctx())).findings.find((x) => x.rule === 'unindexed')).toBeUndefined();
  });

  it('archive then restore puts the file and its index line back', async () => {
    const repo = fx.project('r', { 'src/a.ts': 'x' }, true);
    const m = fx.memory(repo, 'old.md', 'Old code lives in `src/gone/old.ts` here.');
    const f = (await scan(fx.ctx())).findings.find((x) => x.rule === 'missing-path')!;
    apply(fx.ctx(), plan(fx.ctx(), { archive: [f.id] }));
    expect(existsSync(m)).toBe(false);
    const [entry] = loadState(fx.mindstashDir).archived;
    expect(entry?.name).toBe('old');

    apply(fx.ctx(), plan(fx.ctx(), { restore: [entry!.id] }));
    expect(existsSync(m)).toBe(true);
    expect(index(repo)).toContain('(old.md)');
    expect(loadState(fx.mindstashDir).archived).toHaveLength(0);

    // Undoing the restore archives it again, and the archive list comes back.
    undo(fx.ctx());
    expect(existsSync(m)).toBe(false);
    expect(loadState(fx.mindstashDir).archived).toHaveLength(1);
  });

  it('restores an archived skill folder', async () => {
    const skill = fx.skill(join(fx.claudeDir, 'skills'), 'later', 'Maybe later');
    const item = (await scan(fx.ctx())).items.find((i) => i.name === 'later')!;
    apply(fx.ctx(), plan(fx.ctx(), { archive: [item.id] }));
    const id = loadState(fx.mindstashDir).archived[0]!.id;
    apply(fx.ctx(), plan(fx.ctx(), { restore: [id] }));
    expect(existsSync(skill)).toBe(true);
  });
});

describe('status line and session hook', () => {
  it('counts new findings until the user looks', async () => {
    const repo = fx.project('r', {}, true);
    fx.memory(repo, 'a.md', 'See `docs/missing.md` for the plan.');
    const r = await scan(fx.ctx());
    expect(statusText(loadState(fx.mindstashDir))).toBe('🧠 1 new · 1 to review');
    const note = sessionNote(fx.ctx());
    expect(note).toContain('1 new finding');
    expect(sessionNote(fx.ctx())).toBeUndefined(); // told once
    markSeen(fx.ctx(), r.findings.map((f) => f.id));
    expect(statusText(loadState(fx.mindstashDir))).toBe('🧠 1 to review');
  });

  it('installs next to existing hooks, and never replaces a status line', () => {
    const settings = join(fx.claudeDir, 'settings.json');
    fx.write(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] }, statusLine: { type: 'command', command: 'my-line.sh' } }));
    installHook(fx.ctx(), 'npx -y mindstash');
    installHook(fx.ctx(), 'npx -y mindstash'); // idempotent
    const s = JSON.parse(readFileSync(settings, 'utf8'));
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0].hooks[0].command).toBe('other-tool');
    expect(() => installStatusLine(fx.ctx(), 'npx -y mindstash')).toThrow(/won't replace it/);
    expect(existsSync(settings + '.mindstash-backup')).toBe(true);
    installHook(fx.ctx(), 'npx -y mindstash', true);
    expect(JSON.parse(readFileSync(settings, 'utf8')).hooks.SessionStart).toHaveLength(1);
    void saveState;
  });
});
