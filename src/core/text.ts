import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

/** Rough token estimate. Exact counts aren't needed; ~4 characters per token. */
export function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function shortHash(text: string, len = 6): string {
  return createHash('sha1').update(text).digest('hex').slice(0, len);
}

export function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/** Claude Code's folder naming: every non-alphanumeric character becomes "-". */
export function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

export function tildify(p: string, home: string): string {
  if (p === home) return '~';
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length);
  return p;
}

export function untildify(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return home + p.slice(1);
  return p;
}

export interface Parsed {
  data: Record<string, unknown>;
  body: string;
}

/** Split YAML frontmatter from a markdown file. Bad YAML is treated as no frontmatter. */
export function parseFrontmatter(raw: string): Parsed {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  try {
    const data = parseYaml(m[1] ?? '');
    return {
      data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
      body: raw.slice(m[0].length),
    };
  } catch {
    return { data: {}, body: raw };
  }
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Split prose into sentences/lines for rules that work per sentence. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z(*`"'\-])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : one.slice(0, max - 1).trimEnd() + '…';
}

export function plural(n: number, word: string, many = word + 's'): string {
  return `${n} ${n === 1 ? word : many}`;
}
