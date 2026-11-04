import type { Plan, Requests } from '../core/fix.js';
import type { Operation } from '../core/state.js';
import type { Category, ScanContext, ScanResult } from '../core/types.js';

export type Screen =
  | { kind: 'first' }
  | { kind: 'offer-skill' }
  | { kind: 'home' }
  | { kind: 'findings'; category: Category }
  | { kind: 'detail'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'confirm'; plan: Plan }
  | { kind: 'undo'; op: Operation }
  | { kind: 'browse' }
  | { kind: 'cost' }
  | { kind: 'help' };

export interface Toast {
  tone: 'ok' | 'error' | 'info';
  text: string;
  /** Offer [u] Undo next to the message. */
  undo?: boolean;
}

/** Everything a screen can do. Screens call `common` for keys they don't handle. */
export interface Nav {
  ctx: ScanContext;
  result: ScanResult;
  push(s: Screen): void;
  pop(): void;
  /** Replace the whole stack (leaving first-run screens). */
  reset(s: Screen): void;
  skillInstalled(): boolean;
  /** Turn fix requests into a plan and open the confirm screen. */
  act(req: Requests): void;
  apply(plan: Plan): void;
  askUndo(): void;
  undo(): void;
  edit(paths: string[]): void;
  installSkill(): void;
  toast(t: Toast | null): void;
  quit(): void;
  common(input: string, key: { escape?: boolean }): void;
}
