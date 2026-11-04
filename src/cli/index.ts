import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import chalk from 'chalk';
import { defaultContext, scan } from '../core/scan.js';
import { apply, describe, FixError, plan, undo, type Requests } from '../core/fix.js';
import { cost } from '../core/cost.js';
import { loadState, saveState } from '../core/state.js';
import { pending } from '../core/contradictions.js';
import { installHook, installStatusLine, markSeen, refreshInBackground, sessionNote, statusText } from '../core/notify.js';
import { clip, tildify } from '../core/text.js';
import type { Finding, ScanResult } from '../core/types.js';
import { costReport, itemsOf, scanReport, showFinding } from './format.js';
import { installSkills, skillInstalled } from './skill.js';

const VERSION = '0.3.0';

function findingJson(f: Finding, r: ScanResult, withBody = false) {
  return {
    ...f,
    items: itemsOf(f, r).map((i) => ({
      id: i.id,
      agent: i.agent,
      kind: i.kind,
      name: i.name,
      description: i.description,
      path: i.path,
      scope: i.scope.label,
      loadTokens: i.loadTokens,
      readOnly: i.readOnly,
      modified: i.modified.toISOString(),
      ...(withBody ? { body: i.body } : {}),
    })),
  };
}

function summaryJson(r: ScanResult) {
  const byCategory: Record<string, number> = {};
  for (const f of r.findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  return {
    memories: r.items.filter((i) => i.kind === 'memory').length,
    skills: r.items.filter((i) => i.kind === 'skill').length,
    findings: r.findings.length,
    ignored: r.ignoredCount,
    pendingChecks: r.pendingChecks,
    byCategory,
    flaggedTokens: r.findings.reduce((n, f) => n + f.tokens, 0),
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/** Accept both "--delete a b" and "--delete a,b". */
function ids(v?: string[]): string[] | undefined {
  return v?.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
}

/** How the installed skill should call MindStash. */
function selfCommand(): string {
  if (process.env.MINDSTASH_CMD) return process.env.MINDSTASH_CMD;
  const script = process.argv[1] ?? '';
  if (script.includes('_npx') || !script) return 'npx -y mindstash';
  try {
    return `node ${realpathSync(script)}`;
  } catch {
    return 'npx -y mindstash';
  }
}

const program = new Command()
  .name('mindstash')
  .description('See, scope and clean up what your AI agents know.')
  .version(VERSION)
  .enablePositionalOptions();

function scanCommand(cmd: Command) {
  return cmd
    .option('--json', 'machine-readable output')
    .option('--full', 'list every finding')
    .option('--include-ignored', 'include findings marked "not a problem"')
    .addOption(new Option('--background').hideHelp());
}

async function runScan(opts: { json?: boolean; full?: boolean; includeIgnored?: boolean; background?: boolean }) {
  const ctx = defaultContext();
  const r = await scan(ctx, { includeIgnored: opts.includeIgnored });
  // A background refresh (status line / hook) isn't the user looking.
  if (!opts.background) markSeen(ctx, r.findings.map((f) => f.id));
  if (opts.background) return;
  if (opts.json) {
    console.log(
      JSON.stringify(
        { at: r.at, agents: r.agents, summary: summaryJson(r), findings: r.findings.map((f) => findingJson(f, r)) },
        null,
        2,
      ),
    );
  } else {
    console.log(scanReport(r, { full: opts.full }));
    if (process.stdout.isTTY && !skillInstalled(ctx)) {
      console.log(chalk.dim(' Tip: `mindstash install-skill` adds the MindStash skill to your agents.'));
    }
  }
}

// No command: interactive UI in a terminal, plain report anywhere else.
scanCommand(program).action(async (opts: { json?: boolean; full?: boolean; includeIgnored?: boolean }) => {
  const interactive =
    process.stdout.isTTY && process.stdin.isTTY && !opts.json && !opts.full && !process.env.CI && process.env.TERM !== 'dumb';
  if (!interactive) return runScan(opts);
  // Loaded only here, so plain commands (and hooks) never pay for Ink and React.
  const { runTui } = await import('../tui/run.js');
  await runTui(defaultContext(), selfCommand());
});
scanCommand(program.command('scan').description('scan memories and skills and report what looks wrong')).action(runScan);

program
  .command('show <id>')
  .description('explain one finding and show the files involved')
  .option('--json', 'machine-readable output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const ctx = defaultContext();
    const r = await scan(ctx, { includeIgnored: true });
    const f = r.findings.find((x) => x.id === id);
    if (!f) {
      console.error(`No finding "${id}". Run \`mindstash scan\` to see current ids.`);
      process.exitCode = 1;
      return;
    }
    console.log(opts.json ? JSON.stringify(findingJson(f, r, true), null, 2) : showFinding(f, r));
  });

program
  .command('apply')
  .description('apply fixes to findings from the latest scan (backed up, undoable)')
  .option('--delete <ids...>', 'delete these memories')
  .option('--archive <ids...>', 'hide from the agent, keep a copy in ~/.mindstash/archive')
  .option('--move <ids...>', 'move to the suggested project')
  .option('--ignore <ids...>', 'mark as "not a problem"')
  .option('--relink <ids...>', 'add an unlisted memory back into MEMORY.md')
  .option('-y, --yes', 'apply without asking')
  .action(async (opts: { delete?: string[]; archive?: string[]; move?: string[]; ignore?: string[]; relink?: string[]; yes?: boolean }) => {
    const ctx = defaultContext();
    const req: Requests = {
      delete: ids(opts.delete),
      archive: ids(opts.archive),
      move: ids(opts.move),
      ignore: ids(opts.ignore),
      relink: ids(opts.relink),
    };
    if (!Object.values(req).some((v) => v?.length)) {
      console.error('Nothing to apply. Example: mindstash apply --delete a1b2c3 --ignore d4e5f6');
      process.exitCode = 1;
      return;
    }
    try {
      const p = plan(ctx, req);
      if (p.actions.length === 0) {
        console.log('Nothing to change.');
        return;
      }
      console.log(` Apply ${p.actions.length} change${p.actions.length === 1 ? '' : 's'}?`);
      for (const a of p.actions) console.log('   ' + describe(a));
      console.log(chalk.dim('\n A backup is saved first. Undo any time with `mindstash undo`.\n'));
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.error('Not applied: re-run with --yes to confirm.');
          process.exitCode = 2;
          return;
        }
        if (!(await confirm(' [y] Apply  [n] Cancel  ')) ) {
          console.log(' Cancelled.');
          return;
        }
      }
      apply(ctx, p);
      const saved = p.tokensSaved ? ` · saved ~${p.tokensSaved.toLocaleString('en-US')} tokens per session` : '';
      console.log(chalk.green(` ✓ ${p.actions.length} change${p.actions.length === 1 ? '' : 's'} applied${saved}`) + chalk.dim(' · undo: mindstash undo'));
    } catch (e) {
      if (e instanceof FixError) {
        console.error(e.message);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
  });

program
  .command('archived')
  .description('list what MindStash archived (restore with `mindstash restore <id>`)')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) => {
    const ctx = defaultContext();
    const list = loadState(ctx.mindstashDir).archived;
    if (opts.json) return console.log(JSON.stringify(list, null, 2));
    if (!list.length) return console.log(' Nothing archived.');
    for (const a of list) {
      console.log(`   ${chalk.cyan(a.id)}  ${chalk.bold(a.name)}  ${chalk.dim(`${a.kind} · ${a.scope} · ${a.at.slice(0, 10)}`)}`);
    }
  });

