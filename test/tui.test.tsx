import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { Fixture } from './fixture.js';
import { scan } from '../src/core/scan.js';
import { App } from '../src/tui/App.js';
import type { Ui } from '../src/tui/types.js';

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.cleanup());

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const KEY = { enter: '\r', esc: '\u001B', tab: '\t', ctrlP: '\u0010' };

async function app(opts: { firstRun?: boolean; ui?: Ui } = {}) {
  const repo = fx.project('repo', { 'src/keep.ts': 'x' }, true);
  const stale = fx.memory(repo, 'old-api.md', 'Old billing endpoints live in `src/api/v1/old.ts` for now.');
  fx.memory(repo, 'a.md', 'Always run the full test suite with vitest before committing any change to the repo.');
  fx.memory(repo, 'b.md', 'Always run the full test suite with vitest before committing a change to this repo.');
  const skill = fx.skill(join(fx.claudeDir, 'skills'), 'old-helper', 'Helps with an old workflow');
  const result = await scan(fx.ctx());
  const edits: string[][] = [];
  const ui = render(
    <App
      ctx={fx.ctx()}
      firstRun={opts.firstRun ?? false}
      selfCommand="mindstash"
      initialUi={opts.ui}
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
  return { press, stale, skill, edits, frame: () => ui.lastFrame() ?? '' };
}

describe('full-screen UI', () => {
  it('shows sidebar, list, preview and a vim status line', async () => {
    const { frame } = await app();
    const f = frame();
    expect(f).toContain('FINDINGS');
    expect(f).toContain('SCOPES');
    expect(f).toContain('Preview');
    expect(f).toContain('NORMAL');
    expect(f).toContain('old-api');
  });

  it('deletes after confirming, then undoes', async () => {
    const { press, frame, stale } = await app();
    const rowIdx = frame().split('\n').findIndex((l) => l.includes('old-api'));
    expect(rowIdx).toBeGreaterThan(-1);
    // Move the cursor onto old-api (rows are sorted; search narrows it).
    await press('/', ...'old-api', KEY.enter, 'd');
    expect(frame()).toContain('Apply 1 change?');
    expect(frame()).toContain('CONFIRM');
    expect(existsSync(stale)).toBe(true);
    await press('y');
    await tick(200);
    expect(existsSync(stale)).toBe(false);
    expect(frame()).toContain('1 change applied');
    await press('u');
    expect(frame()).toContain('Undo last change?');
    await press('y');
    await tick(200);
    expect(existsSync(stale)).toBe(true);
  });

  it('deletes a single skill from its scope', async () => {
    const { press, frame, skill } = await app({ ui: { entryKey: 'scope:global:claude-code', focus: 'main', cursor: 0, sidebarHidden: false } });
    expect(frame()).toContain('old-helper');
    await press('d');
    expect(frame()).toContain('delete skill old-helper');
    await press('y');
    await tick(200);
    expect(existsSync(skill)).toBe(false);
  });

  it(':commands, palette and help', async () => {
    const { press, frame } = await app();
    await press(':', ...'cost', KEY.enter);
    expect(frame()).toContain('Token cost');
    await press(':', ...'nope', KEY.enter);
    expect(frame()).toContain('Not a command: nope');
    await press(KEY.ctrlP, ...'similar');
    expect(frame()).toContain('Go to anything');
    await press(KEY.enter);
    expect(frame()).toContain('Look similar');
    await press('?');
    expect(frame()).toContain('half page');
    await press(KEY.esc);
    expect(frame()).not.toContain('half page');
  });

  it('opens detail with l and hands files to the editor with e', async () => {
    const { press, frame, edits, stale } = await app();
    await press('/', ...'old-api', KEY.enter, 'l');
    expect(frame()).toContain('WHY FLAGGED');
    await press('e');
    expect(edits).toEqual([[stale]]);
  });

  it('first run: welcome, then skill offer', async () => {
    const { press, frame } = await app({ firstRun: true });
    expect(frame()).toContain('Welcome to MindStash');
    await press(KEY.enter);
    expect(frame()).toContain('Use MindStash from your agent?');
    await press('y');
    expect(existsSync(join(fx.claudeDir, 'skills', 'mindstash', 'SKILL.md'))).toBe(true);
  });
});
