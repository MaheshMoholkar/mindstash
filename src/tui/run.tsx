import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { render } from 'ink';
import { statePath } from '../core/state.js';
import type { ScanContext } from '../core/types.js';
import { App } from './App.js';
import type { Screen } from './types.js';

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/**
 * Run the interactive UI. Editing a file leaves Ink, gives the terminal to $EDITOR,
 * then comes back to the same screen with a fresh scan.
 */
export async function runTui(ctx: ScanContext, selfCommand: string): Promise<void> {
  let firstRun = !existsSync(statePath(ctx.mindstashDir));
  let stack: Screen[] | undefined;
  for (;;) {
    let edit: { paths: string[]; stack: Screen[] } | undefined;
    const app = render(
      <App
        ctx={{ ...ctx, now: new Date() }}
        firstRun={firstRun}
        selfCommand={selfCommand}
        initialStack={stack}
        onEdit={(paths, st) => {
          edit = { paths, stack: st };
        }}
      />,
    );
    await app.waitUntilExit();
    if (!edit) return;
    // $EDITOR may carry flags ("code -w"), so run it through the shell.
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    spawnSync(`${editor} ${edit.paths.map(quote).join(' ')}`, { stdio: 'inherit', shell: true });
    stack = edit.stack;
    firstRun = false;
  }
}
