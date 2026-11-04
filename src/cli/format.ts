import chalk from 'chalk';
import { baselines, type CostReport } from '../core/cost.js';
import type { Category, Finding, Item, ScanResult } from '../core/types.js';
import { clip, plural } from '../core/text.js';

export const CATEGORIES: { id: Category; label: string; hint: string }[] = [
  { id: 'stale', label: 'Stale', hint: 'past dates, missing files' },
  { id: 'scope', label: 'Wrong scope', hint: 'about one project, saved in a parent folder' },
  { id: 'similar', label: 'Look similar', hint: 'possible duplicates, overlapping skills' },
  { id: 'relearned', label: 'Re-learned', hint: 'deleted before, saved again' },
  { id: 'index', label: 'Index problems', hint: 'index or AGENTS.md too long, out of sync' },
];

const n = (x: number) => x.toLocaleString('en-US');

function width(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

function rule(): string {
  return chalk.dim('─'.repeat(width() - 2));
}

const CONF = {
  high: chalk.red('●'),
  medium: chalk.yellow('●'),
  low: chalk.dim('●'),
};

export function itemsOf(f: Finding, r: ScanResult): Item[] {
  const byId = new Map(r.items.map((i) => [i.id, i]));
  return f.itemIds.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
}

export function subject(f: Finding, r: ScanResult): { name: string; scope: string } {
  const items = itemsOf(f, r);
  const first = items[0];
  if (!first) return { name: '?', scope: '' };
  if (f.rule === 'missing-project') return { name: plural(items.length, 'memory', 'memories'), scope: first.scope.label };
  if (f.rule === 'similar' || f.rule === 'skill-overlap' || f.rule === 'skill-duplicate') {
    return { name: '', scope: first.scope.label };
  }
  return { name: first.name, scope: first.scope.label };
}

export function scanReport(r: ScanResult, opts: { full?: boolean; perCategory?: number } = {}): string {
  const out: string[] = [];
  const agents = r.agents.filter((a) => a.found).map((a) => a.name);
  out.push(` ${chalk.bold('MindStash')}${' '.repeat(Math.max(2, width() - 13 - agents.join(' · ').length))}${chalk.dim(agents.join(' · ') || 'no agents found')}`);
  out.push(' ' + rule());

  const memories = r.items.filter((i) => i.kind === 'memory').length;
  const skills = r.items.filter((i) => i.kind === 'skill').length;
  out.push(` ${plural(memories, 'memory', 'memories')} · ${plural(skills, 'skill')}`);
  out.push(chalk.dim(` Tokens loaded in every session: ${baselineLine(r)}`));
  out.push('');

  if (!r.agents.some((a) => a.found)) {
    out.push(' No supported agent found. MindStash looks in ~/.claude (set CLAUDE_CONFIG_DIR to change).');
    return out.join('\n');
  }

  if (r.findings.length === 0) {
    out.push(chalk.green(' ✓ Nothing needs attention.'));
  } else {
    out.push(` ${chalk.bold('Needs attention')}${' '.repeat(Math.max(2, width() - 25))}${chalk.dim('tokens')}`);
    for (const c of CATEGORIES) {
      const fs = r.findings.filter((f) => f.category === c.id);
      if (!fs.length) continue;
      const tk = fs.reduce((s, f) => s + f.tokens, 0);
      const left = `   ${chalk.yellow('●')} ${String(fs.length).padStart(2)}  ${c.label.padEnd(15)}${chalk.dim(c.hint)}`;
      const visible = 3 + 2 + 2 + 2 + 15 + c.hint.length;
      out.push(left + ' '.repeat(Math.max(2, width() - 8 - visible)) + (tk ? n(tk) : '-').padStart(6));
    }
  }
  const flaggedIds = new Set(r.findings.flatMap((f) => f.itemIds));
  const fine = r.items.filter((i) => i.kind === 'memory' && !flaggedIds.has(i.id)).length;
  out.push('');
  out.push(chalk.green(`   ✓ ${plural(fine, 'memory looks', 'memories look')} fine`));

  const per = opts.full ? Infinity : opts.perCategory ?? 6;
  for (const c of CATEGORIES) {
    const fs = r.findings.filter((f) => f.category === c.id);
    if (!fs.length) continue;
    out.push('');
    out.push(` ${chalk.bold(c.label)} (${fs.length})`);
    for (const f of fs.slice(0, per)) out.push(...findingLines(f, r));
    if (fs.length > per) out.push(chalk.dim(`   … ${fs.length - per} more (mindstash scan --full)`));
  }

  out.push('');
  if (r.ignoredCount) out.push(chalk.dim(` ${plural(r.ignoredCount, 'finding')} hidden as "not a problem" (--include-ignored to show).`));
  if (r.findings.length) {
    out.push(chalk.dim(' Details: mindstash show <id>   Fix: mindstash apply --delete|--archive|--move|--ignore <id...>'));
  }
  return out.join('\n');
}

function findingLines(f: Finding, r: ScanResult): string[] {
  const { name, scope } = subject(f, r);
  const head = [chalk.cyan(f.id), name && chalk.bold(name), chalk.dim(scope)].filter(Boolean).join('  ');
  return [`   ${CONF[f.confidence]} ${head}`, `       ${clip(f.title, width() - 9)}`];
}

export function showFinding(f: Finding, r: ScanResult): string {
  const items = itemsOf(f, r);
  const out: string[] = [];
  const first = items[0];
  out.push(` ${chalk.bold(f.title)}`);
  out.push(chalk.dim(`  ${f.id} · ${f.rule} · ${f.confidence} confidence${first ? ` · ${first.scope.label}` : ''}`));
  out.push(' ' + rule());
  out.push(` ${chalk.bold('Why flagged')}`);
  for (const reason of f.reasons) out.push(`   ${reason}`);
  if (f.tokens) out.push(`   Costs ~${n(f.tokens)} tokens per session.`);

  for (const it of items) {
    out.push('');
    out.push(` ${chalk.bold(it.name)}  ${chalk.dim(`${it.kind} · ${it.scope.label}${it.readOnly ? ' · read-only' : ''}`)}`);
    const body = it.kind === 'skill' ? it.description ?? '' : it.body;
    const lines = body.trim().split('\n');
    const max = items.length > 1 ? 8 : 20;
    for (const l of lines.slice(0, max)) out.push(chalk.dim('   │ ') + clip(l, width() - 6));
    if (lines.length > max) out.push(chalk.dim(`   │ … ${lines.length - max} more lines`));
    out.push(chalk.dim(`   File  ${it.path}`));
  }

  out.push('');
  const cmds = f.fixes.map((k) => `mindstash apply --${k} ${f.id}`);
  if (f.moveTo) out.push(chalk.dim(`   Move target: ${f.moveTo.label}`));
  out.push(chalk.dim(`   ${cmds.join('\n   ')}`));
  if (f.fixes.length === 1 && f.rule !== 'too-long') {
    out.push(chalk.dim('   MindStash only suggests here; edit the files yourself (e.g. $EDITOR <file>).'));
  }
  if (f.rule === 'too-long') out.push(chalk.dim('   Shorten MEMORY.md by hand, or clear stale memories to shrink it.'));
  return out.join('\n');
}

/** One line of the cost view, shared by the CLI and the terminal UI. */
export interface CostRow {
  text: string;
  style?: 'bold' | 'dim';
  /** Project rows: scrolled as a list in the terminal UI. */
  project?: boolean;
}

const INSTR_NAME: Record<string, string> = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md' };

export function costRows(c: CostReport, limit = Infinity): CostRow[] {
  const rows: CostRow[] = [];
  for (const a of c.agents) {
    const instr = INSTR_NAME[a.agent] ?? 'instructions';
    rows.push({ text: `${a.name}: every session loads ~${n(a.baseline.total)} tokens`, style: 'bold' });
    rows.push({ text: `  ${n(a.baseline.skills).padStart(7)}  ${plural(a.baseline.skillCount, 'skill description')}` });
    for (const s of a.bySource) rows.push({ text: `  ${n(s.tokens).padStart(9)}  ${s.source} (${s.skills})`, style: 'dim' });
    rows.push({ text: `  ${n(a.baseline.globalInstructions).padStart(7)}  global ${instr}` });
    if (a.baseline.memory) rows.push({ text: `  ${n(a.baseline.memory).padStart(7)}  memory summary (estimated)` });
    if (a.projects.length) {
      rows.push({ text: `  Per project (baseline + ${instr} files${a.agent === 'claude-code' ? ' + MEMORY.md' : ''} + project skills)`, style: 'dim' });
      for (const p of a.projects.slice(0, limit)) {
        const extra = [
          p.instructions && `${instr} ${n(p.instructions)}`,
          p.index && `MEMORY.md ${n(p.index)}`,
          p.projectSkills && `skills ${n(p.projectSkills)}`,
        ]
          .filter(Boolean)
          .join(' · ');
        rows.push({ text: `  ${clip(p.label, 34).padEnd(34)} ${n(p.total).padStart(7)}  ${extra}`, project: true });
      }
      if (a.projects.length > limit) rows.push({ text: `  … ${a.projects.length - limit} more (--all)`, style: 'dim' });
    }
    rows.push({ text: '' });
  }
  rows.push({ text: `Flagged items cost ~${n(c.flaggedTokens)} tokens per session.` });
  return rows;
}

export function costReport(c: CostReport, limit = 15): string {
  const out = [` ${chalk.bold('Token cost')} ${chalk.dim('(estimated, ~4 characters per token)')}`, ' ' + rule()];
  for (const r of costRows(c, limit)) {
    out.push(' ' + (r.style === 'bold' ? chalk.bold(r.text) : r.style === 'dim' ? chalk.dim(r.text) : r.text));
  }
  return out.join('\n');
}

/** "Claude Code ~14,540 · Codex ~3,200": what each agent loads in every session. */
export function baselineLine(r: ScanResult): string {
  return baselines(r)
    .map((b) => `${b.name} ~${n(b.tokens)}`)
    .join(' · ');
}
