# Tech stack

Decided Oct 22, 2026. Goals: a great terminal UI, installed with `npx`, popular dependencies only.

## Language and runtime

TypeScript on Node 20+, distributed on npm and run with `npx mindstash`.

## Dependencies

| Need | Library | Notes |
|---|---|---|
| Terminal UI | `ink` | React for the terminal (used by Claude Code, Gemini CLI) |
| UI components | `@inkjs/ui` | Official Ink components: select, multi-select, spinner, progress, inputs |
| Colors | `chalk` | Already an Ink dependency |
| Markdown rendering | `marked` + `marked-terminal` | Show memory content nicely |
| CLI commands | `commander` | Most widely used Node CLI parser |
| Folder watching | `chokidar` | Standard (Vite, webpack) |
| Validation | `zod` | Config and agent-file parsing |
| MCP (later) | `@modelcontextprotocol/sdk` | Official SDK |
| Build | `tsup` | Single bundled file for fast `npx` startup |
| Tests | `vitest` | With fake `~/.claude` folders as fixtures |

## No library on purpose

- **Backup and undo:** a git repo in `~/.mindstash/backups`, driven through Node's `child_process`. Each fix is a commit; undo is a revert.
- **Near-duplicates:** own MinHash implementation (~60 lines).
- **Token cost:** simple estimate; exact counts aren't needed.
- **Contradictions:** MindStash finds candidate pairs; the user's own agent judges them through a MindStash skill. No API key.

## Storage

No database. Each agent's own files are the source of truth. MindStash's own state (deleted-memory list, settings) lives in `~/.mindstash/` as JSON. Add SQLite only if that gets slow.

## Code layout

```
core/       scan, flag rules, fixes, backup (agent-agnostic)
adapters/   claude-code first, then codex, gemini, cursor
cli/        commands and Ink screens
```

## Terminal UI guidelines

- Hook-triggered commands (after-session summary) must not load Ink; lazy-load it only for interactive screens.
- Bundle to one file so `npx` downloads fast and has no install step.
- Sketch the main screens (scan results, finding detail, fix confirmation) before building components.

## Considered and rejected

- **Go + Charm (Bubble Tea):** best terminal UI toolkit and fastest startup, but chose to stay with Node/npx.
- **Python:** install friction for non-Python users.
