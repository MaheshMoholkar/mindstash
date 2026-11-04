import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { defaultContext, scan } from '../core/scan.js';
import { apply, describe, FixError, plan, undo, type Requests } from '../core/fix.js';
import { cost } from '../core/cost.js';
import { loadState } from '../core/state.js';
import { tildify } from '../core/text.js';
import type { Finding, ScanResult } from '../core/types.js';
import { costReport, itemsOf, scanReport, showFinding } from './format.js';
import { skillMarkdown } from './skill.js';

const VERSION = '0.1.0';

function findingJson(f: Finding, r: ScanResult, withBody = false) {
  return {
    ...f,
    items: itemsOf(f, r).map((i) => ({
      id: i.id,
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
    .option('--include-ignored', 'include findings marked "not a problem"');
}

async function runScan(opts: { json?: boolean; full?: boolean; includeIgnored?: boolean }) {
  const ctx = defaultContext();
  const r = await scan(ctx, { includeIgnored: opts.includeIgnored });
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
    if (process.stdout.isTTY && !existsSync(join(ctx.claudeDir, 'skills', 'mindstash', 'SKILL.md'))) {
      console.log(chalk.dim(' Tip: `mindstash install-skill` adds /mindstash to Claude Code.'));
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
  .option('-y, --yes', 'apply without asking')
  .action(async (opts: { delete?: string[]; archive?: string[]; move?: string[]; ignore?: string[]; yes?: boolean }) => {
    const ctx = defaultContext();
    const req: Requests = { delete: ids(opts.delete), archive: ids(opts.archive), move: ids(opts.move), ignore: ids(opts.ignore) };
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
  .description('add /mindstash to Claude Code so you can use it from inside your agent')
  .action(() => {
    const ctx = defaultContext();
    const dir = join(ctx.claudeDir, 'skills', 'mindstash');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    const existed = existsSync(path);
    writeFileSync(path, skillMarkdown(selfCommand()));
    console.log(chalk.green(` ✓ ${existed ? 'Updated' : 'Installed'} ${tildify(path, ctx.home)}`));
    console.log(chalk.dim(' Type /mindstash in Claude Code to review memories from chat.'));
  });

program.parseAsync().catch((e: Error) => {
  console.error(chalk.red(e.message));
  process.exitCode = 1;
});
