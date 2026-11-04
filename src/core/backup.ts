import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Backups are a plain git repo in ~/.mindstash/backups. Before each fix, every file it
 * will touch is copied to files/<absolute path> and committed. Undo restores from that commit.
 */
export class Backup {
  readonly dir: string;

  constructor(mindstashDir: string) {
    this.dir = join(mindstashDir, 'backups');
  }

  private git(...args: string[]): string {
    try {
      return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      const err = e as { code?: string; stderr?: string; message: string };
      if (err.code === 'ENOENT') throw new Error('MindStash needs git for backups and undo, but git was not found.');
      throw new Error(`git ${args[0]} failed in ${this.dir}: ${err.stderr?.trim() || err.message}`);
    }
  }

  private ensure(): void {
    if (existsSync(join(this.dir, '.git'))) return;
    mkdirSync(this.dir, { recursive: true });
    this.git('init', '-q');
    this.git('config', 'user.name', 'MindStash');
    this.git('config', 'user.email', 'mindstash@localhost');
    this.git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(this.dir, 'README.md'), 'MindStash backups. Each commit is the state of files before a fix.\n');
    this.git('add', 'README.md');
    this.git('commit', '-q', '-m', 'init');
  }

  private rel(path: string): string {
    return join('files', path.replace(/^\/+/, ''));
  }

  /** Save the current content of `paths`. Returns the commit id and which paths existed. */
  snapshot(paths: string[], message: string): { commit: string; touched: { path: string; existed: boolean }[] } {
    this.ensure();
    const touched = [...new Set(paths)].map((path) => ({ path, existed: existsSync(path) }));
    for (const { path, existed } of touched) {
      const dest = join(this.dir, this.rel(path));
      if (existed) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(path, dest);
      } else {
        rmSync(dest, { force: true });
      }
    }
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', message);
    return { commit: this.git('rev-parse', 'HEAD'), touched };
  }

  /** Put every touched path back the way it was at `commit`. */
  restore(commit: string, touched: { path: string; existed: boolean }[]): void {
    this.ensure();
    for (const { path, existed } of touched) {
      if (!existed) {
        rmSync(path, { force: true });
        continue;
      }
      const content = execFileSync('git', ['show', `${commit}:${this.rel(path)}`], { cwd: this.dir });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }

  note(message: string): void {
    this.ensure();
    this.git('commit', '-q', '--allow-empty', '-m', message);
  }
}
