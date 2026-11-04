import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Adapter, AdapterScan, Item, Project, ScanContext } from '../core/types.js';
import { contentHash, parseFrontmatter, sanitizePath, str, tokens } from '../core/text.js';
import { instructionItem as instr, isDir, itemId as id, listDirs, modifiedOf, readSkills as skills, readText, scopeFor } from './common.js';

const AGENT = 'claude-code';
const itemId = (path: string) => id(AGENT, path);
const readSkills = (...a: Parameters<typeof skills> extends [string, ...infer R] ? R : never) => skills(AGENT, ...a);
const instructionItem = (path: string, scope: Parameters<typeof instr>[2]) => instr(AGENT, path, scope);

/** Claude Code loads only the first 200 lines of MEMORY.md. */
export const INDEX_LOAD_LINES = 200;

/**
 * Turn a sanitized folder name back into a path by walking the filesystem.
 * "-Users-me-work-api-server" could be /Users/me/work/api-server or /Users/me/work/api/server;
 * only the disk can tell. Returns undefined when no existing folder matches.
 */
export function decodeProjectKey(key: string, root = '/'): string | undefined {
  const walk = (dir: string, rest: string): string | undefined => {
    if (rest === '') return dir;
    const candidates = listDirs(dir)
      .map((name) => ({ name, s: '-' + sanitizePath(name) }))
      .filter(({ s }) => rest.startsWith(s) && (rest.length === s.length || rest[s.length] === '-'))
      .sort((a, b) => b.s.length - a.s.length);
    for (const c of candidates) {
      const found = walk(join(dir, c.name), rest.slice(c.s.length));
      if (found) return found;
    }
    return undefined;
  };
  return walk(root, key);
}

/**
 * Display path for a project whose folder is gone: the deepest folder that still exists,
 * plus the rest of the name as-is ("/Users/me/portfolio" + "old-app").
 */
export function guessPath(key: string, root = '/'): string {
  let dir = root;
  let rest = key;
  for (;;) {
    const next = listDirs(dir)
      .map((name) => ({ name, s: '-' + sanitizePath(name) }))
      .filter(({ s }) => rest.startsWith(s) && rest[s.length] === '-')
      .sort((a, b) => b.s.length - a.s.length)[0];
    if (!next) break;
    dir = join(dir, next.name);
    rest = rest.slice(next.s.length);
  }
  return join(dir, rest.replace(/^-/, ''));
}

/** Index lines look like "- [Title](file.md) — hook". Returns file name → line. */
export function indexLinks(indexRaw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of indexRaw.split('\n')) {
    for (const m of line.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
      const target = m[1]!;
      if (!/^[a-z]+:/i.test(target)) out.set(basename(target), line);
    }
  }
  return out;
}

function pluginSkillDirs(ctx: ScanContext): { dir: string; plugin: string }[] {
  const raw = readText(join(ctx.claudeDir, 'plugins', 'installed_plugins.json'));
  if (!raw) return [];
  try {
    const json = JSON.parse(raw) as { plugins?: Record<string, { installPath?: string }[]> };
    const out: { dir: string; plugin: string }[] = [];
    for (const [id, installs] of Object.entries(json.plugins ?? {})) {
      const latest = installs?.at(-1)?.installPath;
      if (latest) out.push({ dir: join(latest, 'skills'), plugin: id.split('@')[0] ?? id });
    }
    return out;
  } catch {
    return [];
  }
}

const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')];

export const claudeCode: Adapter = {
  id: AGENT,
  name: 'Claude Code',

  async detect(ctx) {
    return isDir(ctx.claudeDir);
  },

  async scan(ctx): Promise<AdapterScan> {
    const projects: Project[] = [];
    const items: Item[] = [];
    const projectsDir = join(ctx.claudeDir, 'projects');

    for (const key of listDirs(projectsDir)) {
      const decoded = decodeProjectKey(key);
      const memoryDir = join(projectsDir, key, 'memory');
      const indexPath = join(memoryDir, 'MEMORY.md');
      const project: Project = {
        agent: AGENT,
        key,
        path: decoded ?? guessPath(key),
        exists: decoded !== undefined,
        memoryDir: isDir(memoryDir) ? memoryDir : undefined,
        indexPath: existsSync(indexPath) ? indexPath : undefined,
      };
      projects.push(project);
      if (!project.memoryDir) continue;

      const scope = scopeFor(project.path, ctx);
      const indexRaw = readText(indexPath);
      const links = indexRaw !== undefined ? indexLinks(indexRaw) : new Map<string, string>();

      if (indexRaw !== undefined) {
        const lines = indexRaw.split('\n');
        items.push({
          id: itemId(indexPath),
          agent: AGENT,
          kind: 'index',
          name: 'MEMORY.md',
          path: indexPath,
          scope,
          projectKey: key,
          body: indexRaw,
          raw: indexRaw,
          hash: contentHash(indexRaw),
          modified: modifiedOf(indexPath),
          loadTokens: tokens(lines.slice(0, INDEX_LOAD_LINES).join('\n')),
          sizeTokens: tokens(indexRaw),
          readOnly: false,
          lines: lines.length,
        });
      }

      let files: string[] = [];
      try {
        files = readdirSync(memoryDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
      } catch {
        /* unreadable folder */
      }
      for (const file of files) {
        const path = join(memoryDir, file);
        const raw = readText(path);
        if (raw === undefined) continue;
        const { data, body } = parseFrontmatter(raw);
        const line = links.get(file);
        items.push({
          id: itemId(path),
          agent: AGENT,
          kind: 'memory',
          name: str(data.name) ?? file.replace(/\.md$/, ''),
          description: str(data.description),
          path,
          scope,
          projectKey: key,
          body,
          raw,
          hash: contentHash(raw),
          modified: modifiedOf(path, data),
          // The file itself loads on demand; its index line loads every session.
          loadTokens: line ? tokens(line) : 0,
          sizeTokens: tokens(raw),
          readOnly: false,
          indexPath: indexRaw !== undefined ? indexPath : undefined,
          indexed: line !== undefined,
        });
      }
    }

    // Skills: user, plugin, and per project.
    items.push(...readSkills(join(ctx.claudeDir, 'skills'), scopeFor(undefined, ctx), 'user', false));
    for (const { dir, plugin } of pluginSkillDirs(ctx)) {
      items.push(...readSkills(dir, scopeFor(undefined, ctx), `plugin:${plugin}`, true, `${plugin}:`));
    }

    // Instruction files: global, then each existing project and its parent folders.
    const seen = new Set<string>();
    const addInstructions = (dir: string | undefined, file: string) => {
      const path = join(dir ?? ctx.claudeDir, file);
      if (seen.has(path)) return;
      seen.add(path);
      const item = instructionItem(path, scopeFor(dir, ctx));
      if (item) items.push(item);
    };
    addInstructions(undefined, 'CLAUDE.md');

    for (const p of projects.filter((p) => p.exists)) {
      items.push(...readSkills(join(p.path, '.claude', 'skills'), scopeFor(p.path, ctx), 'project', false));
      for (let dir = p.path; ; dir = dirname(dir)) {
        for (const f of INSTRUCTION_FILES) addInstructions(dir, f);
        if (dir === dirname(dir)) break;
      }
    }

    // Project skills found twice (same folder reached from two projects) — keep one.
    const unique = new Map<string, Item>();
    for (const it of items) if (!unique.has(it.path)) unique.set(it.path, it);
    return { projects, items: [...unique.values()] };
  },
};
