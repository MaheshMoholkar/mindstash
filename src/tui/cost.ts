import type { CostReport } from '../core/cost.js';
import { theme } from './theme.js';
import { fit, fitStart, fmt, type Line } from './ui.js';

function table(headers: string[], rows: string[][], width: number): Line[] {
  const gap = width < 64 ? ' ' : '  ';
  const widths = headers.map((label, i) =>
    rows.reduce((w, cells) => Math.max(w, cells[i]!.length), label.length),
  );
  const [first, ...numbers] = widths;
  const available = width - numbers.reduce((sum, w) => sum + w + gap.length, 0);
  widths[0] = Math.max(1, Math.min(first!, available));
  const line = (cells: string[], heading = false): Line => ({
    text: '',
    segs: cells.map((cell, i) => ({
      text: i === 0
        ? (/^[~/]/.test(cell) ? fitStart(cell, widths[i]!) : fit(cell, widths[i]!))
        : gap + fit(cell, widths[i]!, 'right'),
      color: heading ? theme.muted : theme.fg,
      bold: heading,
    })),
  });
  const ruleWidth = widths.reduce((sum, w) => sum + w, gap.length * (widths.length - 1));
  return [line(headers, true), { text: '─'.repeat(ruleWidth), color: theme.rule }, ...rows.map((cells) => line(cells))];
}

export function costLines(report: CostReport, width: number): Line[] {
  const lines: Line[] = [];
  const blank: Line = { text: '' };
  for (const agent of report.agents) {
    const { baseline } = agent;
    const instructions = agent.agent === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
    const components = [
      [`Skill descriptions (${fmt(baseline.skillCount)})`, fmt(baseline.skills)],
      [`Global ${instructions}`, fmt(baseline.globalInstructions)],
    ];
    if (baseline.memory) components.push(['Memory summary (estimated)', fmt(baseline.memory)]);
    lines.push(
      { text: `${agent.name}  ·  ~${fmt(baseline.total)} tokens per session`, color: theme.accent, bold: true },
      ...table(['Session baseline', 'Tokens'], components, width),
      blank,
    );
    if (agent.bySource.length) {
      const sources = agent.bySource.map((s) => [s.source, fmt(s.skills), fmt(s.tokens)]);
      lines.push(...table(['Skill source', 'Skills', 'Tokens'], sources, width), blank);
    }
    if (agent.projects.length) {
      const projects = agent.projects.map((p) => [
        p.label, fmt(p.total), fmt(p.instructions), fmt(p.index), fmt(p.projectSkills),
      ]);
      lines.push({ text: 'Projects · totals include the session baseline', color: theme.muted });
      for (const row of table(['Project', 'Total', instructions, 'MEMORY.md', 'Skills'], projects, width)) lines.push(row);
      lines.push(blank);
    }
  }
  lines.push({ text: `Flagged items cost ~${fmt(report.flaggedTokens)} tokens per session.`, color: theme.warn });
  return lines;
}