program
  .command('restore <ids...>')
  .description('put archived items back where they were')
  .option('-y, --yes', 'restore without asking')
  .action(async (list: string[], opts: { yes?: boolean }) => {
    const ctx = defaultContext();
    try {
      const p = plan(ctx, { restore: ids(list) });
      for (const a of p.actions) console.log('   ' + describe(a));
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.error('Not restored: re-run with --yes to confirm.');
          process.exitCode = 2;
          return;
        }
        if (!(await confirm(' [y] Restore  [n] Cancel  '))) return;
      }
      apply(ctx, p);
      console.log(chalk.green(` ✓ Restored ${p.actions.length}.`) + chalk.dim(' · undo: mindstash undo'));
    } catch (e) {
      if (e instanceof FixError) {
        console.error(e.message);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
  });

program
  .command('statusline')
  .description('one-line status for Claude Code (reads the cached scan; never slow)')
  .action(() => {
    const ctx = defaultContext();
    try {
      console.log(statusText(loadState(ctx.mindstashDir)));
      refreshInBackground(ctx, process.argv[1]);
    } catch {
      console.log('🧠 mindstash');
    }
  });

program
  .command('hook <event>')
  .description('hook entry point (session-start): tells you about new findings once')
  .action((event: string) => {
    const ctx = defaultContext();
    if (event !== 'session-start') return;
    try {
      const note = sessionNote(ctx);
      if (note) console.log(JSON.stringify({ systemMessage: note }));
      refreshInBackground(ctx, process.argv[1]);
    } catch {
      /* a hook must never break the session */
    }
  });

