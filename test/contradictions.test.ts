import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { candidates, pending } from '../src/core/contradictions.js';
import { loadState, saveState } from '../src/core/state.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const PROMPTS_RULE = 'Always append each new prompt entry to the PROMPTS.md log after every change.';
const PROMPTS_FROZEN = 'Never append another prompt entry to the PROMPTS.md log; the user froze it.';

async function pairsNow() {
  const r = await scan(fx.ctx(), { save: false });
  return candidates(r.items, r.projects).pairs;
}

describe('contradiction candidates', () => {
  it('pairs a CLAUDE.md rule with a memory that says the opposite', async () => {
    const repo = fx.project('site');
    fx.write(join(repo, 'CLAUDE.md'), `# Rules\n\n${PROMPTS_RULE}\n`);
    fx.memory(repo, 'frozen.md', PROMPTS_FROZEN);
    fx.memory(repo, 'other.md', 'Always use the design tokens from the theme file for colors.');
    const pairs = await pairsNow();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.cue).toContain('one says not to');
    expect([pairs[0]!.a.kind, pairs[0]!.b.kind].sort()).toEqual(['instructions', 'memory']);
  });

  it('spots different versions of the same tool', async () => {
    const repo = fx.project('api');
    fx.memory(repo, 'a.md', 'Always use Node 16 for the api build server.');
    fx.memory(repo, 'b.md', 'The api build server must use Node 22 from now on.');
    const pairs = await pairsNow();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.cue).toBe('node 16 vs node 22');
  });

  it('ignores pairs that never load together', async () => {
    const a = fx.project('one');
    const b = fx.project('two');
    fx.memory(a, 'a.md', PROMPTS_RULE);
    fx.memory(b, 'b.md', PROMPTS_FROZEN);
    expect(await pairsNow()).toHaveLength(0);
  });

  it('ignores log lines that merely mention the same words', async () => {
    const repo = fx.project('log');
    fx.memory(repo, 'a.md', 'Shipped the prompt entry log export to PROMPTS.md on Tuesday.');
    fx.memory(repo, 'b.md', 'The PROMPTS.md log had no prompt entry for the export, which was not tested.');
    expect(await pairsNow()).toHaveLength(0);
  });
});

describe('verdicts', () => {
  async function judge(verdict: 'conflict' | 'duplicate' | 'ok') {
    const r = await scan(fx.ctx(), { save: false });
    const state = loadState(fx.mindstashDir);
    const { pairs } = pending(state, r.items, r.projects);
    const p = pairs[0]!;
    state.verdicts[p.id] = { verdict, reason: 'The rule says append; the memory says never.', at: '2026-11-04T12:00:00.000Z', hashes: [p.a.hash, p.b.hash], pair: p };
    saveState(fx.mindstashDir, state);
    return p;
  }

  it('a judged conflict becomes a finding, and reopens when a file changes', async () => {
    const repo = fx.project('site');
    fx.write(join(repo, 'CLAUDE.md'), PROMPTS_RULE);
    const mem = fx.memory(repo, 'frozen.md', PROMPTS_FROZEN);
    let r = await scan(fx.ctx());
    expect(r.pendingChecks).toBe(1);

    await judge('conflict');
    r = await scan(fx.ctx());
    const f = r.findings.find((x) => x.rule === 'contradiction');
    expect(f?.category).toBe('contradiction');
    expect(f?.reasons[0]).toContain('append');
    expect(f?.fixes).toEqual(['ignore']);
    expect(r.pendingChecks).toBe(0);

    // The user edits the memory: the old verdict no longer applies.
    appendFileSync(mem, '\nUpdated by the user.\n');
    r = await scan(fx.ctx());
    expect(r.findings.find((x) => x.rule === 'contradiction')).toBeUndefined();
    expect(r.pendingChecks).toBe(1);
  });

  it('"ok" hides the pair; "duplicate" shows under Look similar', async () => {
    const repo = fx.project('site');
    fx.write(join(repo, 'CLAUDE.md'), PROMPTS_RULE);
    fx.memory(repo, 'frozen.md', PROMPTS_FROZEN);
    await judge('ok');
    let r = await scan(fx.ctx());
    expect(r.pendingChecks).toBe(0);
    expect(r.findings).toHaveLength(0);

    writeFileSync(join(fx.mindstashDir, 'state.json'), JSON.stringify({ ...loadState(fx.mindstashDir), verdicts: {} }));
    await judge('duplicate');
    r = await scan(fx.ctx());
    expect(r.findings.find((x) => x.rule === 'duplicate-checked')?.category).toBe('similar');
  });
});
