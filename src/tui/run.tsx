import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { render } from 'ink';
import { statePath } from '../core/state.js';
import type { ScanContext } from '../core/types.js';
import { App } from './App.js';
import type { Ui } from './types.js';

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/**
 * Run the full-screen UI. It owns the terminal's alternate screen (like vim), so the shell
 * comes back untouched on exit. Editing a file leaves the UI, gives the terminal to $EDITOR,
 * then returns to the same place with a fresh scan.
 */
export async function runTui(ctx: ScanContext, selfCommand: string): Promise<void> {
  let firstRun = !existsSync(statePath(ctx.mindstashDir));
  let ui: Ui | undefined;
  for (;;) {
    let edit: { paths: string[]; ui: Ui } | undefined;
    const app = render(
      <App
        ctx={{ ...ctx, now: new Date() }}
        firstRun={firstRun}
        selfCommand={selfCommand}
        initialUi={ui}
        onEdit={(paths, u) => {
          edit = { paths, ui: u };
        }}
      />,
      { alternateScreen: true },
    );
    await app.waitUntilExit();
    if (!edit) return;
    // $EDITOR may carry flags ("code -w"), so run it through the shell.
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    spawnSync(`${editor} ${edit.paths.map(quote).join(' ')}`, { stdio: 'inherit', shell: true });
    ui = edit.ui;
    firstRun = false;
  }
}
