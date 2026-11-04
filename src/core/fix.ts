import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { Backup } from './backup.js';
import { signature } from './minhash.js';
import { loadState, saveState, type Operation, type StoredFinding, type StoredTarget } from './state.js';
import { contentHash, parseFrontmatter, shortHash } from './text.js';
import type { FixKind, ScanContext } from './types.js';

export type Requests = Partial<Record<FixKind, string[]>>;

export type Action =
  | { kind: 'delete'; findingId: string; target: StoredTarget }
  | { kind: 'archive'; findingId: string; target: StoredTarget; dest: string }
  | { kind: 'move'; findingId: string; target: StoredTarget; dest: string; destIndex: string; label: string }
  | { kind: 'unlink'; findingId: string; indexPath: string; file: string }
  | { kind: 'delete-skill'; findingId: string; target: StoredTarget; dir: string; files: string[] }
  | { kind: 'archive-skill'; findingId: string; target: StoredTarget; dir: string; files: string[]; dest: string }
  | { kind: 'ignore'; findingId: string; finding: StoredFinding };

export interface Plan {
  actions: Action[];
  tokensSaved: number;
}

export class FixError extends Error {}

/** Remove the index line(s) linking to `file`. Returns the removed lines. */
function removeIndexLine(indexPath: string, file: string): string[] {
  if (!existsSync(indexPath)) return [];
  const lines = readFileSync(indexPath, 'utf8').split('\n');
  const needle = `](${file})`;
  const kept = lines.filter((l) => !l.includes(needle));
  const removed = lines.filter((l) => l.includes(needle));
  if (removed.length) writeFileSync(indexPath, kept.join('\n'));
  return removed;
}

function uniqueDest(dir: string, file: string): string {
  let dest = join(dir, file);
  for (let n = 2; existsSync(dest); n++) dest = join(dir, file.endsWith('.md') ? file.replace(/\.md$/, `-${n}.md`) : `${file}-${n}`);
  return dest;
}

/** Every file under a folder (skills can carry references/, scripts/ …). */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

function checkUnchanged(id: string, t: StoredTarget): void {
  if (!existsSync(t.path)) throw new FixError(`${id}: ${t.path} no longer exists. Run \`mindstash scan\` again.`);
  if (contentHash(readFileSync(t.path, 'utf8')) !== t.hash) {
    throw new FixError(`${id}: ${basename(t.path)} changed since the last scan. Run \`mindstash scan\` again.`);
  }
}

/**
 * Turn finding ids (or item ids, for acting on one memory or skill directly) into concrete
 * actions. Only ids from the latest scan are accepted, so this can never touch an arbitrary file.
 */
