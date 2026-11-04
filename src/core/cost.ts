import type { Item, ScanResult } from './types.js';
import { tildify } from './text.js';

export interface ProjectCost {
  path: string;
  label: string;
  exists: boolean;
  /** CLAUDE.md files in this folder and its parents (excluding the global one). */
  instructions: number;
  index: number;
  projectSkills: number;
  /** Everything a session started here loads, including the every-session baseline. */
  total: number;
}

export interface CostReport {
  baseline: { skills: number; skillCount: number; globalInstructions: number; total: number };
  bySource: { source: string; skills: number; tokens: number }[];
  projects: ProjectCost[];
  flaggedTokens: number;
}

function within(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/');
}

export function cost(r: ScanResult, home: string): CostReport {
  const sum = (xs: Item[]) => xs.reduce((n, i) => n + i.loadTokens, 0);
  const globalSkills = r.items.filter((i) => i.kind === 'skill' && i.scope.kind === 'global');
  const globalInstr = r.items.filter((i) => i.kind === 'instructions' && i.scope.kind === 'global');
  const baseline = {
    skills: sum(globalSkills),
    skillCount: globalSkills.length,
    globalInstructions: sum(globalInstr),
    total: sum(globalSkills) + sum(globalInstr),
  };

  const sources = new Map<string, Item[]>();
  for (const s of globalSkills) sources.set(s.source ?? 'user', [...(sources.get(s.source ?? 'user') ?? []), s]);
  const bySource = [...sources]
    .map(([source, xs]) => ({ source, skills: xs.length, tokens: sum(xs) }))
    .sort((a, b) => b.tokens - a.tokens);

  const projects: ProjectCost[] = [];
  for (const p of r.projects) {
    if (!p.exists) continue; // no session can start in a folder that's gone
    const instr = r.items.filter(
      (i) => i.kind === 'instructions' && i.scope.dir && within(i.scope.dir, p.path),
    );
    const idx = r.items.filter((i) => i.kind === 'index' && i.projectKey === p.key);
    const skills = r.items.filter((i) => i.kind === 'skill' && i.scope.kind === 'project' && i.scope.dir === p.path);
    const instructions = sum(instr);
    const index = sum(idx);
    const projectSkills = sum(skills);
    if (!idx.length && !skills.length && !instructions) continue;
    projects.push({
      path: p.path,
      label: tildify(p.path, home),
      exists: p.exists,
      instructions,
      index,
      projectSkills,
      total: baseline.total + instructions + index + projectSkills,
    });
  }
  projects.sort((a, b) => b.total - a.total);

  return { baseline, bySource, projects, flaggedTokens: r.findings.reduce((n, f) => n + f.tokens, 0) };
}
