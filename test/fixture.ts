import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sanitizePath } from '../src/core/text.js';
import { RepoIndex } from '../src/core/repo.js';
import type { ScanContext } from '../src/core/types.js';

/** A throwaway home folder with a fake ~/.claude, built per test. */
export class Fixture {
  readonly root: string;
  readonly home: string;
  readonly claudeDir: string;
  readonly codexDir: string;
  readonly mindstashDir: string;

  constructor() {
    // realpath: macOS tmp lives under /private, and project folders are decoded from disk.
    this.root = realpathSync(mkdtempSync(join(tmpdir(), 'mindstash-test-')));
    this.home = join(this.root, 'home');
    this.claudeDir = join(this.home, '.claude');
    this.codexDir = join(this.home, '.codex');
    this.mindstashDir = join(this.home, '.mindstash');
    mkdirSync(join(this.claudeDir, 'projects'), { recursive: true });
    RepoIndex.clearCache();
  }

  ctx(now = new Date('2026-11-04T12:00:00')): ScanContext {
    return { home: this.home, claudeDir: this.claudeDir, codexDir: this.codexDir, mindstashDir: this.mindstashDir, now };
  }

  write(path: string, content: string, mtime?: Date): string {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (mtime) utimesSync(path, mtime, mtime);
    return path;
  }

  /** A project folder (optionally a git repo with files). */
  project(rel: string, files: Record<string, string> = {}, git = false): string {
    const dir = join(this.home, rel);
    mkdirSync(dir, { recursive: true });
    for (const [f, c] of Object.entries(files)) this.write(join(dir, f), c);
    if (git) {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init', '--allow-empty'], { cwd: dir });
    }
    return dir;
  }

  memoryDir(projectPath: string): string {
    return join(this.claudeDir, 'projects', sanitizePath(projectPath), 'memory');
  }

  /** Write a memory file and (by default) list it in MEMORY.md. */
  memory(
    projectPath: string,
    file: string,
    body: string,
    opts: { name?: string; description?: string; modified?: string; indexed?: boolean } = {},
  ): string {
    const dir = this.memoryDir(projectPath);
    const name = opts.name ?? file.replace(/\.md$/, '');
    const fm = [
      '---',
      `name: ${name}`,
      `description: ${opts.description ?? name}`,
      'metadata:',
      '  type: project',
      ...(opts.modified ? [`  modified: ${opts.modified}`] : []),
      '---',
      '',
    ].join('\n');
    const path = this.write(join(dir, file), fm + body + '\n');
    if (opts.indexed !== false) this.indexLine(projectPath, `- [${name}](${file}) — ${opts.description ?? name}`);
    return path;
  }

  indexLine(projectPath: string, line: string): void {
    const idx = join(this.memoryDir(projectPath), 'MEMORY.md');
    const cur = existsSync(idx) ? readFileSync(idx, 'utf8') : '';
    this.write(idx, cur + line + '\n');
  }

  skill(dir: string, name: string, description: string): string {
    return this.write(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  }

  plugin(name: string, skills: Record<string, string>): void {
    const installPath = join(this.claudeDir, 'plugins', 'cache', 'mp', name, '1.0.0');
    for (const [s, d] of Object.entries(skills)) this.skill(join(installPath, 'skills'), s, d);
    this.write(
      join(this.claudeDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { [`${name}@mp`]: [{ scope: 'user', installPath }] } }),
    );
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
