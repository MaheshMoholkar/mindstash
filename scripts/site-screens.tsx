/**
 * Renders the real terminal UI against a demo home folder and writes each screen into
 * site/index.html, between <!-- screen:NAME --> and <!-- /screen:NAME --> markers.
 * Run after UI changes: npm run site:screens
 */
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fixture } from '../test/fixture.js';
import { sanitizePath } from '../src/core/text.js';

// Colours must be on before chalk loads, so the UI is imported after this line.
process.env.FORCE_COLOR = '3';
const { render } = await import('ink');
const { scan } = await import('../src/core/scan.js');
const { App } = await import('../src/tui/App.js');

const COLS = 120;
const ROWS = 32;
const SITE = fileURLToPath(new URL('../site/index.html', import.meta.url));

/** A fake terminal: fixed size, keeps the last frame. */
class Term extends EventEmitter {
  isTTY = true;
  columns = COLS;
  rows = ROWS;
  frame = '';
  write = (f: string) => {
    this.frame = f;
    return true;
  };
}
class Keys extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write(d: string) {
    this.data = d;
    this.emit('readable');
    this.emit('data', d);
  }
  read = () => {
    const d = this.data;
    this.data = null;
    return d;
  };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

/* ------------------------------------------------------------ demo home folder */

const fx = new Fixture();
const home = fx.home;
const api = fx.project(
  'work/api-server',
  { 'package.json': '{"name":"api-server"}', 'src/routes/users.ts': 'x', 'src/api/v2/billing.ts': 'x' },
  true,
);
fx.project('work/blog', { 'index.md': 'x' }, true);

fx.write(
  join(fx.claudeDir, 'CLAUDE.md'),
  [
    '# Working with me',
    '',
    '- Prefer small, focused commits with clear messages.',
    '- Run the linter and the tests before saying a change is done; say so when you skip them.',
    '- Ask before adding a dependency, and explain why the standard library is not enough.',
    '- Keep explanations short. Lead with the answer, then the reasoning.',
    '- Use TypeScript strict mode in new projects and avoid `any` unless there is no other way.',
    '- When a task is ambiguous, list the options with one line each and pick a default.',
    '- Never commit secrets. Read credentials from the environment.',
    '- Prefer editing existing files over creating new ones.',
    '- Write tests next to the code they cover, named after the behaviour, not the function.',
    '- Match the style of the file you are editing, even when you would format it differently.',
    '',
  ].join('\n'),
);
fx.write(
  join(api, 'CLAUDE.md'),
  '# api-server\n\n- Routes live in src/routes; validate every request body with zod.\n- Return typed errors; never throw raw strings.\n- Database access goes through the repository layer, not the route handlers.\n',
);
fx.write(join(fx.codexDir, 'AGENTS.md'), '# Defaults\n\n- Keep diffs small.\n- Ask before adding a dependency.\n- Explain trade-offs in a sentence or two.\n');

