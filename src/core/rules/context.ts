import type { Finding, Item, Project, ScanContext } from '../types.js';
import type { State } from '../state.js';
import { shortHash } from '../text.js';

export interface RuleInput {
  ctx: ScanContext;
  projects: Project[];
  items: Item[];
  state: State;
  projectOf(item: Item): Project | undefined;
}

export type Rule = (input: RuleInput) => Finding[];

/** Finding ids depend only on the rule and the files involved, so they survive rescans. */
export function findingId(rule: string, parts: string[]): string {
  return shortHash(rule + '\0' + [...parts].sort().join('\0'));
}

export function memoryFixes(items: Item[]): Finding['fixes'] {
  return items.every((i) => i.kind === 'memory' && !i.readOnly) ? ['delete', 'archive', 'ignore'] : ['ignore'];
}

export function sumLoad(items: Item[]): number {
  return items.reduce((n, i) => n + i.loadTokens, 0);
}
