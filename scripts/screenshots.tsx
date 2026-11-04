/**
 * Renders README screenshots from a made-up demo setup (no real user data), as SVG.
 * Run: FORCE_COLOR=3 npx tsx scripts/screenshots.tsx
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import { scan } from '../src/core/scan.js';
import { sanitizePath } from '../src/core/text.js';
import type { ScanContext } from '../src/core/types.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mindstash-demo-')));
const home = join(root, 'home');
const ctx: ScanContext = {
  home,
  claudeDir: join(home, '.claude'),
  codexDir: join(home, '.codex'),
  mindstashDir: join(home, '.mindstash'),
  now: new Date(),
};

const write = (p: string, c: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c);
};
const project = (rel: string, files: Record<string, string> = {}, git = true) => {
  const dir = join(home, rel);
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) write(join(dir, f), c);
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=d', '-c', 'user.email=d@d', 'commit', '-qm', 'i', '--allow-empty'], { cwd: dir });
  }
  return dir;
};
const memory = (dir: string, file: string, name: string, desc: string, body: string, opts: { modified?: string; indexed?: boolean } = {}) => {
  const mdir = join(ctx.claudeDir, 'projects', sanitizePath(dir), 'memory');
  write(join(mdir, file), `---\nname: ${name}\ndescription: ${desc}\nmetadata:\n  type: project\n${opts.modified ? `  modified: ${opts.modified}\n` : ''}---\n\n${body}\n`);
  if (opts.indexed !== false) {
    const idx = join(mdir, 'MEMORY.md');
    const cur = existsSync(idx) ? readFileSync(idx, 'utf8') : '';
    write(idx, cur + `- [${name}](${file}) — ${desc}\n`);
  }
};
const skill = (dir: string, name: string, desc: string) => write(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`);

const api = project('work/shop-api', { 'package.json': JSON.stringify({ engines: { node: '>=22' } }), 'src/server.ts': 'x', 'src/routes/orders.ts': 'x' });
const web = project('work/storefront', { 'src/app.tsx': 'x' });
const gone = join(home, 'work', 'legacy-admin');
memory(api, 'node-setup.md', 'node-setup', 'build setup', 'Always build and test the API with Node 16; CI images are pinned to it.');
memory(api, 'old-endpoints.md', 'old-endpoints', 'v1 routes', 'Order endpoints live in `src/api/v1/orders.ts`; keep the v1 response shape.');
memory(api, 'concise.md', 'concise-responses', 'answer style', 'Keep responses short and skimmable; the user reads quickly and wants answers first, no fluff.');
memory(api, 'short.md', 'prefers-short-answers', 'answer style', 'Keep responses short and skimmable; the user reads quickly and wants the answer first, no fluff at all.');
memory(api, 'payments.md', 'payments-retry-rules', 'payments', 'Retries use exponential backoff capped at 5 attempts; idempotency keys come from the order id.', { indexed: false });
memory(web, 'hackathon.md', 'hackathon-notes', 'event', 'User is at the Storefront hackathon Oct 15–18 2026; keep answers short and skip refactors.', { modified: '2026-10-10T10:00:00Z' });
memory(web, 'deploy.md', 'deploy-checklist', 'deploys', 'Run `/release-notes-gen` before every deploy so the changelog stays current.');
memory(gone, 'auth.md', 'admin-auth-flow', 'auth', 'Admin login uses the legacy session cookie.');
memory(gone, 'roles.md', 'admin-roles', 'roles', 'Roles are owner, manager and viewer.');
write(join(web, 'CLAUDE.md'), `# Storefront\n\nUse pnpm.\n\n## History\n\n${Array.from({ length: 420 }, (_, i) => `- 2026-0${(i % 9) + 1}-1${i % 9} shipped change ${i} to checkout`).join('\n')}\n`);
skill(join(ctx.claudeDir, 'skills'), 'use-railway', 'Deploy and manage services on Railway.');
skill(join(ctx.claudeDir, 'skills'), 'pr-writer', 'Write pull request descriptions.');
for (const s of ['aws-cdk', 'aws-lambda', 'docker', 'postgres', 'react-ui']) skill(join(ctx.claudeDir, 'skills'), s, `Help with ${s}.`);
const plugin = join(ctx.claudeDir, 'plugins', 'cache', 'mp', 'railway', '1.0.0');
skill(join(plugin, 'skills'), 'use-railway', 'Deploy and manage services on Railway.');
write(join(ctx.claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'railway@mp': [{ installPath: plugin }] } }));

/* ---------------------------------------------------------------- ANSI → SVG */

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean };
const BASIC = ['#1a1b26', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'];

function cells(frame: string): { ch: string; s: Style }[][] {
  return frame.split('\n').map((line) => {
    const out: { ch: string; s: Style }[] = [];
    let s: Style = {};
    for (let i = 0; i < line.length; ) {
      if (line[i] === '\u001b' && line[i + 1] === '[') {
        const end = line.indexOf('m', i);
        const codes = line.slice(i + 2, end).split(';').map(Number);
        for (let k = 0; k < codes.length; k++) {
          const c = codes[k]!;
          if (c === 0) s = {};
          else if (c === 1) s = { ...s, bold: true };
          else if (c === 2) s = { ...s, dim: true };
          else if (c === 22) s = { ...s, bold: false, dim: false };
          else if (c === 39) s = { ...s, fg: undefined };
          else if (c === 49) s = { ...s, bg: undefined };
          else if (c === 7) s = { ...s, fg: s.bg ?? '#1a1b26', bg: s.fg ?? '#c0caf5' };
          else if ((c === 38 || c === 48) && codes[k + 1] === 2) {
            const hex = '#' + codes.slice(k + 2, k + 5).map((n) => n.toString(16).padStart(2, '0')).join('');
            s = c === 38 ? { ...s, fg: hex } : { ...s, bg: hex };
            k += 4;
          } else if (c >= 30 && c <= 37) s = { ...s, fg: BASIC[c - 30] };
          else if (c >= 90 && c <= 97) s = { ...s, fg: BASIC[c - 90] };
          else if (c >= 40 && c <= 47) s = { ...s, bg: BASIC[c - 40] };
        }
        i = end + 1;
        continue;
      }
      const cp = line.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      out.push({ ch, s });
      i += ch.length;
    }
    return out;
  });
}

function svg(frame: string, title: string): string {
  const grid = cells(frame);
  const cw = 8.43;
  const lh = 19;
  const pad = 18;
  const top = 38;
  const cols = Math.max(...grid.map((r) => r.length));
  const w = Math.ceil(cols * cw + pad * 2);
  const h = Math.ceil(grid.length * lh + top + pad);
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const st = row[x]!.s;
      let e = x;
      while (e < row.length && JSON.stringify(row[e]!.s) === JSON.stringify(st)) e++;
      const text = row.slice(x, e).map((c) => c.ch).join('');
      const px = pad + x * cw;
      const py = top + y * lh;
      if (st.bg) parts.push(`<rect x="${px.toFixed(1)}" y="${py}" width="${((e - x) * cw).toFixed(1)}" height="${lh}" fill="${st.bg}"/>`);
      // One <text> per word at its exact column, so renderers can't collapse or stretch spacing.
      for (const m of text.matchAll(/\S+/g)) {
        const wx = pad + (x + m.index!) * cw;
        parts.push(
          `<text x="${wx.toFixed(1)}" y="${py + 14}" fill="${st.fg ?? '#c0caf5'}"${st.bold ? ' font-weight="700"' : ''}${st.dim ? ' opacity="0.6"' : ''}>${esc(m[0])}</text>`,
        );
      }
      x = e;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" rx="10" fill="#1a1b26"/>
<circle cx="20" cy="18" r="6" fill="#f7768e"/><circle cx="40" cy="18" r="6" fill="#e0af68"/><circle cx="60" cy="18" r="6" fill="#9ece6a"/>
<text x="${w / 2}" y="22" fill="#565f89" font-size="12" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(title)}</text>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" xml:space="preserve">
${parts.join('\n')}
</g>
</svg>
`;
}

/* ---------------------------------------------------------------- shots */

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const out = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const result = await scan(ctx);
async function shot(name: string, title: string, keys: string[]) {
  const ui = render(<App ctx={ctx} firstRun={false} selfCommand="mindstash" initialResult={result} onEdit={() => {}} />);
  await tick();
  for (const k of keys) {
    ui.stdin.write(k);
    await tick();
  }
  writeFileSync(join(out, `${name}.svg`), svg(ui.lastFrame() ?? '', title));
  ui.unmount();
  console.log('wrote', name);
}

await shot('main', 'npx mindstash', []);
await shot('detail', 'npx mindstash · detail', ['j', 'l']);
await shot('palette', 'npx mindstash · Ctrl-P', ['\u0010', 'r', 'a', 'i', 'l']);
process.exit(0);
