import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { plan, FixError } from '../src/core/fix.js';
import { cost } from '../src/core/cost.js';
import { configProjects, parseTaskGroups } from '../src/adapters/codex.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

function group(title: string, cwd: string, body: string, updated = '2026-10-14T09:46:24+00:00') {
  return [
    `# Task Group: ${title}`,
    '',
    `scope: ${title} scope line.`,
    `applies_to: cwd=${cwd}; reuse_rule=inspect first`,
    '',
    '## Task 1: something, success',
    '',
    '### rollout_summary_files',
    '',
    `- rollout_summaries/2026-10-14-x.md (cwd=${cwd}, updated_at=${updated}, thread_id=abc)`,
    '',
    '### keywords',
    '',
    '- a, b',
    '',
    '## Reusable knowledge',
    '',
    body,
    '',
  ].join('\n');
}

const codexMemory = (...groups: string[]) => fx.write(join(fx.codexDir, 'memories', 'MEMORY.md'), groups.join('\n'));
const codexConfig = (paths: string[]) =>
  fx.write(join(fx.codexDir, 'config.toml'), paths.map((p) => `[projects."${p}"]\ntrust_level = "trusted"\n`).join('\n'));

describe('codex parsing', () => {
  it('splits MEMORY.md into task groups with scope, cwd and last update', () => {
    const raw =
      group('Repo / layout fix', '/x/repo', 'Use `src/a.ts`.') +
      '# Task Group: Cache workflow\n\nscope: cache\napplies_to: workflow=Play cache\n';
    const gs = parseTaskGroups(raw);
    expect(gs.map((g) => g.title)).toEqual(['Repo / layout fix', 'Cache workflow']);
    expect(gs[0]!.cwd).toBe('/x/repo');
    expect(gs[0]!.updated?.toISOString()).toBe('2026-10-14T09:46:24.000Z');
    expect(gs[0]!.body).not.toContain('rollout_summaries/');
    expect(gs[0]!.body).toContain('### keywords');
    expect(gs[1]!.workflow).toBe('Play cache');
  });

  it('reads project folders from config.toml', () => {
    expect(configProjects('[projects."/a/b"]\ntrust_level = "x"\n[projects."/c d"]\n[other]\n')).toEqual(['/a/b', '/c d']);
  });
});

describe('codex scan', () => {
  it('finds task groups as read-only memories scoped to their folder', async () => {
    const repo = fx.project('repo', { 'src/a.ts': 'x' }, true);
    codexConfig([repo]);
    codexMemory(group('Repo work', repo, 'Code is in `src/a.ts`.'));
    fx.write(join(fx.codexDir, 'memories', 'memory_summary.md'), 'v1\n\n## User Profile\n\nPrefers short answers.\n');
    const r = await scan(fx.ctx(), { save: false });
    expect(r.agents.find((a) => a.id === 'codex')?.found).toBe(true);
    const m = r.items.find((i) => i.agent === 'codex' && i.kind === 'memory')!;
    expect(m.name).toBe('Repo work');
    expect(m.scope.label).toBe('~/repo');
    expect(m.readOnly).toBe(true);
    expect(r.findings).toHaveLength(0);
    // The summary counts toward what every Codex session loads.
    const c = cost(r, fx.home).agents.find((a) => a.agent === 'codex')!;
    expect(c.baseline.memory).toBeGreaterThan(0);
  });

  it('flags missing folders and files, but only offers "not a problem"', async () => {
    const repo = fx.project('repo', { 'src/a.ts': 'x' }, true);
    codexMemory(
      group('Gone project', join(fx.home, 'old'), 'Was in `src/x.ts`.'),
      group('Live project', repo, 'See `src/a.ts` and `src/removed-later.ts`.'),
    );
    const r = await scan(fx.ctx());
    const gone = r.findings.find((f) => f.rule === 'missing-project')!;
    const path = r.findings.find((f) => f.rule === 'missing-path')!;
    expect(gone.fixes).toEqual(['ignore']);
    expect(path.title).toContain('src/removed-later.ts');
    expect(path.reasons.join(' ')).toContain('Codex rebuilds this file');
    // Two groups share one MEMORY.md; their findings must still be distinct.
    expect(gone.id).not.toBe(path.id);
    expect(() => plan(fx.ctx(), { delete: [path.id] })).toThrow(FixError);
  });

  it('flags a skill installed twice within Codex, not across agents', async () => {
    fx.skill(join(fx.home, '.agents', 'skills'), 'use-railway', 'Deploy to Railway');
    fx.skill(join(fx.codexDir, 'skills'), 'use-railway', 'Deploy to Railway');
    fx.skill(join(fx.claudeDir, 'skills'), 'aws-cdk', 'Write CDK stacks');
    fx.skill(join(fx.home, '.agents', 'skills'), 'aws-cdk', 'Write CDK stacks');
    const dups = (await scan(fx.ctx(), { save: false })).findings.filter((f) => f.rule === 'skill-duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.title).toContain('use-railway');
  });

  it('flags an AGENTS.md chain over 32 KiB', async () => {
    const repo = fx.project('mono', { 'AGENTS.md': 'x'.repeat(20_000), 'web/AGENTS.md': 'y'.repeat(15_000) }, true);
    codexConfig([join(repo, 'web')]);
    const r = await scan(fx.ctx(), { save: false });
    const f = r.findings.find((x) => x.rule === 'agents-too-long');
    expect(f).toBeDefined();
    expect(f!.reasons[1]).toContain('mono/AGENTS.md → ~/mono/web/AGENTS.md');
  });

  it('reports cost per agent', async () => {
    fx.skill(join(fx.claudeDir, 'skills'), 'a', 'Claude skill');
    fx.skill(join(fx.home, '.agents', 'skills'), 'b', 'Codex skill with a longer description here');
    fx.write(join(fx.codexDir, 'AGENTS.md'), 'Global rules for Codex.');
    const c = cost(await scan(fx.ctx(), { save: false }), fx.home);
    expect(c.agents.map((a) => a.name)).toEqual(['Claude Code', 'Codex']);
    expect(c.agents[1]!.baseline.globalInstructions).toBeGreaterThan(0);
  });
});
