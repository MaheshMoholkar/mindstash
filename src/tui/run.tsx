import { fork, spawnSync } from 'node:child_process';
import { render } from 'ink';
import type { ScanSnapshot } from '../core/cache.js';
import { loadState } from '../core/state.js';
import type { ScanContext } from '../core/types.js';
import { App } from './App.js';
import { setTheme } from './theme.js';
import type { Ui } from './types.js';

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

function refreshInChild(ctx: ScanContext, signal: AbortSignal): Promise<ScanSnapshot> {
  return new Promise((resolve, reject) => {
    const child = fork(process.argv[1]!, ['_tui-refresh', JSON.stringify(ctx)], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      signal,
    });
    child.once('message', (message: { snapshot?: ScanSnapshot; error?: string }) => {
      if (message.snapshot) resolve(message.snapshot);
      else reject(new Error(message.error ?? 'Scan failed.'));
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Scan process exited before reporting a result (${code ?? 'terminated'}).`)));
  });
}

/**
 * Run the full-screen UI. It owns the terminal's alternate screen (like vim), so the shell
 * comes back untouched on exit. Editing a file leaves the UI, gives the terminal to $EDITOR,
 * then returns to the same place with a fresh scan.
 */
export async function runTui(ctx: ScanContext, selfCommand: string, preset?: string): Promise<void> {
  setTheme(preset);
  let firstRun = true;
  try { firstRun = !loadState(ctx.mindstashDir).tourSeen; } catch { /* the scan reports invalid state */ }
  let ui: Ui | undefined;
  for (;;) {
    let edit: { paths: string[]; ui: Ui } | undefined;
    const refresh = new AbortController();
    const terminal = process.stdout;
    // Save the shell's title and give both the window and tab a short app title.
    if (terminal.isTTY) terminal.write('\x1b[22;0t\x1b]0;MindStash\x07');
    try {
      const app = render(
        <App
          ctx={{ ...ctx, now: new Date() }}
          firstRun={firstRun}
          selfCommand={selfCommand}
          initialUi={ui}
          refresh={() => refreshInChild(ctx, refresh.signal)}
          onEdit={(paths, u) => {
            edit = { paths, ui: u };
          }}
        />,
        { alternateScreen: true },
      );
      await app.waitUntilExit();
    } finally {
      refresh.abort();
      if (terminal.isTTY) terminal.write('\x1b[23;0t');
    }
    if (!edit) return;
    // $EDITOR may carry flags ("code -w"), so run it through the shell.
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    spawnSync(`${editor} ${edit.paths.map(quote).join(' ')}`, { stdio: 'inherit', shell: true });
    ui = edit.ui;
    firstRun = false;
  }
}
