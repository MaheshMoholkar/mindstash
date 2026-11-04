/** Agent-agnostic data model. Adapters produce Projects and Items; rules produce Findings. */

export type ItemKind = 'memory' | 'index' | 'skill' | 'instructions';

export interface Scope {
  kind: 'global' | 'project';
  /** Folder this item belongs to (project root, or the folder holding a CLAUDE.md). */
  dir?: string;
  /** Short display label, e.g. "global" or "~/work/api". */
  label: string;
}

export interface Project {
  agent: string;
  /** Agent's own id for the project (Claude Code: the sanitized folder name). */
  key: string;
  /** Best guess at the project folder. */
  path: string;
  /** False when the folder could not be found on disk. */
  exists: boolean;
  /** Where the agent keeps this project's memory files, if anywhere. */
  memoryDir?: string;
  indexPath?: string;
  /** Instruction files a session here loads, in order (Codex AGENTS.md chain). */
  instructionChain?: string[];
}

export interface Item {
  /** Stable id: hash of agent + path. */
  id: string;
  agent: string;
  kind: ItemKind;
  name: string;
  description?: string;
  path: string;
  scope: Scope;
  /** Project this item belongs to (memories and the index). */
  projectKey?: string;
  /** Content without frontmatter. */
  body: string;
  raw: string;
  /** Hash of raw content, used to refuse fixes on files changed since the scan. */
  hash: string;
  modified: Date;
  /** Tokens this item puts into every session (index line, skill description, whole CLAUDE.md...). */
  loadTokens: number;
  /** Tokens of the whole file. */
  sizeTokens: number;
  /** Items MindStash must never change (plugin skills, CLAUDE.md files). */
  readOnly: boolean;
  /** For memories: the MEMORY.md that lists them. */
  indexPath?: string;
  /** For memories: whether the index links to this file. */
  indexed?: boolean;
  /** For the index: number of lines. */
  lines?: number;
  /** Skill source: "user", "project" or "plugin:<name>". */
  source?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export type Category = 'stale' | 'scope' | 'similar' | 'contradiction' | 'relearned' | 'index';

export type FixKind = 'delete' | 'archive' | 'move' | 'ignore' | 'relink' | 'restore';

/** Where a "move" fix sends a memory. */
export interface MoveTarget {
  projectPath: string;
  memoryDir: string;
  indexPath: string;
  label: string;
}

export interface Finding {
  id: string;
  rule: string;
  category: Category;
  confidence: Confidence;
  /** One-line summary for lists. */
  title: string;
  /** Why it was flagged, one or more sentences. */
  reasons: string[];
  itemIds: string[];
  /** Tokens per session spent on the flagged items. */
  tokens: number;
  fixes: FixKind[];
  moveTo?: MoveTarget;
  /** For broken index links: the missing file name. */
  missingLink?: string;
}

export interface ScanContext {
  home: string;
  claudeDir: string;
  codexDir: string;
  mindstashDir: string;
  now: Date;
}

export interface AdapterScan {
  projects: Project[];
  items: Item[];
}

export interface Adapter {
  id: string;
  name: string;
  detect(ctx: ScanContext): Promise<boolean>;
  scan(ctx: ScanContext): Promise<AdapterScan>;
}

export interface AgentSummary {
  id: string;
  name: string;
  found: boolean;
  projects: number;
  memories: number;
  skills: number;
}

export interface ScanResult {
  at: Date;
  agents: AgentSummary[];
  projects: Project[];
  items: Item[];
  findings: Finding[];
  /** Findings hidden because the user marked them "not a problem". */
  ignoredCount: number;
  /** Possible contradictions waiting for the user's agent to judge (`mindstash check`). */
  pendingChecks: number;
}
