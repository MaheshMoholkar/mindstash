import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { App } from '../src/tui/App.js';
import type { Screen } from '../src/tui/types.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const KEY = { enter: '\r', esc: '\u001B', tab: '\t', down: '\u001B[B' };

async function setup() {
  const repo = fx.project('repo', { 'src/keep.ts': 'x' }, true);
  const stale = fx.memory(repo, 'old-api.md', 'Old billing endpoints live in `src/api/v1/old.ts` for now.');
  fx.memory(repo, 'a.md', 'Always run the full test suite with vitest before committing any change to the repo.');
  fx.memory(repo, 'b.md', 'Always run the full test suite with vitest before committing a change to this repo.');
  const result = await scan(fx.ctx());
  return { repo, stale, result };
}

async function app(opts: { firstRun?: boolean; stack?: Screen[] } = {}) {
  const { result, stale, repo } = await setup();
  const edits: string[][] = [];
  const ui = render(
    <App
      ctx={fx.ctx()}
      firstRun={opts.firstRun ?? false}
      selfCommand="mindstash"
      initialStack={opts.stack}
      initialResult={result}
      onEdit={(paths) => edits.push(paths)}
    />,
  );
  await tick();
  const press = async (...keys: string[]) => {
    for (const k of keys) {
      ui.stdin.write(k);
      await tick();
    }
  };
  return { ui, press, stale, repo, edits, frame: () => ui.lastFrame() ?? '' };
}

describe('terminal UI', () => {
  it('home shows what needs attention', async () => {
    const { frame } = await app();
    expect(frame()).toContain('Needs attention');
    expect(frame()).toContain('Stale');
    expect(frame()).toContain('Look similar');
    expect(frame()).toContain('[Enter] Review findings');
  });

  it('deletes from the findings list after confirming, then undoes', async () => {
    const { press, frame, stale } = await app();
    await press(KEY.enter); // open Stale
    expect(frame()).toContain('Findings › Stale');
    expect(frame()).toContain('old-api');

    await press('d');
    expect(frame()).toContain('Apply 1 change?');
    expect(existsSync(stale)).toBe(true); // nothing happens before "y"

    await press('y');
    await tick(200);
    expect(existsSync(stale)).toBe(false);
    expect(frame()).toContain('1 change applied');
    expect(frame()).toContain('[u] Undo');

    await press('u');
    expect(frame()).toContain('Undo the change');
    await press('y');
    await tick(200);
    expect(existsSync(stale)).toBe(true);
    expect(frame()).toContain('Undone');
  });

  it('cancelling a fix changes nothing', async () => {
    const { press, frame, stale } = await app();
    await press(KEY.enter, 'a', 'n');
    expect(existsSync(stale)).toBe(true);
    expect(frame()).toContain('Findings › Stale');
  });

  it('tabs between finding types and shows similar pairs side by side, suggest-only', async () => {
    const { press, frame } = await app();
    await press(KEY.enter, KEY.tab);
    expect(frame()).toContain('Findings › Look similar');
    await press(KEY.enter);
    expect(frame()).toContain('look similar');
    expect(frame()).toContain("won't merge them");
    expect(frame()).not.toContain('[d] Delete');
    await press('d');
    expect(frame()).toContain("isn't offered here");
  });

  it('e hands the files to the editor', async () => {
    const { press, edits, stale } = await app();
    await press(KEY.enter, KEY.enter, 'e');
    expect(edits).toEqual([[stale]]);
  });

  it('search filters the list', async () => {
    const { press, frame } = await app({ stack: [{ kind: 'home' }, { kind: 'findings', category: 'stale' }] });
    await press('/', 'z', 'z', 'z', KEY.enter);
    expect(frame()).toContain('No matches');
  });

  it('browse groups memories by scope and marks flagged ones', async () => {
    const { press, frame } = await app();
    await press('b');
    expect(frame()).toContain('Global (Claude Code)');
    expect(frame()).toContain('~/repo');
    await press(KEY.down, KEY.enter);
    expect(frame()).toContain('old-api');
    expect(frame()).toMatch(/● stale/);
  });

  it('first run lists agents, then offers the skill', async () => {
    const { press, frame } = await app({ firstRun: true });
    expect(frame()).toContain('Looking for agents');
    expect(frame()).toContain('Claude Code');
    await press(KEY.enter);
    expect(frame()).toContain('Add /mindstash to Claude Code');
    await press('y');
    expect(existsSync(join(fx.claudeDir, 'skills', 'mindstash', 'SKILL.md'))).toBe(true);
    expect(frame()).toContain('Needs attention');
  });

  it('cost screen shows per-project totals', async () => {
    const { press, frame } = await app();
    await press('c');
    expect(frame()).toContain('Token cost');
    expect(frame()).toContain('~/repo');
  });
});
