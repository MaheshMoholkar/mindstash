import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Adapter, AdapterScan, Item, Project, ScanContext } from '../core/types.js';
import { contentHash, tokens } from '../core/text.js';
import { instructionItem, isDir, itemId, listFiles, modifiedOf, readSkills, readText, scopeFor } from './common.js';

const AGENT = 'codex';

/** Codex stops adding AGENTS.md files once their combined size reaches this (project_doc_max_bytes). */
export const AGENTS_MAX_BYTES = 32 * 1024;

/**
 * Codex memories are generated state: sessions are summarized, then consolidated into
 * MEMORY.md ("# Task Group: …" sections) and memory_summary.md. Codex's docs say not to rely
 * on hand edits, so every Codex memory is read-only for MindStash: it flags and explains,
 * the user acts through Codex (/memories) or their editor.
 */

export interface TaskGroup {
  title: string;
  scope?: string;
  cwd?: string;
  workflow?: string;
  updated?: Date;
  text: string;
  /** Text without the bookkeeping list of rollout files, used by the rules. */
  body: string;
}

/** Remove a "### heading" section up to the next heading of level 2 or 3. */
function dropSection(text: string, heading: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (line.trim() === heading) skipping = true;
    else if (skipping && /^#{2,3} /.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

export function parseTaskGroups(raw: string): TaskGroup[] {
  const parts = raw.split(/^(?=# Task Group: )/m).filter((p) => p.startsWith('# Task Group: '));
  return parts.map((text) => {
    const title = text.slice('# Task Group: '.length, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n')).trim();
    const scope = /^scope:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const applies = /^applies_to:\s*(.+)$/m.exec(text)?.[1] ?? '';
    const cwd = /(?:^|;\s*)cwd=([^;]+)/.exec(applies)?.[1]?.trim();
    const workflow = /(?:^|;\s*)workflow=([^;]+)/.exec(applies)?.[1]?.trim();
    const dates = [...text.matchAll(/updated_at=([0-9T:.+\-Z]+)/g)]
      .map((m) => new Date(m[1]!))
      .filter((d) => !Number.isNaN(d.getTime()));
    const updated = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : undefined;
    // "### rollout_summary_files" lists Codex's own session files; paths there aren't about the repo.
    const body = dropSection(text, '### rollout_summary_files');
    return { title, scope, cwd, workflow, updated, text, body };
  });
}

/** Project folders Codex knows about, from [projects."…"] tables in config.toml. */
export function configProjects(configRaw: string): string[] {
  return [...configRaw.matchAll(/^\[projects\."((?:[^"\\]|\\.)+)"\]/gm)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
}

function gitRoot(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (d === dirname(d)) return undefined;
  }
}

/** Folders from the repo root down to `cwd` (just `cwd` outside a repo), as Codex walks them. */
function walkDown(cwd: string): string[] {
  const root = gitRoot(cwd) ?? cwd;
  const dirs: string[] = [];
  for (let d = cwd; ; d = dirname(d)) {
    dirs.unshift(d);
    if (d === root || d === dirname(d)) break;
  }
  return dirs;
}

/** First non-empty AGENTS.override.md / AGENTS.md in a folder (Codex reads one per folder). */
function agentsFile(dir: string): string | undefined {
  for (const f of ['AGENTS.override.md', 'AGENTS.md']) {
    const p = join(dir, f);
    if ((readText(p) ?? '').trim()) return p;
  }
  return undefined;
}

export const codex: Adapter = {
  id: AGENT,
  name: 'Codex',

  async detect(ctx) {
    return isDir(ctx.codexDir);
  },

  async scan(ctx: ScanContext): Promise<AdapterScan> {
    const items: Item[] = [];
    const projects = new Map<string, Project>();
    const projectFor = (path: string): Project => {
      let p = projects.get(path);
      if (!p) {
        p = { agent: AGENT, key: `codex:${path}`, path, exists: isDir(path) };
        projects.set(path, p);
      }
      return p;
    };
    for (const path of configProjects(readText(join(ctx.codexDir, 'config.toml')) ?? '')) projectFor(path);

    // Memories: the current store is memories/; fresh installs use memories_v2/.
    const memDir = [join(ctx.codexDir, 'memories'), join(ctx.codexDir, 'memories_v2')].find(isDir);
    if (memDir) {
      const memoryMd = join(memDir, 'MEMORY.md');
      const raw = readText(memoryMd);
      if (raw !== undefined) {
        for (const g of parseTaskGroups(raw)) {
          const project = g.cwd ? projectFor(g.cwd) : undefined;
          const scope = g.cwd
            ? scopeFor(g.cwd, ctx)
            : { kind: 'global' as const, label: g.workflow ? `global · ${g.workflow}` : 'global' };
          items.push({
            id: itemId(AGENT, `${memoryMd}#${g.title}`),
            agent: AGENT,
            kind: 'memory',
            name: g.title,
            description: g.scope,
            path: memoryMd,
            scope,
            projectKey: project?.key,
            body: g.body,
            raw: g.text,
            hash: contentHash(g.text),
            modified: g.updated ?? modifiedOf(memoryMd),
            // Codex looks these up when relevant; the summary below is what rides along.
            loadTokens: 0,
            sizeTokens: tokens(g.text),
            readOnly: true,
          });
        }
      }

      // memory_summary.md: the consolidated profile. Codex's docs don't say which file is
      // injected; MindStash counts this one as loading every session (estimate).
      const summaryPath = join(memDir, 'memory_summary.md');
      const summary = readText(summaryPath);
      if (summary !== undefined) {
        items.push({
          id: itemId(AGENT, summaryPath),
          agent: AGENT,
          kind: 'index',
          name: 'memory_summary.md',
          path: summaryPath,
          scope: { kind: 'global', label: 'global' },
          body: summary,
          raw: summary,
          hash: contentHash(summary),
          modified: modifiedOf(summaryPath),
          loadTokens: tokens(summary),
          sizeTokens: tokens(summary),
          readOnly: true,
          lines: summary.split('\n').length,
        });
      }

      // Ad-hoc notes: user-written input that Codex folds into its memories.
      const notesDir = join(memDir, 'extensions', 'ad_hoc', 'notes');
      for (const file of listFiles(notesDir)) {
        const path = join(notesDir, file);
        const text = readText(path) ?? '';
        items.push({
          id: itemId(AGENT, path),
          agent: AGENT,
          kind: 'memory',
          name: file.replace(/\.md$/, '').replace(/^[0-9T:+\-]{8,}-/, ''),
          description: 'ad-hoc note',
          path,
          scope: { kind: 'global', label: 'global · ad-hoc note' },
          body: text,
          raw: text,
          hash: contentHash(text),
          modified: modifiedOf(path),
          loadTokens: 0,
          sizeTokens: tokens(text),
          readOnly: true,
        });
      }
    }

    // Skills: ~/.agents/skills is the documented user folder; ~/.codex/skills holds older
    // user skills and the bundled ones (.system).
    const global = scopeFor(undefined, ctx);
    items.push(...readSkills(AGENT, join(ctx.home, '.agents', 'skills'), global, 'user', false));
    items.push(...readSkills(AGENT, join(ctx.codexDir, 'skills'), global, 'codex-home', false));
    items.push(...readSkills(AGENT, join(ctx.codexDir, 'skills', '.system'), global, 'system', true));

    // Instructions: global AGENTS.md, then per project the chain from repo root to the folder.
    const seen = new Set<string>();
    const addInstr = (path: string, dir: string | undefined) => {
      if (seen.has(path)) return;
      seen.add(path);
      const it = instructionItem(AGENT, path, scopeFor(dir, ctx));
      if (it) items.push(it);
    };
    const globalAgents = agentsFile(ctx.codexDir);
    if (globalAgents) addInstr(globalAgents, undefined);

    for (const p of projects.values()) {
      if (!p.exists) continue;
      p.instructionChain = [];
      for (const dir of walkDown(p.path)) {
        const f = agentsFile(dir);
        if (f) {
          addInstr(f, dir);
          p.instructionChain.push(f);
        }
        items.push(...readSkills(AGENT, join(dir, '.agents', 'skills'), scopeFor(p.path, ctx), 'project', false));
      }
    }

    const unique = new Map<string, Item>();
    for (const it of items) if (!unique.has(it.id)) unique.set(it.id, it);
    return { projects: [...projects.values()], items: [...unique.values()] };
  },
};

export function agentsChainBytes(paths: string[]): number {
  return paths.reduce((n, p) => n + Buffer.byteLength(readText(p) ?? ''), 0);
}

