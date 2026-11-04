import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** What a stored scan remembers about each file a finding touches. */
const Target = z.object({
  itemId: z.string(),
  path: z.string(),
  hash: z.string(),
  kind: z.string(),
  name: z.string(),
  scope: z.string(),
  projectKey: z.string().optional(),
  indexPath: z.string().optional(),
  loadTokens: z.number(),
  readOnly: z.boolean(),
  agent: z.string().optional(),
});

const StoredFinding = z.object({
  id: z.string(),
  rule: z.string(),
  title: z.string(),
  fixes: z.array(z.string()),
  tokens: z.number(),
  targets: z.array(Target),
  moveTo: z
    .object({ projectPath: z.string(), memoryDir: z.string(), indexPath: z.string(), label: z.string() })
    .optional(),
  missingLink: z.string().optional(),
});

const Touched = z.object({ path: z.string(), existed: z.boolean() });

/** Something archived by MindStash, and where it came from, so it can be restored. */
const Archived = z.object({
  id: z.string(),
  kind: z.enum(['memory', 'skill']),
  agent: z.string(),
  name: z.string(),
  scope: z.string(),
  from: z.string(),
  to: z.string(),
  indexPath: z.string().optional(),
  indexLine: z.string().optional(),
  at: z.string(),
});

const Operation = z.object({
  id: z.string(),
  at: z.string(),
  commit: z.string(),
  summary: z.string(),
  touched: z.array(Touched),
  ignored: z.array(z.string()),
  deletedAdded: z.array(z.string()),
  archivedAdded: z.array(z.string()).default([]),
  archivedRemoved: z.array(Archived).default([]),
  undone: z.boolean().default(false),
});

const Deleted = z.object({
  key: z.string(),
  name: z.string(),
  scope: z.string(),
  at: z.string(),
  sig: z.array(z.number()),
});

/** One side of a pair the agent is asked to compare. */
const Side = z.object({
  itemId: z.string(),
  agent: z.string(),
  kind: z.string(),
  name: z.string(),
  scope: z.string(),
  path: z.string(),
  hash: z.string(),
  snippet: z.string(),
});

export const Pair = z.object({ id: z.string(), a: Side, b: Side, shared: z.array(z.string()), cue: z.string(), score: z.number() });

/** The agent's call on a pair. Only valid while both files are unchanged (hashes match). */
const Verdict = z.object({
  verdict: z.enum(['conflict', 'duplicate', 'ok']),
  reason: z.string(),
  at: z.string(),
  hashes: z.tuple([z.string(), z.string()]),
  pair: Pair,
});

const StateSchema = z.object({
  version: z.literal(1),
  tourSeen: z.boolean().optional(),
  ignored: z.record(z.string(), z.object({ rule: z.string(), title: z.string(), at: z.string() })),
  deleted: z.array(Deleted),
  lastScan: z
    .object({
      at: z.string(),
      findings: z.array(StoredFinding),
      /** Memories and skills the user can act on directly, by item id. */
      items: z.array(Target).default([]),
    })
    .optional(),
  history: z.array(Operation),
  lastCheck: z.object({ at: z.string(), pairs: z.array(Pair) }).optional(),
  verdicts: z.record(z.string(), Verdict).default({}),
  archived: z.array(Archived).default([]),
  /** Finding ids the user has seen in an interactive view (for "N new" in the status line). */
  seen: z.array(z.string()).default([]),
  /** Finding ids already announced by the session-start hook. */
  notified: z.array(z.string()).default([]),
});

export type State = z.infer<typeof StateSchema>;
export type StoredFinding = z.infer<typeof StoredFinding>;
export type StoredTarget = z.infer<typeof Target>;
export type Operation = z.infer<typeof Operation>;
export type Pair = z.infer<typeof Pair>;
export type Archived = z.infer<typeof Archived>;
export type PairSide = z.infer<typeof Side>;
export type Verdict = z.infer<typeof Verdict>;

export function emptyState(): State {
  return { version: 1, ignored: {}, deleted: [], history: [], verdicts: {}, archived: [], seen: [], notified: [] };
}

export function statePath(mindstashDir: string): string {
  return join(mindstashDir, 'state.json');
}

export function loadState(mindstashDir: string): State {
  const p = statePath(mindstashDir);
  if (!existsSync(p)) return emptyState();
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Can't read ${p}: ${(e as Error).message}. Fix or remove the file and try again.`);
  }
  const parsed = StateSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${p} has an unexpected shape. Fix or remove the file and try again.\n${parsed.error.message}`);
  }
  return parsed.data;
}

/** Write via a temp file so a crash never leaves half a state file. */
export function saveState(mindstashDir: string, state: State): void {
  const p = statePath(mindstashDir);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(tmp, p);
  } finally {
    rmSync(tmp, { force: true });
  }
}
