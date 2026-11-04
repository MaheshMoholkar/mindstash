import type { Adapter } from '../core/types.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';

/** One adapter per agent. Gemini CLI and Cursor come next. */
export const adapters: Adapter[] = [claudeCode, codex];

export function agentName(id: string): string {
  return adapters.find((a) => a.id === id)?.name ?? id;
}