fx.memory(
  home,
  'hackathon-notes.md',
  [
    'Team hackathon Oct 15–18 2026. Demo on Friday at booth 12.',
    'Keep answers short during the event.',
    '',
    '- The demo runs from the hackathon branch; keep it deployable.',
    '- Skip refactors until judging is over.',
    '- Slides are in the team drive, in the Hackathon 2026 folder.',
    '- Priya owns the backend demo, Sam owns the slides.',
  ].join('\n'),
  { description: 'Hackathon plans and demo slot', modified: '2026-10-02' },
);
fx.memory(
  home,
  'api-server-conventions.md',
  'In ~/work/api-server, handlers live in src/routes and validate input with zod.\nRun the migrations in ~/work/api-server before the tests.',
  { description: 'How the api-server repo is laid out' },
);
fx.memory(home, 'user-role.md', 'The user is a backend developer who works mostly in TypeScript and Go.', { description: 'Who the user is' });
fx.memory(home, 'prefers-short-answers.md', 'User wants short answers with no fluff; skip long intros and get straight to the point.', {
  description: 'Answer style',
});
fx.memory(home, 'concise-responses.md', 'User wants short answers with no fluff; skip the long intros and get right to the point.', {
  description: 'Keep responses brief',
});
fx.memory(
  api,
  'old-api-endpoints.md',
  'Old billing endpoints live in `src/api/v1/billing.ts`; new ones go in `src/api/v2/billing.ts`.\nInvoices are generated nightly by the billing worker.',
  { description: 'Where billing endpoints live' },
);
fx.memory(api, 'testing.md', 'Run the test suite before committing. Tests use vitest with a local Postgres.', { description: 'How to test' });
fx.memory(api, 'node-version.md', 'Always use Node 16 for the cron runner.', { description: 'Node version' });
fx.memory(api, 'ci-setup.md', 'The cron runner must use Node 22 from now on.', { description: 'CI runtime' });
const gone = join(home, 'work', 'old-prototype');
fx.memory(gone, 'prototype-notes.md', 'The prototype talks to a mock payments API on port 4010.', { description: 'Prototype setup' });
fx.memory(gone, 'prototype-deploy.md', 'Deploy the prototype from the repo root with the fly CLI.', { description: 'Prototype deploy' });

fx.skill(join(fx.claudeDir, 'skills'), 'use-railway', 'Deploy services to Railway');
fx.plugin('railway', { 'use-railway': 'Deploy services to Railway' });
fx.skill(join(fx.claudeDir, 'skills'), 'write-changelog', 'Write a changelog entry from the git log');
fx.skill(join(fx.claudeDir, 'skills'), 'review-pr', 'Review a pull request for bugs and style');
fx.write(join(fx.codexDir, 'config.toml'), `[projects."${api}"]\ntrust_level = "trusted"\n`);
fx.skill(join(home, '.agents', 'skills'), 'db-migrations', 'Write and check database migrations');

/* ------------------------------------------------------------------ ANSI → HTML */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function toHtml(ansi: string): string {
  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false;
  let inverse = false;
  const hex = (...c: number[]) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  const emit = (text: string) => {
    const f = inverse ? (bg ?? 'var(--term-bg)') : fg;
    const b = inverse ? (fg ?? 'var(--term-fg)') : bg;
    const style = [f && `color:${f}`, b && `background:${b}`, bold && 'font-weight:700'].filter(Boolean).join(';');
    // Spans never cross a line break, so each line stands alone.
    return text
      .split('\n')
      .map((seg) => (seg && style ? `<span style="${style}">${esc(seg)}</span>` : esc(seg)))
      .join('\n');
  };
  let out = '';
  let last = 0;
  const sgr = /\x1b\[([0-9;]*)m/g;
  for (let m = sgr.exec(ansi); m; m = sgr.exec(ansi)) {
    out += emit(ansi.slice(last, m.index));
    last = sgr.lastIndex;
    const codes = m[1] ? m[1].split(';').map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) [fg, bg, bold, inverse] = [null, null, false, false];
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 7) inverse = true;
      else if (c === 27) inverse = false;
      else if (c === 39) fg = null;
      else if (c === 49) bg = null;
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const v = hex(codes[i + 2]!, codes[i + 3]!, codes[i + 4]!);
        if (c === 38) fg = v;
        else bg = v;
        i += 4;
      }
    }
  }
  return (out + emit(ansi.slice(last))).replace(/[ \t]+$/gm, '');
}

/* --------------------------------------------------------------------- sessions */

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const screens = new Map<string, string>();

