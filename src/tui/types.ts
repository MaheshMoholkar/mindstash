import type { Plan } from '../core/fix.js';
import type { Operation } from '../core/state.js';

export type Focus = 'sidebar' | 'main' | 'detail';

/** Where the user is; kept across an $EDITOR round trip. */
export interface Ui {
  entryKey: string;
  focus: Focus;
  cursor: number;
  sidebarHidden: boolean;
}

export type Overlay =
  | { kind: 'confirm'; plan: Plan }
  | { kind: 'undo'; op: Operation }
  | { kind: 'help' }
  | { kind: 'palette'; query: string; cursor: number }
  | { kind: 'welcome' }
  | { kind: 'skill' };

export interface Message {
  tone: 'ok' | 'error' | 'info';
  text: string;
}