program
  .command('install-statusline')
  .description('show MindStash in the Claude Code status line (opt-in)')
  .option('--remove', 'take it out again')
  .action((opts: { remove?: boolean }) => {
    try {
      console.log(' ' + installStatusLine(defaultContext(), selfCommand(), opts.remove));
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('install-hook')
  .description('tell you about new findings when a Claude Code session starts (opt-in)')
  .option('--remove', 'take it out again')
  .action((opts: { remove?: boolean }) => {
    try {
      console.log(' ' + installHook(defaultContext(), selfCommand(), opts.remove));
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('check')
  .description('list pairs that may contradict each other, for your agent to judge')
  .option('--json', 'machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const ctx = defaultContext();
    const r = await scan(ctx);
    const state = loadState(ctx.mindstashDir);
    const { pairs, total } = pending(state, r.items, r.projects);
    state.lastCheck = { at: ctx.now.toISOString(), pairs };
    saveState(ctx.mindstashDir, state);
    if (opts.json) {
      console.log(JSON.stringify({ at: ctx.now, pending: total, pairs }, null, 2));
      return;
    }
    if (!pairs.length) {
      console.log(chalk.green(' ✓ No pairs waiting to be checked.'));
      return;
    }
    console.log(` ${chalk.bold(`${total} pair${total === 1 ? '' : 's'} may disagree`)}${total > pairs.length ? chalk.dim(` (showing ${pairs.length})`) : ''}`);
    console.log(chalk.dim(' MindStash only finds candidates. Ask your agent (/mindstash in Claude Code, $mindstash in Codex) to judge them.\n'));
    for (const p of pairs) {
      console.log(`   ${chalk.cyan(p.id)}  ${chalk.dim(p.cue)}`);
      console.log(`     ${chalk.bold(p.a.name)} ${chalk.dim(p.a.scope)}: ${clip(p.a.snippet, 90)}`);
      console.log(`     ${chalk.bold(p.b.name)} ${chalk.dim(p.b.scope)}: ${clip(p.b.snippet, 90)}`);
    }
  });

program
  .command('judge <id>')
  .description("record your agent's verdict on a pair from `mindstash check`")
  .option('--conflict <reason>', 'the two disagree; say how')
  .option('--duplicate <reason>', 'they say the same thing')
  .option('--ok [reason]', 'no problem')
  .option('--clear', 'forget the verdict')
  .action((id: string, opts: { conflict?: string; duplicate?: string; ok?: string | boolean; clear?: boolean }) => {
    const ctx = defaultContext();
    const state = loadState(ctx.mindstashDir);
    if (opts.clear) {
      const had = Boolean(state.verdicts[id]);
      delete state.verdicts[id];
      saveState(ctx.mindstashDir, state);
      console.log(had ? ' ✓ Verdict cleared.' : ' No verdict for that id.');
      return;
    }
    const given = [opts.conflict !== undefined, opts.duplicate !== undefined, opts.ok !== undefined].filter(Boolean).length;
    if (given !== 1) {
      console.error('Give exactly one of --conflict "<reason>", --duplicate "<reason>" or --ok.');
      process.exitCode = 1;
      return;
    }
    const pair = state.lastCheck?.pairs.find((p) => p.id === id);
    if (!pair) {
      console.error(`Unknown pair "${id}". Ids come from the latest \`mindstash check\`.`);
      process.exitCode = 1;
      return;
    }
    const verdict = opts.conflict !== undefined ? 'conflict' : opts.duplicate !== undefined ? 'duplicate' : 'ok';
    const reason = (opts.conflict ?? opts.duplicate ?? (typeof opts.ok === 'string' ? opts.ok : '')).trim() || 'Checked; no problem.';
    state.verdicts[id] = { verdict, reason, at: ctx.now.toISOString(), hashes: [pair.a.hash, pair.b.hash], pair };
    saveState(ctx.mindstashDir, state);
    const label = { conflict: 'conflict', duplicate: 'duplicate', ok: 'no problem' }[verdict];
    console.log(chalk.green(` ✓ Recorded ${id} as ${label}.`) + (verdict === 'ok' ? '' : chalk.dim(' It now shows in `mindstash scan`.')));
  });

program
  .command('undo')
  .description('revert the last applied change')
  .option('-y, --yes', 'undo without asking')
  .action(async (opts: { yes?: boolean }) => {
    const ctx = defaultContext();
    const last = [...loadState(ctx.mindstashDir).history].reverse().find((o) => !o.undone);
    if (!last) {
      console.log('Nothing to undo.');
      return;
    }
    console.log(` Undo the change from ${new Date(last.at).toLocaleString()}?`);
    for (const l of last.summary.split('\n')) console.log('   ' + l);
    if (!opts.yes) {
      if (!process.stdin.isTTY) {
        console.error('Not undone: re-run with --yes to confirm.');
        process.exitCode = 2;
        return;
      }
      if (!(await confirm(' [y] Undo  [n] Cancel  '))) return;
    }
    undo(ctx);
    console.log(chalk.green(' ✓ Undone.'));
  });

program
  .command('cost')
  .description('show how many tokens memories and skills load each session')
  .option('--json', 'machine-readable output')
  .option('--all', 'list every project')
  .action(async (opts: { json?: boolean; all?: boolean }) => {
    const ctx = defaultContext();
    const r = await scan(ctx, { save: false });
    const c = cost(r, ctx.home);
    console.log(opts.json ? JSON.stringify(c, null, 2) : costReport(c, opts.all ? Infinity : 15));
  });

program
  .command('install-skill')
  .description('add the MindStash skill to Claude Code (/mindstash) and Codex ($mindstash)')
  .action(() => {
    const ctx = defaultContext();
    const done = installSkills(ctx, selfCommand());
    if (!done.length) {
      console.error('No supported agent found (looked for ~/.claude and ~/.codex).');
      process.exitCode = 1;
      return;
    }
    for (const d of done) {
      console.log(chalk.green(` ✓ ${d.existed ? 'Updated' : 'Installed'} ${tildify(d.path, ctx.home)}`) + chalk.dim(`  (${d.invoke} in ${d.name})`));
    }
  });

program.parseAsync().catch((e: Error) => {
  console.error(chalk.red(e.message));
  process.exitCode = 1;
});
