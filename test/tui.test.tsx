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
    expect(f).toContain('Browse all');
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

  it('first run: welcome, three tour pages, then skill offer', async () => {
    const { press, frame } = await app({ firstRun: true });
    expect(frame()).toContain('Welcome to MindStash');
    await press(KEY.enter);
    expect(frame()).toContain('Tour 1/3');
    await press(KEY.enter);
    expect(frame()).toContain('Tour 2/3');
    await press(KEY.enter);
    expect(frame()).toContain('Tour 3/3');
    await press(KEY.enter);
    expect(frame()).toContain('Use MindStash from your agent?');
    await press('y');
    expect(existsSync(join(fx.claudeDir, 'skills', 'mindstash', 'SKILL.md'))).toBe(true);
  });

  it('picks one file inside a multi-file finding and deletes just that one', async () => {
    const gone = join(fx.home, 'old-project');
    const first = fx.memory(gone, 'first-note.md', 'First note for the old project.');
    const second = fx.memory(gone, 'second-note.md', 'Second note for the old project.');
    const { press, frame } = await app();
    await press('/', ...'2 memories', KEY.enter, 'l');
    expect(frame()).toContain('j/k pick');
    await press('j', 'd');
    expect(frame()).toContain('Apply 1 change?');
    expect(frame()).toContain('second-note');
    await press('y');
    await tick(200);
    expect(existsSync(second)).toBe(false);
    expect(existsSync(first)).toBe(true);
  });

  it('moves only the file picked inside a multi-file finding', async () => {
    const gone = join(fx.home, 'old-project');
    const first = fx.memory(gone, 'first-note.md', 'First note for the old project.');
    const second = fx.memory(gone, 'second-note.md', 'Second note for the old project.');
    const { press, frame } = await app();
    await press('/', ...'2 memories', KEY.enter, 'l', 'j', 'm', KEY.enter);
    expect(frame()).toContain('Apply 1 change?');
    expect(frame()).toMatch(/move +second-note/);
    await press('y');
    await tick(200);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(false);
    expect(existsSync(join(fx.memoryDir(join(fx.home, 'repo')), 'second-note.md'))).toBe(true);
  });

  it('groups a long findings list into project folders', async () => {
    const repo = fx.project('mono', { 'src/a.ts': 'x' }, true);
    for (let i = 0; i < 22; i++) fx.memory(repo, `n${i}.md`, `Note ${i} points at \`src/gone/f${i}.ts\` in the repo.`);
    const { press, frame } = await app();
    expect(frame()).toContain('▸');
    expect(frame()).toContain('22 findings');
    // Move the cursor onto the ~/mono folder, then open it.
    for (let i = 0; i < 10 && !frame().split('\n').some((l) => l.includes('▌') && l.includes('~/mono')); i++) await press('j');
    await press(KEY.enter);
    expect(frame()).toContain('▾');
    expect(frame()).toContain('└');
    await press('z', 'M');
    expect(frame()).not.toContain('└');
  });
});
