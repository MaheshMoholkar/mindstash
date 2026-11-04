import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * What a repo contains, according to git: tracked plus untracked-but-not-ignored files,
 * and every folder above them. Lets rules match partial paths like "service/foo.go"
 * that live deeper in a monorepo.
 */
export class RepoIndex {
  private entries: string[] | undefined;
  private constructor(
    readonly root: string,
    private readonly git: boolean,
  ) {}

  private static cache = new Map<string, RepoIndex>();

  static for(root: string): RepoIndex {
    let r = RepoIndex.cache.get(root);
    if (!r) {
      r = new RepoIndex(root, existsSync(join(root, '.git')));
      RepoIndex.cache.set(root, r);
    }
    return r;
  }

  static clearCache(): void {
    RepoIndex.cache.clear();
  }

  private list(): string[] {
    if (this.entries) return this.entries;
    const out = new Set<string>();
    if (this.git) {
      try {
        const files = execFileSync('git', ['-C', this.root, 'ls-files', '-co', '--exclude-standard'], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).split('\n');
        for (const f of files) {
          if (!f) continue;
          out.add(f);
          for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) out.add(f.slice(0, i));
        }
      } catch {
        /* not a usable repo */
      }
    }
    this.entries = [...out];
    return this.entries;
  }

  private ignored(p: string): boolean {
    if (!this.git) return false;
    try {
      execFileSync('git', ['-C', this.root, 'check-ignore', '-q', '--no-index', p], { stdio: 'ignore' });
      return true; // exit 0 = ignored
    } catch {
      return false;
    }
  }

  /**
   * Is a relative path from a memory missing? "Unknown" (gitignored, e.g. dist/) counts as present:
   * MindStash only flags what it can check.
   */
  missing(rel: string): boolean {
    const p = rel.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!p || existsSync(resolve(this.root, p))) return false;
    if (!this.git) return true;
    const suffix = '/' + p;
    if (this.list().some((e) => e === p || e.endsWith(suffix))) return false;
    // Keep a trailing slash so folder-only patterns like "dist/" match a folder that's gone.
    return !this.ignored(rel.endsWith('/') ? p + '/' : p);
  }
}
