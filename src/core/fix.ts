import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { decodeProjectKey, indexLinks } from '../adapters/claude-code.js';
import { Backup } from './backup.js';
import { signature } from './minhash.js';
import { loadState, saveState, type Archived, type Operation, type StoredFinding, type StoredTarget } from './state.js';
import { contentHash, parseFrontmatter, sanitizePath, shortHash, tildify } from './text.js';
import type { FixKind, MoveTarget, ScanContext } from './types.js';

export type Requests = Partial<Record<FixKind, string[]>>;

export type Action =
  | { kind: 'delete'; findingId: string; target: StoredTarget }
  | { kind: 'archive'; findingId: string; target: StoredTarget; dest: string }
  | { kind: 'move'; findingId: string; target: StoredTarget; dest: string; destIndex: string; projectPath: string; label: string }
  | { kind: 'unlink'; findingId: string; indexPath: string; file: string }
  | { kind: 'delete-skill'; findingId: string; target: StoredTarget; dir: string; files: string[] }
  | { kind: 'relink'; findingId: string; target: StoredTarget; indexPath: string; line: string }
  | { kind: 'restore'; findingId: string; entry: Archived; files: { from: string; to: string }[] }
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

export interface PlanOptions {
  /** Where "move" sends memories when the user picked a project (overrides a finding's suggestion). */
  moveTo?: MoveTarget;
}

/** Move target for a Claude Code project folder. */
export function moveTargetFor(ctx: ScanContext, folder: string): MoveTarget {
  checkProjectFolder(folder, tildify(folder, ctx.home));
  const projectPath = realpathSync(folder);
  const key = sanitizePath(projectPath);
  const label = tildify(projectPath, ctx.home);
  if (decodeProjectKey(key) !== projectPath) throw new FixError(`Claude Code's project key for ${label} is ambiguous.`);
  const memoryDir = join(ctx.claudeDir, 'projects', key, 'memory');
  return { projectPath, memoryDir, indexPath: join(memoryDir, 'MEMORY.md'), label };
}

function movable(t: StoredTarget): boolean {
  return !t.readOnly && t.kind === 'memory' && (t.agent ?? 'claude-code') === 'claude-code';
}

function checkProjectFolder(path: string, label: string): void {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new FixError(`Project folder does not exist: ${label}`);
}

function checkMoveDestination(dest: string, id: string): void {
  if (lstatSync(dest, { throwIfNoEntry: false })) throw new FixError(`${id}: ${dest} already exists.`);
}

/**
 * Turn finding ids (or item ids, for acting on one memory or skill directly) into concrete
 * actions. Only ids from the latest scan are accepted, so this can never touch an arbitrary file.
 */
