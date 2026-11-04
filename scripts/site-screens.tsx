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
const { scan, scanSnapshot } = await import('../src/core/scan.js');
const { setTheme } = await import('../src/tui/theme.js');
setTheme('tokyo-night', {});
const { App } = await import('../src/tui/App.js');

const ROWS = 32;
const SITE = fileURLToPath(new URL('../site/index.html', import.meta.url));

/** A fake terminal: fixed size, keeps the last frame. */
class Term extends EventEmitter {
  isTTY = true;
  constructor(readonly columns: number) {
    super();
  }
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

function seedDemo(): Fixture {
  const fx = new Fixture();
  const home = fx.home;
  const api = fx.project(
    'work/parcel-api',
    { 'package.json': '{"name":"parcel-api"}', 'src/routes/shipments.ts': 'x', 'src/api/v2/labels.ts': 'x' },
    true,
  );
  fx.write(join(api, '.nvmrc'), '22\n');
  const blog = fx.project('work/parcel-docs', { 'index.md': 'x' }, true);
  const cli = fx.project('work/warehouse-cli', { 'main.go': 'x' }, true);
  fx.memory(blog, 'publishing.md', 'Posts are written in Markdown and published from the main branch.', { description: 'How posts ship' });
  fx.memory(cli, 'release.md', 'Releases are tagged by hand and built by the release workflow.', { description: 'How releases work' });
  // A CLAUDE.md in a plain parent folder: it loads in every project below it.
  fx.write(
    join(home, 'work', 'CLAUDE.md'),
    '# Work\n\n- Use the staging database for anything that writes data.\n- Ask before running migrations.\n- Keep the parcel-api changelog up to date.\n',
  );

  // A copy-pasted deployment history adds measurable overhead to every Claude Code session.
  const deploymentHistory = Array.from({ length: 40 }, (_, i) => [
    `### Release 2.${i + 1}`,
    '- Verify the label renderer against the current carrier templates and compare the output against the sample shipments.',
    '- Check the warehouse printer queue for failed jobs, confirm the retry worker drains the queue, and save the staging trace.',
    '- Run a trial pickup, then compare the carrier manifest against the shipment ledger before handing the queue back to operations.',
    '- Record the deployment time, rollback revision, operator handoff, and follow-up items in the release ticket.',
    '',
  ].join('\n')).join('\n');
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
      '## Deployment history',
      '',
      deploymentHistory,
    ].join('\n'),
  );
  fx.write(
    join(api, 'CLAUDE.md'),
    '# parcel-api\n\n- Routes live in src/routes; validate every request body with zod.\n- Return typed errors; never throw raw strings.\n- Database access goes through the repository layer, not the route handlers.\n',
  );
  fx.write(join(fx.codexDir, 'AGENTS.md'), '# Defaults\n\n- Keep diffs small.\n- Ask before adding a dependency.\n- Explain trade-offs in a sentence or two.\n');

  fx.memory(
    home,
    'launch-checklist.md',
    [
      'Parcel beta launch Oct 15–18 2026. The pilot starts Friday at the test warehouse.',
      'Keep answers short during the event.',
      '',
      '- The demo runs from the beta branch; keep it deployable.',
      '- Skip refactors until the pilot ends.',
      '- Send the pilot guide to the warehouse team before opening enrollment.',
      '- Print a sample shipping label before the first pickup.',
    ].join('\n'),
    { description: 'Checklist for the parcel beta launch', modified: '2026-10-02' },
  );
  fx.memory(
    home,
    'parcel-api-conventions.md',
    'In ~/work/parcel-api, handlers live in src/routes and validate input with zod.\nRun the migrations in ~/work/parcel-api before the tests.',
    { description: 'How the parcel-api repo is laid out' },
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
    'label-api-v1.md',
    'Old labels endpoints live in `src/api/v1/labels.ts`; new ones go in `src/api/v2/labels.ts`.\nInvoices are generated nightly by the labels worker.',
    { description: 'Where labels endpoints live' },
  );
  fx.memory(api, 'testing.md', 'Run the test suite before committing. Tests use vitest with a local Postgres.', { description: 'How to test' });
  fx.memory(api, 'node-version.md', 'Always use Node 16 for the cron runner.', { description: 'Node version' });
  fx.memory(api, 'ci-setup.md', 'The cron runner must use Node 22 from now on.', { description: 'CI runtime' });
  const gone = join(home, 'work', 'label-poc');
  fx.memory(gone, 'label-poc-notes.md', 'The prototype talks to a mock payments API on port 4010.', { description: 'Prototype setup' });
  fx.memory(gone, 'label-poc-deploy.md', 'Deploy the prototype from the repo root with the fly CLI.', { description: 'Prototype deploy' });

  fx.skill(join(fx.claudeDir, 'skills'), 'deploy-preview', 'Create a staging deployment for a pull request');
  fx.plugin('railway', { 'deploy-preview': 'Create a staging deployment for a pull request' });
  fx.skill(join(fx.claudeDir, 'skills'), 'write-changelog', 'Write a changelog entry from the git log');
  fx.skill(join(fx.claudeDir, 'skills'), 'review-pr', 'Review a pull request for bugs and style');
  fx.write(join(fx.codexDir, 'config.toml'), `[projects."${api}"]\ntrust_level = "trusted"\n`);
  fx.skill(join(home, '.agents', 'skills'), 'db-migrations', 'Write and check database migrations');
  return fx;
}

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

const SHOWN_HOME = '/home/demo';

interface Run {
  firstRun?: boolean;
  entryKey?: string;
  /** Row the list cursor starts on. */
  cursor?: number;
}

