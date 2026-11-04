import { Box, Text, useApp } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { scan } from '../core/scan.js';
import { apply, FixError, plan, undo, type Plan, type Requests } from '../core/fix.js';
import { loadState } from '../core/state.js';
import type { ScanContext, ScanResult } from '../core/types.js';
import { installSkills, skillInstalled } from '../cli/skill.js';
import type { Nav, Screen, Toast } from './types.js';
import { fmt } from './ui.js';
import { FirstRun, Home, OfferSkill } from './screens/Home.js';
import { Findings } from './screens/Findings.js';
import { Confirm, ConfirmUndo, Detail, ItemView } from './screens/Detail.js';
import { Browse, Cost, Help } from './screens/Browse.js';

export interface AppProps {
  ctx: ScanContext;
  firstRun: boolean;
  /** Command the installed skill should use to call MindStash. */
  selfCommand: string;
  initialStack?: Screen[];
  /** Leave Ink so the user's editor can take over the terminal. */
  onEdit(paths: string[], stack: Screen[]): void;
  /** Tests pass a result to skip the real scan. */
  initialResult?: ScanResult;
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const [result, setResult] = useState<ScanResult | null>(props.initialResult ?? null);
  const [stack, setStack] = useState<Screen[]>(
    props.initialStack ?? [props.firstRun ? { kind: 'first' } : { kind: 'home' }],
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const rescan = useCallback(async () => {
    const r = await scan(props.ctx);
    setResult(r);
  }, [props.ctx]);

  useEffect(() => {
    if (props.initialResult) return;
    // Let the "Scanning…" frame paint before the (synchronous) scan blocks.
    const t = setTimeout(() => rescan().catch((e: Error) => setFatal(e.message)), 10);
    return () => clearTimeout(t);
  }, []);

  const push = useCallback((s: Screen) => {
    setToast(null);
    setStack((st) => [...st, s]);
  }, []);
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);

  const nav: Nav | null = useMemo(() => {
    if (!result) return null;
    const n: Nav = {
      ctx: props.ctx,
      result,
      push,
      pop,
      reset: (s: Screen) => {
        setToast(null);
        setStack([s]);
      },
      skillInstalled: () => skillInstalled(props.ctx),
      toast: setToast,
      quit: () => exit(),
      act(req: Requests) {
        try {
          const p = plan(props.ctx, req);
          if (p.actions.length) push({ kind: 'confirm', plan: p });
        } catch (e) {
          if (e instanceof FixError) setToast({ tone: 'error', text: e.message });
          else throw e;
        }
      },
      apply(p: Plan) {
        try {
          apply(props.ctx, p);
        } catch (e) {
          setToast({ tone: 'error', text: (e as Error).message });
          pop();
          return;
        }
        const k = p.actions.length;
        const saved = p.tokensSaved ? ` · saved ~${fmt(p.tokensSaved)} tokens per session` : '';
        void rescan().then(() => {
          pop();
          setToast({ tone: 'ok', text: `✓ ${k} change${k === 1 ? '' : 's'} applied${saved}`, undo: true });
        });
      },
      askUndo() {
        const op = [...loadState(props.ctx.mindstashDir).history].reverse().find((o) => !o.undone);
        if (!op) setToast({ tone: 'info', text: 'Nothing to undo.' });
        else push({ kind: 'undo', op });
      },
      undo() {
        try {
          undo(props.ctx);
        } catch (e) {
          setToast({ tone: 'error', text: (e as Error).message });
          pop();
          return;
        }
        void rescan().then(() => {
          pop();
          setToast({ tone: 'ok', text: '✓ Undone.' });
        });
      },
      edit(paths: string[]) {
        props.onEdit(paths, stack);
        exit();
      },
      installSkill() {
        const done = installSkills(props.ctx, props.selfCommand);
        setToast({ tone: 'ok', text: `✓ Added ${done.map((d) => `${d.invoke} to ${d.name}`).join(' and ')}.` });
      },
      common(input, key) {
        if (key.escape) pop();
        else if (input === 'q') exit();
        else if (input === '?') push({ kind: 'help' });
        else if (input === 'u') n.askUndo();
      },
    };
    return n;
  }, [result, stack, props.ctx]);

  if (fatal) {
    return (
      <Box paddingX={1}>
        <Text color="red">{fatal}</Text>
      </Box>
    );
  }
  if (!nav) {
    return (
      <Box paddingX={1}>
        <Text>Scanning memories and skills…</Text>
      </Box>
    );
  }

  const screen = stack.at(-1)!;
  return (
    <Box flexDirection="column">
      {render(screen, nav)}
      {toast ? (
        <Box paddingX={1} marginTop={1}>
          <Text color={toast.tone === 'ok' ? 'green' : toast.tone === 'error' ? 'red' : undefined}>{toast.text}</Text>
          {toast.undo ? <Text dimColor> · [u] Undo</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

function render(s: Screen, nav: Nav) {
  // `key` resets screen state (cursor, scroll) when the screen changes.
  switch (s.kind) {
    case 'first':
      return <FirstRun nav={nav} />;
    case 'offer-skill':
      return <OfferSkill nav={nav} />;
    case 'home':
      return <Home nav={nav} />;
    case 'findings':
      return <Findings key={'f' + s.category} nav={nav} category={s.category} />;
    case 'detail':
      return <Detail key={'d' + s.id} nav={nav} id={s.id} />;
    case 'item':
      return <ItemView key={'i' + s.id} nav={nav} id={s.id} />;
    case 'confirm':
      return <Confirm nav={nav} plan={s.plan} />;
    case 'undo':
      return <ConfirmUndo nav={nav} op={s.op} />;
    case 'browse':
      return <Browse nav={nav} />;
    case 'cost':
      return <Cost nav={nav} />;
    case 'help':
      return <Help nav={nav} />;
  }
}