export function plan(ctx: ScanContext, requests: Requests, opts: PlanOptions = {}): Plan {
  const state = loadState(ctx.mindstashDir);
  if (!state.lastScan) throw new FixError('No scan yet. Run `mindstash scan` first.');
  const byId = new Map(state.lastScan.findings.map((f) => [f.id, f]));
  const itemsById = new Map(state.lastScan.items.map((t) => [t.itemId, t]));
  const actions: Action[] = [];
  const claimed = new Map<string, string>(); // path -> action kind
  const moveDestinations = new Set<string>();
  let tokensSaved = 0;

  const claim = (path: string, kind: string, id: string) => {
    const prev = claimed.get(path);
    if (prev && prev !== kind) throw new FixError(`${id}: ${basename(path)} is already set to ${prev} by another finding.`);
    const dup = prev === kind;
    claimed.set(path, kind);
    return dup;
  };

  const moveMemory = (id: string, t: StoredTarget, to: MoveTarget) => {
    const dest = join(to.memoryDir, basename(t.path));
    if (dest === t.path) throw new FixError(`${id}: ${t.name} is already in ${to.label}.`);
    if (claim(t.path, 'move', id)) return;
    checkProjectFolder(to.projectPath, to.label);
    checkMoveDestination(dest, id);
    if (moveDestinations.has(dest)) throw new FixError(`${id}: more than one memory would move to ${dest}.`);
    moveDestinations.add(dest);
    actions.push({ kind: 'move', findingId: id, target: t, dest, destIndex: to.indexPath, projectPath: to.projectPath, label: to.label });
  };

  const itemAction = (kind: 'delete' | 'archive' | 'move', id: string, t: StoredTarget) => {
    checkUnchanged(id, t);
    if (kind === 'move') {
      if (!movable(t)) throw new FixError(`${id}: only Claude Code memories can be moved.`);
      if (!opts.moveTo) throw new FixError(`${id}: pick a project to move it to.`);
      return moveMemory(id, t, opts.moveTo);
    }
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

  // Restore: ids come from the archive list, not the scan.
  for (const id of requests.restore ?? []) {
    const entry = state.archived.find((a) => a.id === id);
    if (!entry) throw new FixError(`Unknown archived id "${id}". See \`mindstash archived\`.`);
    if (!existsSync(entry.to)) throw new FixError(`${id}: the archived copy at ${entry.to} is gone.`);
    if (existsSync(entry.from)) throw new FixError(`${id}: ${entry.from} exists again; move or remove it first.`);
    const files =
      entry.kind === 'skill'
        ? filesUnder(entry.to).map((f) => ({ from: f, to: join(entry.from, relative(entry.to, f)) }))
        : [{ from: entry.to, to: entry.from }];
    actions.push({ kind: 'restore', findingId: id, entry, files });
  }

  for (const kind of ['delete', 'archive', 'move', 'ignore', 'relink'] as const) {
    for (const id of requests[kind] ?? []) {
      const f = byId.get(id);
      const item = f ? undefined : itemsById.get(id);
      if (item) {
        if (kind !== 'delete' && kind !== 'archive' && kind !== 'move') {
          throw new FixError(`${id}: ${item.name} can only be deleted, archived or moved directly.`);
        }
        itemAction(kind, id, item);
        continue;
      }
      if (!f) throw new FixError(`Unknown id "${id}". Ids come from the latest \`mindstash scan\`.`);
      // Moving to a project the user picked works for any finding over Claude Code memories.
      const pickedMove = kind === 'move' && opts.moveTo && f.targets.length > 0 && f.targets.every(movable);
      if (!f.fixes.includes(kind) && !pickedMove) {
        throw new FixError(`${id} (${f.rule}) can't be fixed with ${kind}. Allowed: ${f.fixes.join(', ')}.`);
      }
      if (kind === 'ignore') {
        actions.push({ kind, findingId: id, finding: f });
        continue;
      }
      if (kind === 'relink') {
        const t = f.targets[0]!;
        checkUnchanged(id, t);
        if (!t.indexPath) throw new FixError(`${id}: no MEMORY.md to link from.`);
        const { data } = parseFrontmatter(readFileSync(t.path, 'utf8'));
        const desc = typeof data.description === 'string' ? data.description.replace(/\s+/g, ' ').trim() : '';
        const line = `- [${t.name}](${basename(t.path)})${desc ? ` — ${desc}` : ''}`;
        actions.push({ kind, findingId: id, target: t, indexPath: t.indexPath, line });
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
        if (kind === 'move') {
          if (!movable(t)) throw new FixError(`${id}: only Claude Code memories can be moved.`);
          const to = opts.moveTo ?? f.moveTo;
          if (!to) throw new FixError(`${id}: pick a project to move it to.`);
          moveMemory(id, t, to);
          continue;
        }
        if (claim(t.path, kind, id)) continue;
        tokensSaved += t.loadTokens;
        if (kind === 'delete') actions.push({ kind, findingId: id, target: t });
        else if (kind === 'archive') {
          const dir = join(ctx.mindstashDir, 'archive', 'claude-code', t.projectKey ?? 'unknown');
          actions.push({ kind, findingId: id, target: t, dest: uniqueDest(dir, basename(t.path)) });
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
    case 'relink':
      return `+ link     ${a.target.name} into MEMORY.md   ${a.target.scope}`;
    case 'restore':
      return `↑ restore  ${a.entry.kind === 'skill' ? 'skill ' : ''}${a.entry.name}   ${a.entry.scope}`;
  }
}

/** Back up, apply, and record the operation so `undo` can revert it. */
export function apply(ctx: ScanContext, p: Plan): Operation {
  const state = loadState(ctx.mindstashDir);
  const pathsByAction = new Map<Action, string[]>();
  for (const a of p.actions) {
    const paths: string[] = [];
    pathsByAction.set(a, paths);
    switch (a.kind) {
      case 'ignore':
        break;
      case 'unlink':
      case 'relink':
        paths.push(a.indexPath);
        break;
      case 'restore':
        for (const f of a.files) paths.push(f.from, f.to);
        if (a.entry.indexPath) paths.push(a.entry.indexPath);
        break;
      case 'delete-skill':
      case 'archive-skill':
        paths.push(...a.files);
        if (a.kind === 'archive-skill') paths.push(...a.files.map((f) => join(a.dest, relative(a.dir, f))));
        break;
      default:
        paths.push(a.target.path);
        if (a.target.indexPath) paths.push(a.target.indexPath);
        if (a.kind === 'archive') paths.push(a.dest);
        if (a.kind === 'move') {
          checkUnchanged(a.findingId, a.target);
          checkProjectFolder(a.projectPath, a.label);
          checkMoveDestination(a.dest, a.findingId);
          paths.push(a.dest, a.destIndex);
        }
    }
  }
  const touched = [...pathsByAction.values()].flat();

  const summary = p.actions.map(describe).join('\n');
  const backup = new Backup(ctx.mindstashDir);
  const { commit, touched: snap } = backup.snapshot(touched, `before: ${p.actions.length} change(s)\n\n${summary}`);

  const ignored: string[] = [];
  const deletedAdded: string[] = [];
  const archivedAdded: string[] = [];
  const archivedRemoved: Archived[] = [];
  const remember = (e: Omit<Archived, 'id' | 'at'>) => {
    const entry = { ...e, id: shortHash(e.to + at, 8), at };
    state.archived.push(entry);
    archivedAdded.push(entry.id);
  };
  const appendLine = (indexPath: string, line: string) => {
    const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, existing + sep + line + '\n');
  };
  const at = ctx.now.toISOString();

  const changed = new Set<string>();
  const hasMoves = p.actions.some((a) => a.kind === 'move');
  const perform = (a: Action) => {
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
        remember({ kind: 'skill', agent: a.target.agent ?? 'claude-code', name: a.target.name, scope: a.target.scope, from: a.dir, to: a.dest });
        break;
      case 'relink':
        appendLine(a.indexPath, a.line);
        break;
      case 'restore': {
        for (const f of a.files) {
          mkdirSync(dirname(f.to), { recursive: true });
          renameSync(f.from, f.to);
        }
        if (a.entry.kind === 'skill') rmSync(a.entry.to, { recursive: true, force: true });
        if (a.entry.indexPath && a.entry.indexLine) appendLine(a.entry.indexPath, a.entry.indexLine);
        state.archived = state.archived.filter((x) => x.id !== a.entry.id);
        archivedRemoved.push(a.entry);
        break;
      }
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
      case 'archive': {
        mkdirSync(dirname(a.dest), { recursive: true });
        renameSync(a.target.path, a.dest);
        const lines = a.target.indexPath ? removeIndexLine(a.target.indexPath, basename(a.target.path)) : [];
        remember({
          kind: 'memory',
          agent: a.target.agent ?? 'claude-code',
          name: a.target.name,
          scope: a.target.scope,
          from: a.target.path,
          to: a.dest,
          indexPath: a.target.indexPath,
          indexLine: lines[0],
        });
        break;
      }
      case 'move': {
        const file = basename(a.target.path);
        checkUnchanged(a.findingId, a.target);
        mkdirSync(dirname(a.dest), { recursive: true });
        copyFileSync(a.target.path, a.dest, constants.COPYFILE_EXCL);
        changed.add(a.dest);
        if (a.target.indexPath) changed.add(a.target.indexPath);
        const lines = a.target.indexPath ? removeIndexLine(a.target.indexPath, file) : [];
        const destIndex = existsSync(a.destIndex) ? readFileSync(a.destIndex, 'utf8') : '';
        if (!indexLinks(destIndex).has(file)) {
          changed.add(a.destIndex);
          appendLine(a.destIndex, lines[0] ?? `- [${a.target.name}](${file})`);
        }
        checkUnchanged(a.findingId, a.target);
        rmSync(a.target.path);
        changed.add(a.target.path);
        break;
      }
    }
  };

  const op: Operation = {
    id: shortHash(commit + at),
    at,
    commit,
    summary,
    touched: snap,
    ignored,
    deletedAdded,
    archivedAdded,
    archivedRemoved,
    undone: false,
  };
  try {
    for (const action of p.actions) {
      if (hasMoves && action.kind !== 'move') {
        for (const path of pathsByAction.get(action)!) changed.add(path);
      }
      perform(action);
    }
    state.history.push(op);
    saveState(ctx.mindstashDir, state);
  } catch (error) {
    if (changed.size) backup.restore(commit, snap.filter(({ path }) => changed.has(path)));
    throw error;
  }
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
  state.archived = [...state.archived.filter((a) => !op.archivedAdded.includes(a.id)), ...op.archivedRemoved];
  op.undone = true;
  backup.note(`undo ${op.commit.slice(0, 8)}`);
  saveState(ctx.mindstashDir, state);
  return op;
}