export function plan(ctx: ScanContext, requests: Requests): Plan {
  const state = loadState(ctx.mindstashDir);
  if (!state.lastScan) throw new FixError('No scan yet. Run `mindstash scan` first.');
  const byId = new Map(state.lastScan.findings.map((f) => [f.id, f]));
  const itemsById = new Map(state.lastScan.items.map((t) => [t.itemId, t]));
  const actions: Action[] = [];
  const claimed = new Map<string, string>(); // path -> action kind
  let tokensSaved = 0;

  const claim = (path: string, kind: string, id: string) => {
    const prev = claimed.get(path);
    if (prev && prev !== kind) throw new FixError(`${id}: ${basename(path)} is already set to ${prev} by another finding.`);
    const dup = prev === kind;
    claimed.set(path, kind);
    return dup;
  };

  /** One memory or skill, picked directly rather than through a finding. */
  const itemAction = (kind: 'delete' | 'archive', id: string, t: StoredTarget) => {
    checkUnchanged(id, t);
    if (t.kind === 'memory') {
      if (claim(t.path, kind, id)) return;
      tokensSaved += t.loadTokens;
      if (kind === 'delete') actions.push({ kind, findingId: id, target: t });
      else {
        const dir = join(ctx.mindstashDir, 'archive', t.agent ?? 'claude-code', t.projectKey ?? 'unknown');
        actions.push({ kind, findingId: id, target: t, dest: uniqueDest(dir, basename(t.path)) });
      }
      return;
    }
    // A skill is its whole folder.
    const dir = dirname(t.path);
    if (lstatSync(dir).isSymbolicLink()) {
      throw new FixError(`${id}: skill "${t.name}" is a link to another folder; remove it where it lives.`);
    }
    if (claim(dir, kind, id)) return;
    tokensSaved += t.loadTokens;
    const files = filesUnder(dir);
    if (kind === 'delete') actions.push({ kind: 'delete-skill', findingId: id, target: t, dir, files });
    else {
      const root = join(ctx.mindstashDir, 'archive', t.agent ?? 'claude-code', 'skills');
      actions.push({ kind: 'archive-skill', findingId: id, target: t, dir, files, dest: uniqueDest(root, basename(dir)) });
    }
  };

  for (const kind of ['delete', 'archive', 'move', 'ignore'] as const) {
    for (const id of requests[kind] ?? []) {
      const f = byId.get(id);
      const item = f ? undefined : itemsById.get(id);
      if (item) {
        if (kind !== 'delete' && kind !== 'archive') throw new FixError(`${id}: ${item.name} can only be deleted or archived directly.`);
        itemAction(kind, id, item);
        continue;
      }
      if (!f) throw new FixError(`Unknown id "${id}". Ids come from the latest \`mindstash scan\`.`);
      if (!f.fixes.includes(kind)) {
        throw new FixError(`${id} (${f.rule}) can't be fixed with ${kind}. Allowed: ${f.fixes.join(', ')}.`);
      }
      if (kind === 'ignore') {
        actions.push({ kind, findingId: id, finding: f });
        continue;
      }
      if (f.rule === 'broken-link') {
        const idx = f.targets[0]!;
        actions.push({ kind: 'unlink', findingId: id, indexPath: idx.path, file: f.missingLink! });
        tokensSaved += f.tokens;
        continue;
      }
      for (const t of f.targets) {
        if (t.readOnly || t.kind !== 'memory') throw new FixError(`${id}: ${t.name} is read-only for MindStash.`);
        checkUnchanged(id, t);
        if (claim(t.path, kind, id)) continue;
        // A move still loads, just in the right place, so it saves nothing.
        if (kind !== 'move') tokensSaved += t.loadTokens;
        if (kind === 'delete') actions.push({ kind, findingId: id, target: t });
        else if (kind === 'archive') {
          const dir = join(ctx.mindstashDir, 'archive', 'claude-code', t.projectKey ?? 'unknown');
          actions.push({ kind, findingId: id, target: t, dest: uniqueDest(dir, basename(t.path)) });
        } else {
          const to = f.moveTo!;
          const dest = join(to.memoryDir, basename(t.path));
          if (existsSync(dest)) throw new FixError(`${id}: ${dest} already exists; move it by hand.`);
          actions.push({ kind, findingId: id, target: t, dest, destIndex: to.indexPath, label: to.label });
        }
      }
    }
  }
  return { actions, tokensSaved };
}

export function describe(a: Action): string {
  switch (a.kind) {
    case 'delete':
      return `✕ delete   ${a.target.name}   ${a.target.scope}`;
    case 'archive':
      return `↓ archive  ${a.target.name}   ${a.target.scope}`;
    case 'move':
      return `→ move     ${a.target.name}   ${a.target.scope} → ${a.label}`;
    case 'unlink':
      return `✕ remove   index line for ${a.file}`;
    case 'ignore':
      return `○ ignore   ${a.finding.title}`;
    case 'delete-skill':
      return `✕ delete   skill ${a.target.name}   ${a.target.scope} (${a.files.length} file${a.files.length === 1 ? '' : 's'})`;
    case 'archive-skill':
      return `↓ archive  skill ${a.target.name}   ${a.target.scope}`;
  }
}

