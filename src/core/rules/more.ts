import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Item, Project } from '../types.js';
import { clip, plural, sentences, tildify } from '../text.js';
import { findingId, memoryFixes, type Rule } from './context.js';

/* ------------------------------------------------------------------ */
/* Missing skill or command: a memory tells the agent to use /x or $x that isn't installed. */

/** Claude Code's own slash commands; never "missing". */
const BUILTIN = new Set(
  (
    'help clear compact memory model config cost doctor init login logout review status agents mcp plugin plugins ' +
    'permissions hooks resume rewind export add-dir bug terminal-setup vim theme usage context statusline ide upgrade ' +
    'release-notes pr-comments security-review install-github-app todos output-style fast loop schedule skills btw ' +
    'effort sandbox privacy-settings feedback exit quit artifacts code-review simplify init migrate-installer ultrareview ' +
    'approvals diff mention new undo compact-history plan'
  ).split(' '),
);

function commandNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

function installedFor(items: Item[], claudeDir: string, project?: Project): Set<string> {
  const names = new Set<string>();
  for (const i of items) {
    if (i.kind !== 'skill') continue;
    if (i.scope.kind === 'project' && project && i.scope.dir !== project.path) continue;
    names.add(i.name.toLowerCase());
    names.add(i.name.split(':').pop()!.toLowerCase());
  }
  for (const c of commandNames(join(claudeDir, 'commands'))) names.add(c.toLowerCase());
  if (project?.exists) for (const c of commandNames(join(project.path, '.claude', 'commands'))) names.add(c.toLowerCase());
  return names;
}