async function press(keys: Keys, ...input: string[]) {
  for (const k of input) {
    keys.write(k);
    await tick();
  }
}

/** Move the list cursor (▌) onto the row whose text includes `name`. */
async function goTo(keys: Keys, term: Term, name: string) {
  const rows = plain(term.frame).split('\n')
    .map((line) => line.split('│')[3] ?? '')
    .filter((line) => line.trim() && !line.trimStart().startsWith('NAME'));
  const at = rows.findIndex((line) => line.includes('▌'));
  const want = rows.findIndex((line) => line.includes(name));
  if (at < 0 || want < 0) throw new Error(`Row not found on screen: ${name}`);
  const n = want - at;
  await press(keys, ...Array(Math.abs(n)).fill(n > 0 ? 'j' : 'k'));
  return n;
}

async function captureScreens(cols: number, suffix: string) {
  const fx = seedDemo();
  /** Run the real UI with the isolated workspace and a fixed demo date. */
  async function session(run: Run, steps: (keys: Keys, term: Term) => Promise<void>) {
    const term = new Term(cols);
    const keys = new Keys();
    const ctx = fx.ctx();
    const result = await scan(ctx);
    const initialUi = { entryKey: run.entryKey ?? 'cat:stale', focus: 'main' as const, cursor: run.cursor ?? 0, sidebarHidden: false };
    const app = render(
      <App
        ctx={ctx}
        refresh={() => scanSnapshot(ctx)}
        firstRun={run.firstRun ?? false}
        selfCommand="mindstash"
        initialResult={result}
        initialUi={initialUi}
        onEdit={() => {}}
      />,
      { stdout: term as never, stderr: new Term(cols) as never, stdin: keys as never, debug: true, exitOnCtrlC: false, patchConsole: false },
    );
    try {
      await tick(150);
      await steps(keys, term);
    } finally {
      app.unmount();
      await tick(50);
    }
  }

  try {
    function shot(name: string, term: Term, expected?: string) {
      if (expected && !plain(term.frame).includes(expected)) {
        throw new Error(`Screen "${name}" is missing "${expected}".\n${plain(term.frame)}`);
      }
      // Live actions need the real paths. Mask them after rendering, including paths
      // the terminal clipped with an ellipsis, while preserving the pane width.
      let frame = term.frame;
      for (const [source, shown] of [
        [fx.home, SHOWN_HOME],
        [sanitizePath(fx.home), sanitizePath(SHOWN_HOME)],
      ] as const) {
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        frame = frame.replace(new RegExp(escaped + '[^\\s\\x1b│]*', 'g'), (path) =>
          (shown + path.slice(source.length)).padEnd(path.length));
        for (let length = source.length - 1; length >= 14; length--) {
          frame = frame.replaceAll(source.slice(0, length) + '…', (shown + '/…').padEnd(length + 1));
        }
      }
      const cleaned = plain(frame);
      if (cleaned.includes(fx.root) || cleaned.includes(sanitizePath(fx.root))) {
        throw new Error(`Screen "${name}" contains a temporary workspace path.`);
      }
      screens.set(name + suffix, frame);
    }

    // Dialog screens keep the cursor on the launch note, so the same preview shows behind them.
    let launch = 0;
    await session({}, async (k, t) => {
      launch = await goTo(k, t, 'launch-checklist');
      shot('main', t, 'launch-checklist');
      await press(k, 'l');
      shot('detail', t, 'which ended');
    });
    await session({ firstRun: true, cursor: launch }, async (k, t) => {
      shot('welcome', t);
      await press(k, '\r');
      shot('tour', t, 'Tour 1/3');
    });
    await session({}, async (k, t) => {
      await press(k, ...':cost', '\r');
      shot('cost', t, 'Token cost');
    });
    await session({ cursor: launch }, async (k, t) => {
      await press(k, '\u0010', ...'sim');
      shot('palette', t);
    });
    await session({ cursor: launch }, async (k, t) => {
      await press(k, '?');
      shot('help', t);
    });
    await session({ entryKey: 'cat:scope' }, async (k, t) => {
      await goTo(k, t, 'parcel-api-conventions');
      await press(k, 'm');
      shot('move', t, 'Move to another project');
      await press(k, '\r');
      shot('move-confirm', t, '→ move parcel-api-conventions');
    });
    // Last, because it deletes demo files.
    await session({}, async (k, t) => {
      await goTo(k, t, 'label-api-v1');
      await press(k, ' ');
      await goTo(k, t, 'launch-checklist');
      await press(k, ' ');
      await goTo(k, t, 'launch-checklist'); // Space moved the cursor on; keep the long note behind the dialog
      await press(k, 'd');
      shot('confirm', t, 'Apply 2 changes?');
      await press(k, 'y');
      await tick(300);
      shot('applied', t, '2 changes applied');
    });
  } finally {
    fx.cleanup();
  }
}

await captureScreens(160, '');
await captureScreens(96, '-compact');

/* ------------------------------------------------------------- write into site */

let html = readFileSync(SITE, 'utf8');
const missing: string[] = [];
for (const [name, ansi] of screens) {
  const re = new RegExp(`(<!-- screen:${name} -->)[\\s\\S]*?(<!-- /screen:${name} -->)`);
  if (!re.test(html)) missing.push(name);
  html = html.replace(re, (_m, open: string, close: string) => `${open}${toHtml(ansi)}${close}`);
}
if (missing.length) throw new Error(`Missing site markers for: ${missing.join(', ')}`);
writeFileSync(SITE, html);
console.log(`Wrote ${screens.size} screens to site/index.html`);
process.exit(0);
