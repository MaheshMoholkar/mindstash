import { homedir } from 'node:os';
import { join } from 'node:path';
import { adapters } from '../adapters/index.js';
import type { AgentSummary, Finding, Item, Project, ScanContext, ScanResult } from './types.js';
import { loadState, saveState, type State, type StoredFinding, type StoredTarget } from './state.js';
import type { RuleInput } from './rules/context.js';
import { missingPath, missingProject, pastEvent } from './rules/stale.js';
import { agentsTooLong, brokenLink, tooLong, unindexed } from './rules/index-rules.js';
import { wrongScope } from './rules/scope.js';
import { relearned, similarMemories, skillOverlap } from './rules/similar.js';
import { judged, pending } from './contradictions.js';
import { broadInstructions, codexSkillBudget, instructionsTooBig, missingSkill, versionMismatch } from './rules/more.js';

export const RULES = [
  missingProject,
  missingPath,
  missingSkill,
  versionMismatch,
  pastEvent,
  broadInstructions,
  wrongScope,
  similarMemories,
  skillOverlap,
  judged,
  relearned,
  tooLong,
  brokenLink,
  unindexed,
  agentsTooLong,
  codexSkillBudget,
  instructionsTooBig,
];

/** Codex memory files are generated; MindStash points at how to change them instead. */
const CODEX_HINT =
  'Codex rebuilds this file from its sessions, so MindStash leaves it alone. Change it from Codex (/memories), or edit it and expect Codex may rewrite it.';

export function defaultContext(overrides: Partial<ScanContext> = {}): ScanContext {
  const home = overrides.home ?? process.env.HOME ?? homedir();
  return {
    home,
    claudeDir: process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'),
    codexDir: process.env.CODEX_HOME ?? join(home, '.codex'),
    mindstashDir: process.env.MINDSTASH_HOME ?? join(home, '.mindstash'),
    now: new Date(),
    ...overrides,
  };
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function runRules(ctx: ScanContext, projects: Project[], items: Item[], state: State): Finding[] {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const input: RuleInput = {
    ctx,
    projects,
    items,
    state,
    projectOf: (i) => (i.projectKey ? byKey.get(i.projectKey) : undefined),
  };
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const items_ = new Map(items.map((i) => [i.id, i]));
  // Items of a vanished project are covered by one missing-project finding; don't repeat them.
  const vanished = (f: Finding) =>
    f.rule !== 'missing-project' &&
    f.itemIds.every((id) => {
      const it = items_.get(id);
      return it?.projectKey !== undefined && byKey.get(it.projectKey)?.exists === false;
    });
  for (const rule of RULES) {
    for (const f of rule(input)) {
      if (seen.has(f.id) || vanished(f)) continue;
      seen.add(f.id);
      const its = f.itemIds.map((id) => items_.get(id));
      if (its.some((i) => i?.agent === 'codex' && (i.kind === 'memory' || i.kind === 'index'))) f.reasons.push(CODEX_HINT);
      findings.push(f);
    }
  }
  // Most certain first, then things MindStash can fix, then the most expensive.
  const fixable = (f: Finding) => (f.fixes.length > 1 ? 0 : 1);
  return findings.sort(
    (a, b) =>
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      fixable(a) - fixable(b) ||
      b.tokens - a.tokens,
  );
}

function store(f: Finding, items: Map<string, Item>): StoredFinding {
  return {
    id: f.id,
    rule: f.rule,
    title: f.title,
    fixes: f.fixes,
    tokens: f.tokens,
    moveTo: f.moveTo,
    missingLink: f.missingLink,
    targets: f.itemIds.map((id) => target(items.get(id)!)),
  };
}

function target(i: Item): StoredTarget {
  return {
    itemId: i.id,
    agent: i.agent,
    path: i.path,
    hash: i.hash,
    kind: i.kind,
    name: i.name,
    scope: i.scope.label,
    projectKey: i.projectKey,
    indexPath: i.indexPath,
    loadTokens: i.loadTokens,
    readOnly: i.readOnly,
  };
}

/** Items the user may delete or archive directly: their own memories and skills. */
export function actionable(i: Item): boolean {
  return !i.readOnly && (i.kind === 'memory' || i.kind === 'skill');
}

export interface ScanOptions {
  /** Include findings the user marked "not a problem". */
  includeIgnored?: boolean;
  /** Remember this scan so `apply` can act on its finding ids (default true). */
  save?: boolean;
}

export async function scan(ctx: ScanContext, opts: ScanOptions = {}): Promise<ScanResult> {
  const state = loadState(ctx.mindstashDir);
  const agents: AgentSummary[] = [];
  const projects: Project[] = [];
  const items: Item[] = [];

  for (const adapter of adapters) {
    const found = await adapter.detect(ctx);
    if (!found) {
      agents.push({ id: adapter.id, name: adapter.name, found, projects: 0, memories: 0, skills: 0 });
      continue;
    }
    const res = await adapter.scan(ctx);
    projects.push(...res.projects);
    items.push(...res.items);
    agents.push({
      id: adapter.id,
      name: adapter.name,
      found,
      projects: res.projects.filter((p) => res.items.some((i) => i.projectKey === p.key && i.kind === 'memory')).length,
      memories: res.items.filter((i) => i.kind === 'memory').length,
      skills: res.items.filter((i) => i.kind === 'skill').length,
    });
  }

  const all = runRules(ctx, projects, items, state);
  const findings = opts.includeIgnored ? all : all.filter((f) => !state.ignored[f.id]);

  if (opts.save !== false) {
    const byId = new Map(items.map((i) => [i.id, i]));
    state.lastScan = {
      at: ctx.now.toISOString(),
      findings: all.map((f) => store(f, byId)),
      items: items.filter(actionable).map(target),
    };
    saveState(ctx.mindstashDir, state);
  }

  return {
    at: ctx.now,
    agents,
    projects,
    items,
    findings,
    ignoredCount: all.length - all.filter((f) => !state.ignored[f.id]).length,
    pendingChecks: pending(state, items, projects).total,
  };
}
