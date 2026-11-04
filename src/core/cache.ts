import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Pair } from './state.js';
import type { ScanContext, ScanResult } from './types.js';

const date = z.iso.datetime().transform((value) => new Date(value));
const optionalString = z.string().optional();
const moveTarget = z.object({ projectPath: z.string(), memoryDir: z.string(), indexPath: z.string(), label: z.string() });
const cachedScan = z.object({
  version: z.literal(2),
  roots: z.tuple([z.string(), z.string(), z.string()]),
  pairs: z.array(Pair),
  result: z.object({
    at: date,
    agents: z.array(z.object({
      id: z.string(), name: z.string(), found: z.boolean(),
      projects: z.number(), memories: z.number(), skills: z.number(),
    })),
    projects: z.array(z.object({
      agent: z.string(), key: z.string(), path: z.string(), exists: z.boolean(),
      memoryDir: optionalString, indexPath: optionalString, instructionChain: z.array(z.string()).optional(),
    })),
    items: z.array(z.object({
      id: z.string(), agent: z.string(), kind: z.enum(['memory', 'index', 'skill', 'instructions']),
      name: z.string(), description: optionalString, path: z.string(),
      scope: z.object({ kind: z.enum(['global', 'project']), dir: optionalString, label: z.string() }),
      projectKey: optionalString, body: z.string(), raw: z.string(), hash: z.string(), modified: date,
      loadTokens: z.number(), sizeTokens: z.number(), readOnly: z.boolean(),
      indexPath: optionalString, indexed: z.boolean().optional(), lines: z.number().optional(), source: optionalString,
    })),
    findings: z.array(z.object({
      id: z.string(), rule: z.string(),
      category: z.enum(['stale', 'scope', 'similar', 'contradiction', 'relearned', 'index']),
      confidence: z.enum(['high', 'medium', 'low']), title: z.string(), reasons: z.array(z.string()),
      itemIds: z.array(z.string()), tokens: z.number(),
      fixes: z.array(z.enum(['delete', 'archive', 'move', 'ignore', 'relink', 'restore'])),
      moveTo: moveTarget.optional(), missingLink: optionalString,
    })),
    ignoredCount: z.number(),
    pendingChecks: z.number(),
  }),
});

export interface ScanSnapshot {
  result: ScanResult;
  pairs: z.infer<typeof Pair>[];
}

const roots = (ctx: ScanContext) => [ctx.home, ctx.claudeDir, ctx.codexDir];

export function saveCache(ctx: ScanContext, snapshot: ScanSnapshot): void {
  const path = join(ctx.mindstashDir, 'cache.json');
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ version: 2, roots: roots(ctx), ...snapshot }), { mode: 0o600, flag: 'wx' });
    renameSync(tmp, path);
  } catch {
    // A missing cache only costs a slower start.
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

export function loadCache(ctx: ScanContext): ScanSnapshot | undefined {
  try {
    const parsed = cachedScan.safeParse(JSON.parse(readFileSync(join(ctx.mindstashDir, 'cache.json'), 'utf8')));
    if (!parsed.success || roots(ctx).some((root, i) => root !== parsed.data.roots[i])) return;
    return parsed.data;
  } catch {
    return undefined;
  }
}
