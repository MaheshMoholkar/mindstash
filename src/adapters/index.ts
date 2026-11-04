import type { Adapter } from '../core/types.js';
import { claudeCode } from './claude-code.js';

/** One adapter per agent. Codex, Gemini CLI and Cursor come next. */
export const adapters: Adapter[] = [claudeCode];