/** Back up, apply, and record the operation so `undo` can revert it. */
export function apply(ctx: ScanContext, p: Plan): Operation {
  const state = loadState(ctx.mindstashDir);
  const touched: string[] = [];
  for (const a of p.actions) {
    if (a.kind === 'ignore') continue;
    if (a.kind === 'unlink') {
      touched.push(a.indexPath);
      continue;
    }
    if (a.kind === 'delete-skill' || a.kind === 'archive-skill') {
      touched.push(...a.files);
      if (a.kind === 'archive-skill') touched.push(...a.files.map((f) => join(a.dest, relative(a.dir, f))));
      continue;
    }
    touched.push(a.target.path);
    if (a.target.indexPath) touched.push(a.target.indexPath);
    if (a.kind === 'archive') touched.push(a.dest);
    if (a.kind === 'move') touched.push(a.dest, a.destIndex);
  }

  const summary = p.actions.map(describe).join('\n');
  const backup = new Backup(ctx.mindstashDir);
  const { commit, touched: snap } = backup.snapshot(touched, `before: ${p.actions.length} change(s)\n\n${summary}`);

  const ignored: string[] = [];
  const deletedAdded: string[] = [];
  const at = ctx.now.toISOString();

  for (const a of p.actions) {
    switch (a.kind) {
      case 'ignore':
        if (!state.ignored[a.findingId]) {
          state.ignored[a.findingId] = { rule: a.finding.rule, title: a.finding.title, at };
          ignored.push(a.findingId);
        }
        break;
      case 'unlink':
        removeIndexLine(a.indexPath, a.file);
        break;
      case 'delete-skill':
        rmSync(a.dir, { recursive: true });
        break;
      case 'archive-skill':
        mkdirSync(dirname(a.dest), { recursive: true });
        renameSync(a.dir, a.dest);
        break;
      case 'delete': {
        // Keep a text-free fingerprint so a re-learned copy can be spotted later.
        const { body, data } = parseFrontmatter(readFileSync(a.target.path, 'utf8'));
        const key = shortHash(a.target.path + at, 10);
        state.deleted.push({
          key,
          name: a.target.name,
          scope: a.target.scope,
          at,
          sig: signature(`${typeof data.description === 'string' ? data.description : ''}\n${body}`),
        });
        deletedAdded.push(key);
        rmSync(a.target.path);
        if (a.target.indexPath) removeIndexLine(a.target.indexPath, basename(a.target.path));
        break;
      }
      case 'archive':
        mkdirSync(dirname(a.dest), { recursive: true });
        renameSync(a.target.path, a.dest);
        if (a.target.indexPath) removeIndexLine(a.target.indexPath, basename(a.target.path));
        break;
      case 'move': {
        const file = basename(a.target.path);
        const lines = a.target.indexPath ? removeIndexLine(a.target.indexPath, file) : [];
        mkdirSync(dirname(a.dest), { recursive: true });
        renameSync(a.target.path, a.dest);
        const line = lines[0] ?? `- [${a.target.name}](${file})`;
        const existing = existsSync(a.destIndex) ? readFileSync(a.destIndex, 'utf8') : '';
        const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
        writeFileSync(a.destIndex, existing + sep + line + '\n');
        break;
      }
    }
  }

  const op: Operation = {
    id: shortHash(commit + at),
    at,
    commit,
    summary,
    touched: snap,
    ignored,
    deletedAdded,
    undone: false,
  };
  state.history.push(op);
  saveState(ctx.mindstashDir, state);
  return op;
}

/** Revert the most recent operation that hasn't been undone. */
export function undo(ctx: ScanContext): Operation | undefined {
  const state = loadState(ctx.mindstashDir);
  const op = [...state.history].reverse().find((o) => !o.undone);
  if (!op) return undefined;
  const backup = new Backup(ctx.mindstashDir);
  backup.restore(op.commit, op.touched);
  for (const id of op.ignored) delete state.ignored[id];
  state.deleted = state.deleted.filter((d) => !op.deletedAdded.includes(d.key));
  op.undone = true;
  backup.note(`undo ${op.commit.slice(0, 8)}`);
  saveState(ctx.mindstashDir, state);
  return op;
}
