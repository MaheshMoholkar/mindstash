# MindStash

**See, scope and clean up what your AI agents know.**

Coding agents (Claude Code, Codex, Cursor, Gemini CLI, ...) save memories and load skills on their own. Over time these pile up: some go stale, some land in the wrong scope, some repeat or contradict each other, and the user has no single place to see or fix them. MindStash scans that setup, explains what looks wrong, and helps clean it up, while leaving each agent's own memory system untouched.

> Status: v0.1. Claude Code only, plain CLI (the interactive terminal UI comes next). Not on npm yet.

## Try it

```sh
npm install && npm run build
node dist/cli.js            # scan and report (same as `scan`)
node dist/cli.js show <id>  # why something was flagged, with the file
node dist/cli.js cost       # tokens loaded per session, per project
```

Nothing changes without confirmation. Fixes are backed up to a git repo in `~/.mindstash/backups`:

```sh
node dist/cli.js apply --delete <id> --archive <id> --move <id> --ignore <id>
node dist/cli.js undo
node dist/cli.js install-skill   # adds /mindstash to Claude Code
```

Every command takes `--json` for scripts and agents. `apply` only accepts finding ids from the latest scan, and refuses files that changed since that scan.

### What it flags

| Rule | Confidence | Meaning |
|---|---|---|
| missing-project | high | memories for a project folder that's gone |
| missing-path | high | mentions a file or folder that no longer exists (partial paths matched against the repo's git files; gitignored paths skipped) |
| past-event | medium | a date that was upcoming when the memory was saved and has passed |
| wrong-scope | medium | a note about one project saved in a parent folder like `~` (can be moved) |
| similar / skill-duplicate / skill-overlap | medium–high | near-duplicate memories, skills installed twice; suggest only, never merged |
| relearned | medium | similar to a memory you deleted with MindStash |
| too-long / broken-link / unindexed | high–medium | `MEMORY.md` over 200 lines, links to missing files, memory files it doesn't list |

### Develop

```sh
npm test          # vitest, with fake ~/.claude folders built per test
npm run typecheck
npm run dev -- scan
```

Env: `CLAUDE_CONFIG_DIR` (default `~/.claude`), `MINDSTASH_HOME` (default `~/.mindstash`).

Code: `src/core` (scan, rules, fixes, backup; agent-agnostic), `src/adapters` (one per agent), `src/cli`.

## Docs

- [docs/idea.md](docs/idea.md): concept, decisions so far, open questions
- [docs/stack.md](docs/stack.md): tech stack (TypeScript, Ink, npx)
- [docs/ui.md](docs/ui.md): screens, agent skill, CLI commands
- [docs/staleness.md](docs/staleness.md): flagging rules and confidence levels
- [docs/research/findings.md](docs/research/findings.md): existing tools and gaps (Oct 22, 2026)
- [docs/research/notes.md](docs/research/notes.md): competitor checks and naming research
