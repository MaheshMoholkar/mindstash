import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Item, ScanContext, Scope } from '../core/types.js';
import { contentHash, parseFrontmatter, shortHash, str, tildify, tokens } from '../core/text.js';

/** File helpers shared by adapters. All of them swallow errors: a scan never fails on one bad file. */

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readText(p: string): string | undefined {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

export function listDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDir(join(p, e.name))))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listFiles(p: string, ext = '.md'): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function itemId(agent: string, key: string): string {
  return shortHash(agent + ':' + key, 10);
}

export function modifiedOf(path: string, data: Record<string, unknown> = {}): Date {
  const meta = data.metadata as Record<string, unknown> | undefined;
  const fm = str(meta?.modified) ?? str(data.modified);
  if (fm) {
    const d = new Date(fm);
    if (!Number.isNaN(d.getTime())) return d;
  }
  try {
    return statSync(path).mtime;
  } catch {
    return new Date(0);
  }
}

export function scopeFor(dir: string | undefined, ctx: ScanContext): Scope {
  if (!dir) return { kind: 'global', label: 'global' };
  return { kind: 'project', dir, label: tildify(dir, ctx.home) };
}

/** Read every <dir>/<name>/SKILL.md. Only "name: description" loads per session. */
export function readSkills(
  agent: string,
  skillsDir: string,
  scope: Scope,
  source: string,
  readOnly: boolean,
  prefix = '',
): Item[] {
  const items: Item[] = [];
  for (const name of listDirs(skillsDir)) {
    const path = join(skillsDir, name, 'SKILL.md');
    const raw = readText(path);
    if (raw === undefined) continue;
    const { data, body } = parseFrontmatter(raw);
    const skillName = prefix + (str(data.name) ?? name);
    const description = str(data.description) ?? '';
    items.push({
      id: itemId(agent, path),
      agent,
      kind: 'skill',
      name: skillName,
      description,
      path,
      scope,
      body,
      raw,
      hash: contentHash(raw),
      modified: modifiedOf(path),
      loadTokens: tokens(`${skillName}: ${description}`),
      sizeTokens: tokens(raw),
      readOnly,
      source,
    });
  }
  return items;
}

export function instructionItem(agent: string, path: string, scope: Scope): Item | undefined {
  const raw = readText(path);
  if (raw === undefined) return undefined;
  return {
    id: itemId(agent, path),
    agent,
    kind: 'instructions',
    name: path.split('/').pop()!,
    path,
    scope,
    body: raw,
    raw,
    hash: contentHash(raw),
    modified: modifiedOf(path),
    loadTokens: tokens(raw),
    sizeTokens: tokens(raw),
    readOnly: true,
  };
}