export const missingSkill: Rule = ({ ctx, items, projectOf }) => {
  const out: Finding[] = [];
  const cache = new Map<string, Set<string>>();
  for (const m of items) {
    if (m.kind !== 'memory') continue;
    const project = projectOf(m);
    if (project && !project.exists) continue;
    const key = `${m.agent}:${project?.key ?? ''}`;
    let have = cache.get(key);
    if (!have) {
      have = installedFor(items.filter((i) => i.agent === m.agent), ctx.claudeDir, project);
      cache.set(key, have);
    }
    const sigil = m.agent === 'codex' ? '\\$' : '/';
    // Only command phrasing: "run `/x`", "use the `/x` skill", "`/x` command". A bare `/x` is often a URL route.
    const name = String.raw`\`${sigil}([a-z][a-z0-9-]{2,40})\``;
    const re = new RegExp(
      String.raw`(?:\b(?:run|invoke|type|call|trigger|use)\s+(?:the\s+)?${name})|(?:${name}\s+(?:skill|command|slash command))`,
      'gi',
    );
    const missing = new Set<string>();
    for (const s of sentences(m.body)) {
      for (const hit of s.matchAll(re)) {
        const name = (hit[1] ?? hit[2])!.toLowerCase();
        if (!BUILTIN.has(name) && !have.has(name)) missing.add(name);
      }
    }
    if (!missing.size) continue;
    const list = [...missing].map((n) => (m.agent === 'codex' ? `$${n}` : `/${n}`));
    out.push({
      id: findingId('missing-skill', [m.id]),
      rule: 'missing-skill',
      category: 'stale',
      confidence: 'high',
      title: `tells the agent to use ${list[0]}${list.length > 1 ? ` (+${list.length - 1})` : ''}, which isn't installed`,
      reasons: [
        `Refers to ${plural(list.length, 'skill or command', 'skills or commands')} not installed for ${m.scope.label}: ${list.join(', ')}.`,
        'The agent may try to call it, fail, or improvise.',
      ],
      itemIds: [m.id],
      tokens: m.loadTokens,
      fixes: memoryFixes([m]),
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Version mismatch: memory says "Node 16", the repo declares 22. */

type Tool = 'node' | 'python' | 'go' | 'dotnet';

const TOOL_RE = /\b(node(?:\.?js)?|python|go(?:lang)?|\.net|dotnet|net)\s*v?(\d+)(?:\.(\d+))?\b/gi;
const PAST = /\b(was|were|previously|used to|from|old|legacy|upgrad\w*|migrat\w*|before|instead of|no longer|dropped)\b/i;

function normTool(t: string): Tool | undefined {
  const s = t.toLowerCase();
  if (s.startsWith('node')) return 'node';
  if (s === 'python') return 'python';
  if (s.startsWith('go')) return 'go';
  if (s === '.net' || s === 'dotnet' || s === 'net') return 'dotnet';
  return undefined;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
};

/** Versions the repo itself declares, with where they came from. */
export function declaredVersions(dir: string): Map<Tool, { version: string; source: string }> {
  const out = new Map<Tool, { version: string; source: string }>();
  const num = (s: string | undefined) => /(\d+)(?:\.(\d+))?/.exec(s ?? '');
  const nvm = read(join(dir, '.nvmrc')) ?? read(join(dir, '.node-version'));
  const nm = num(nvm);
  if (nm) out.set('node', { version: nm[1]!, source: existsSync(join(dir, '.nvmrc')) ? '.nvmrc' : '.node-version' });
  else {
    try {
      const pkg = JSON.parse(read(join(dir, 'package.json')) ?? '{}') as { engines?: { node?: string } };
      const e = num(pkg.engines?.node);
      if (e) out.set('node', { version: e[1]!, source: 'package.json engines' });
    } catch {
      /* not JSON */
    }
  }
  const py = num(read(join(dir, '.python-version')) ?? /requires-python\s*=\s*"([^"]+)"/.exec(read(join(dir, 'pyproject.toml')) ?? '')?.[1]);
  if (py) out.set('python', { version: py[2] ? `${py[1]}.${py[2]}` : py[1]!, source: existsSync(join(dir, '.python-version')) ? '.python-version' : 'pyproject.toml' });
  const go = /^go\s+(\d+)\.(\d+)/m.exec(read(join(dir, 'go.mod')) ?? '');
  if (go) out.set('go', { version: `${go[1]}.${go[2]}`, source: 'go.mod' });
  const gj = num(/"version"\s*:\s*"([^"]+)"/.exec(read(join(dir, 'global.json')) ?? '')?.[1]);
  if (gj) out.set('dotnet', { version: gj[1]!, source: 'global.json' });
  return out;
}

function sameVersion(tool: Tool, said: { major: string; minor?: string }, declared: string): boolean {
  const [dMaj, dMin] = declared.split('.');
  if (tool === 'go') return !said.minor || !dMin || (said.major === dMaj && said.minor === dMin);
  if (tool === 'python' && said.minor && dMin) return said.major === dMaj && said.minor === dMin;
  return said.major === dMaj;
}

export const versionMismatch: Rule = ({ ctx, items, projectOf }) => {
  const out: Finding[] = [];
  const cache = new Map<string, ReturnType<typeof declaredVersions>>();
  for (const m of items) {
    if (m.kind !== 'memory') continue;
    const p = projectOf(m);
    if (!p?.exists) continue;
    let declared = cache.get(p.path);
    if (!declared) {
      declared = declaredVersions(p.path);
      cache.set(p.path, declared);
    }
    if (!declared.size) continue;
    const hits: string[] = [];
    for (const s of sentences(m.body)) {
      if (PAST.test(s)) continue;
      for (const h of s.matchAll(TOOL_RE)) {
        const tool = normTool(h[1]!);
        const d = tool && declared.get(tool);
        if (!tool || !d) continue;
        // Go and Python versions like "1.22" / "3.12": ignore bare "go 1" style noise.
        if ((tool === 'go' || tool === 'python') && !h[3]) continue;
        const said = { major: h[2]!, minor: h[3] };
        if (!sameVersion(tool, said, d.version)) hits.push(`"${clip(h[0]!, 20)}" but ${d.source} says ${d.version}`);
      }
    }
    if (!hits.length) continue;
    out.push({
      id: findingId('version-mismatch', [m.id]),
      rule: 'version-mismatch',
      category: 'stale',
      confidence: 'medium',
      title: `says ${hits[0]}`,
      reasons: [`The memory says ${hits.slice(0, 3).join('; ')}.`, `Checked against ${tildify(p.path, ctx.home)}.`],
      itemIds: [m.id],
      tokens: m.loadTokens,
      fixes: memoryFixes([m]),
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Instructions loading everywhere: a CLAUDE.md in a parent folder (like ~) loads in every project below it. */

export const broadInstructions: Rule = ({ ctx, projects, items }) => {
  const out: Finding[] = [];
  const live = projects.filter((p) => p.exists && p.agent === 'claude-code');
  for (const i of items) {
    if (i.agent !== 'claude-code' || i.kind !== 'instructions' || i.scope.kind !== 'project' || !i.scope.dir) continue;
    const dir = i.scope.dir;
    if (existsSync(join(dir, '.git'))) continue; // a repo's own CLAUDE.md is meant for the repo
    const below = live.filter((p) => p.path.startsWith(dir + '/'));
    if (below.length < 3) continue;
    out.push({
      id: findingId('broad-instructions', [i.id]),
      rule: 'broad-instructions',
      category: 'scope',
      confidence: 'medium',
      title: `${tildify(i.path, ctx.home)} loads in ${below.length} projects`,
      reasons: [
        `Claude Code loads every CLAUDE.md from the project folder up to /, so this file joins every session in ${plural(below.length, 'project')} under ${tildify(dir, ctx.home)} (~${i.loadTokens} tokens each).`,
        `If it's only meant for some of them, move it into those projects; if it's for everything, ~/.claude/CLAUDE.md is the intended place.`,
      ],
      itemIds: [i.id],
      tokens: i.loadTokens,
      fixes: ['ignore'],
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Codex skills over budget: Codex lists skills within ~2% of the context window (8,000 characters when unknown). */

export const CODEX_SKILL_BUDGET_CHARS = 8000;

export const codexSkillBudget: Rule = ({ items }) => {
  const skills = items.filter((i) => i.agent === 'codex' && i.kind === 'skill' && i.scope.kind === 'global');
  const chars = skills.reduce((n, s) => n + s.name.length + (s.description?.length ?? 0) + s.path.length + 4, 0);
  if (chars <= CODEX_SKILL_BUDGET_CHARS || skills.length === 0) return [];
  const biggest = [...skills].sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0)).slice(0, 3);
  return [
    {
      id: findingId('codex-skill-budget', ['codex-skills']),
      rule: 'codex-skill-budget',
      category: 'index',
      confidence: 'low',
      title: `${skills.length} Codex skills take ~${Math.round(chars / 1000)}k characters; Codex may list only part of them`,
      reasons: [
        `Codex's docs cap the skill list at about 2% of the model's context window, or ${CODEX_SKILL_BUDGET_CHARS.toLocaleString('en-US')} characters when the window is unknown. Skills past the budget may never be offered.`,
        `Longest descriptions: ${biggest.map((s) => `${s.name} (${s.description?.length ?? 0} chars)`).join(', ')}.`,
        'Remove skills you no longer use, or set skills.max_context_tokens in ~/.codex/config.toml.',
      ],
      itemIds: skills.map((s) => s.id),
      tokens: 0,
      fixes: ['ignore'],
    },
  ];
};

/* ------------------------------------------------------------------ */
/* Instruction file too big: CLAUDE.md / AGENTS.md load in full in every session. */

export const INSTRUCTIONS_WARN_TOKENS = 4000;
/** Claude Code itself warns about memory files over 40,000 characters. */
export const INSTRUCTIONS_HARD_CHARS = 40_000;

/** Markdown sections (## headings) with their size, biggest first. */
export function sections(text: string): { heading: string; tokens: number; logLike: boolean }[] {
  const parts = text.split(/^(?=#{1,3} )/m);
  return parts
    .map((p) => {
      const heading = /^#{1,3} (.+)$/m.exec(p)?.[1]?.trim() ?? '(top of file)';
      const dated = (p.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? []).length;
      const logLike = /\b(history|changelog|log|done|completed|shipped|status|progress|recent|wave|active|queued)\b/i.test(heading) || dated >= 5;
      return { heading, tokens: Math.ceil(p.length / 4), logLike };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

export const instructionsTooBig: Rule = ({ ctx, items }) => {
  const out: Finding[] = [];
  for (const i of items) {
    if (i.kind !== 'instructions' || i.loadTokens <= INSTRUCTIONS_WARN_TOKENS) continue;
    const secs = sections(i.raw);
    const top = secs.slice(0, 3).map((s) => `${s.heading} (~${s.tokens.toLocaleString('en-US')}${s.logLike ? ', looks like a log' : ''})`);
    const logTokens = secs.filter((s) => s.logLike).reduce((n, s) => n + s.tokens, 0);
    const hard = i.raw.length > INSTRUCTIONS_HARD_CHARS;
    out.push({
      id: findingId('instructions-too-big', [i.id]),
      rule: 'instructions-too-big',
      category: 'index',
      confidence: hard ? 'high' : 'medium',
      title: `${i.name} is ~${i.loadTokens.toLocaleString('en-US')} tokens, loaded in full every session`,
      reasons: [
        `${tildify(i.path, ctx.home)} joins every session in ${i.scope.label} as a whole (~${i.loadTokens.toLocaleString('en-US')} tokens, ${i.raw.length.toLocaleString('en-US')} characters).${hard ? ' Claude Code warns above 40,000 characters.' : ''}`,
        `Biggest sections: ${top.join('; ')}.`,
        logTokens
          ? `~${logTokens.toLocaleString('en-US')} tokens look like history or status logs; those usually belong in docs/ or a memory, not in always-loaded instructions.`
          : 'Move reference material into docs/ and link to it; keep only rules the agent needs every time.',
      ],
      itemIds: [i.id],
      tokens: i.loadTokens - INSTRUCTIONS_WARN_TOKENS,
      fixes: ['ignore'],
    });
  }
  return out;
};