/** Show the demo folder as /Users/you, in a copy of the scan result (the files stay where they are). */
const SHOWN_HOME = '/Users/you';
function asShown<T>(value: T): T {
  const swap = (s: string) =>
    s.split(fx.home).join(SHOWN_HOME).split(sanitizePath(fx.home)).join(sanitizePath(SHOWN_HOME));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

interface Run {
  firstRun?: boolean;
  /** Row the list cursor starts on. */
  cursor?: number;
  /** Use the real scan result. Needed for runs that apply fixes or read files (cost). */
  live?: boolean;
}

/** One app run. Other runs get the renamed copy of the scan result. */
async function session(run: Run, steps: (keys: Keys, term: Term) => Promise<void>) {
  const term = new Term();
  const keys = new Keys();
  const scanned = await scan(fx.ctx());
  const result = run.live ? scanned : asShown(scanned);
  const initialUi = { entryKey: 'cat:all', focus: 'main' as const, cursor: run.cursor ?? 0, sidebarHidden: false };
  const app = render(
    <App
      ctx={fx.ctx()}
      firstRun={run.firstRun ?? false}
      selfCommand="mindstash"
      initialResult={result}
      initialUi={initialUi}
      onEdit={() => {}}
    />,
    { stdout: term as never, stderr: new Term() as never, stdin: keys as never, debug: true, exitOnCtrlC: false, patchConsole: false },
  );
  await tick(150);
  await steps(keys, term);
  app.unmount();
  await tick(50);
}

async function press(keys: Keys, ...input: string[]) {
  for (const k of input) {
    keys.write(k);
    await tick();
  }
}

/** Move the list cursor (▌) onto the row whose text includes `name`. */
async function goTo(keys: Keys, term: Term, name: string) {
  const lines = plain(term.frame).split('\n');
  const at = lines.findIndex((l) => l.includes('▌'));
  const want = lines.findIndex((l) => l.includes(name));
  if (at < 0 || want < 0) throw new Error(`Row not found on screen: ${name}`);
  const n = want - at;
  await press(keys, ...Array(Math.abs(n)).fill(n > 0 ? 'j' : 'k'));
  return n;
}

const shot = (name: string, term: Term) => screens.set(name, term.frame);

// Dialog screens keep the cursor on the hackathon note, so the same preview shows behind them.
let hackathon = 0;
await session({}, async (k, t) => {
  hackathon = await goTo(k, t, 'hackathon-notes');
  shot('main', t);
  await press(k, 'l');
  shot('detail', t);
});
await session({ firstRun: true, cursor: hackathon }, async (_k, t) => {
  shot('welcome', t);
});
await session({ live: true }, async (k, t) => {
  await press(k, ...':cost', '\r');
  shot('cost', t);
});
await session({ cursor: hackathon }, async (k, t) => {
  await press(k, '\u0010', ...'sim');
  shot('palette', t);
});
await session({ cursor: hackathon }, async (k, t) => {
  await press(k, '?');
  shot('help', t);
});
// Last, because it deletes demo files.
await session({ live: true }, async (k, t) => {
  await goTo(k, t, 'old-api-endpoints');
  await press(k, ' ');
  await goTo(k, t, 'hackathon-notes');
  await press(k, ' ', 'd');
  shot('confirm', t);
  await press(k, 'y');
  await tick(300);
  shot('applied', t);
});

/* ------------------------------------------------------------- write into site */

let html = readFileSync(SITE, 'utf8');
const missing: string[] = [];
for (const [name, ansi] of screens) {
  if (plain(ansi).includes(fx.root)) throw new Error(`Screen "${name}" shows the demo's temp folder; pick another view.`);
  const re = new RegExp(`(<!-- screen:${name} -->)[\\s\\S]*?(<!-- /screen:${name} -->)`);
  if (!re.test(html)) missing.push(name);
  html = html.replace(re, (_m, open: string, close: string) => `${open}${toHtml(ansi)}${close}`);
}
writeFileSync(SITE, html);
fx.cleanup();
console.log(`Wrote ${screens.size - missing.length} screens to site/index.html${missing.length ? ` (no marker for: ${missing.join(', ')})` : ''}`);
process.exit(0);
