import { agentName } from '../adapters/index.js';
import type { Item, ScanResult } from './types.js';
import { tildify } from './text.js';

export interface ProjectCost {
  path: string;
  label: string;
  exists: boolean;
  /** CLAUDE.md / AGENTS.md files a session here loads (excluding the global one). */
  instructions: number;
  index: number;
  projectSkills: number;
  /** Everything a session started here loads, including the agent's every-session baseline. */
  total: number;
}

export interface AgentCost {
  agent: string;
  name: string;
  baseline: { skills: number; skillCount: number; globalInstructions: number; memory: number; total: number };
  bySource: { source: string; skills: number; tokens: number }[];
  projects: ProjectCost[];
}

export interface CostReport {
  agents: AgentCost[];
  flaggedTokens: number;
}

function within(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/');
}

const sum = (xs: Item[]) => xs.reduce((n, i) => n + i.loadTokens, 0);

export function cost(r: ScanResult, home: string): CostReport {
  const agents: AgentCost[] = [];
  for (const a of r.agents.filter((x) => x.found)) {
    const mine = r.items.filter((i) => i.agent === a.id);
    const global = mine.filter((i) => i.scope.kind === 'global');
    const skills = global.filter((i) => i.kind === 'skill');
    const instr = global.filter((i) => i.kind === 'instructions');
    const memory = global.filter((i) => i.kind === 'index');
    const baseline = {
      skills: sum(skills),
      skillCount: skills.length,
      globalInstructions: sum(instr),
      memory: sum(memory),
      total: sum(skills) + sum(instr) + sum(memory),
    };

    const sources = new Map<string, Item[]>();
    for (const s of skills) sources.set(s.source ?? 'user', [...(sources.get(s.source ?? 'user') ?? []), s]);
    const bySource = [...sources]
      .map(([source, xs]) => ({ source, skills: xs.length, tokens: sum(xs) }))
      .sort((x, y) => y.tokens - x.tokens);

    const projects: ProjectCost[] = [];
    for (const p of r.projects.filter((p) => p.agent === a.id && p.exists)) {
      // Codex lists its chain exactly; for Claude Code, every CLAUDE.md in the folder and its parents.
      const chain = p.instructionChain;
      const pInstr = mine.filter(
        (i) =>
          i.kind === 'instructions' &&
          i.scope.kind === 'project' &&
          (chain ? chain.includes(i.path) : Boolean(i.scope.dir && within(i.scope.dir, p.path))),
      );
      const idx = mine.filter((i) => i.kind === 'index' && i.projectKey === p.key);
      const pSkills = mine.filter((i) => i.kind === 'skill' && i.scope.kind === 'project' && i.scope.dir === p.path);
      const instructions = sum(pInstr);
      const index = sum(idx);
      const projectSkills = sum(pSkills);
      if (!idx.length && !pSkills.length && !instructions) continue;
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
    projects.sort((x, y) => y.total - x.total);
    agents.push({ agent: a.id, name: agentName(a.id), baseline, bySource, projects });
  }
  return { agents, flaggedTokens: r.findings.reduce((n, f) => n + f.tokens, 0) };
}

/** Tokens each agent loads in every session, whatever the project. */
export function baselines(r: ScanResult): { agent: string; name: string; tokens: number }[] {
  return r.agents
    .filter((a) => a.found)
    .map((a) => ({
      agent: a.id,
      name: agentName(a.id),
      tokens: sum(r.items.filter((i) => i.agent === a.id && i.scope.kind === 'global' && i.kind !== 'memory')),
    }));
}
