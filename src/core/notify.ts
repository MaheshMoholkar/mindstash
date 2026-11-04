/**
 * Cheap, cached views of the latest scan for places that must be fast: the Claude Code
 * status line and the session-start hook. They never scan inline; they read the last scan
 * and, when it's old, start a background rescan for next time.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, saveState, type State } from './state.js';
import type { ScanContext } from './types.js';

export const STALE_AFTER_MS = 15 * 60 * 1000;

function openFindings(state: State) {
  return (state.lastScan?.findings ?? []).filter((f) => !state.ignored[f.id]);
}

export function counts(state: State): { open: number; fresh: string[] } {
  const open = openFindings(state);
  const seen = new Set(state.seen);
  return { open: open.length, fresh: open.filter((f) => !seen.has(f.id)).map((f) => f.id) };
}

/** Called when the user has looked (terminal UI, report, or their agent's /mindstash). */
export function markSeen(ctx: ScanContext, ids: string[]): void {
  const state = loadState(ctx.mindstashDir);
  state.seen = [...new Set([...state.seen, ...ids])].slice(-5000);
  saveState(ctx.mindstashDir, state);
}

/** Rescan in the background if the cached scan is old. Never blocks. */
export function refreshInBackground(ctx: ScanContext, script: string | undefined): void {
  const state = loadState(ctx.mindstashDir);
  const at = state.lastScan ? Date.parse(state.lastScan.at) : 0;
  if (Date.now() - at < STALE_AFTER_MS || !script) return;
  try {
    const child = spawn(process.execPath, [script, 'scan', '--json', '--background'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch {
    /* best effort */
  }
}

export function statusText(state: State): string {
  if (!state.lastScan) return '🧠 mindstash: run a scan';
  const { open, fresh } = counts(state);
  if (open === 0) return '🧠 all clear';
  return fresh.length ? `🧠 ${fresh.length} new · ${open} to review` : `🧠 ${open} to review`;
}

/** Session-start note: only for findings the user hasn't seen or been told about. */
export function sessionNote(ctx: ScanContext): string | undefined {
  const state = loadState(ctx.mindstashDir);
  const { fresh } = counts(state);
  const told = new Set(state.notified ?? []);
  const news = fresh.filter((id) => !told.has(id));
  if (!news.length) return undefined;
  state.notified = [...new Set([...(state.notified ?? []), ...news])].slice(-5000);
  saveState(ctx.mindstashDir, state);
  const byRule = new Map<string, number>();
  for (const f of state.lastScan?.findings ?? []) if (news.includes(f.id)) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const detail = [...byRule].map(([r, n]) => `${n} ${r}`).join(', ');
  return `MindStash: ${news.length} new finding${news.length === 1 ? '' : 's'} in your agent memories (${detail}). Say /mindstash to review.`;
}

/* ---------------------------------------------------------------- settings.json */

type Settings = {
  statusLine?: { type: string; command: string };
  hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  [k: string]: unknown;
};

function settingsPath(ctx: ScanContext): string {
  return join(ctx.claudeDir, 'settings.json');
}

function readSettings(ctx: ScanContext): Settings {
  const p = settingsPath(ctx);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Settings;
  } catch (e) {
    throw new Error(`Can't read ${p}: ${(e as Error).message}. Fix it first; MindStash won't overwrite it.`);
  }
}

function writeSettings(ctx: ScanContext, s: Settings): string {
  const p = settingsPath(ctx);
  const backup = p + '.mindstash-backup';
  if (existsSync(p)) copyFileSync(p, backup);
  writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  return backup;
}

export function installStatusLine(ctx: ScanContext, cmd: string, remove = false): string {
  const s = readSettings(ctx);
  const ours = s.statusLine?.command?.includes('mindstash');
  if (remove) {
    if (!ours) return 'No MindStash status line to remove.';
    delete s.statusLine;
    writeSettings(ctx, s);
    return 'Removed the MindStash status line.';
  }
  if (s.statusLine && !ours) {
    throw new Error(
      `You already have a status line (${s.statusLine.command}). MindStash won't replace it. ` +
        `To combine them, add \`$(${cmd} statusline)\` to your own status line script.`,
    );
  }
  s.statusLine = { type: 'command', command: `${cmd} statusline` };
  const backup = writeSettings(ctx, s);
  return `Status line set. Restart Claude Code to see it. (Previous settings saved to ${backup}.)`;
}

export function installHook(ctx: ScanContext, cmd: string, remove = false): string {
  const s = readSettings(ctx);
  s.hooks ??= {};
  const list = (s.hooks.SessionStart ??= []);
  const isOurs = (h: { hooks: { command: string }[] }) => h.hooks.some((x) => x.command.includes('mindstash hook'));
  if (remove) {
    const before = list.length;
    s.hooks.SessionStart = list.filter((h) => !isOurs(h));
    if (s.hooks.SessionStart.length === before) return 'No MindStash hook to remove.';
    writeSettings(ctx, s);
    return 'Removed the MindStash session-start hook.';
  }
  if (list.some(isOurs)) return 'The MindStash session-start hook is already installed.';
  list.push({ hooks: [{ type: 'command', command: `${cmd} hook session-start` }] });
  const backup = writeSettings(ctx, s);
  return `Session-start hook added next to your existing hooks. (Previous settings saved to ${backup}.)`;
}
