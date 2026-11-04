# Research notes

Oct 22, 2026. Checks done directly (GitHub API, npm, PyPI), alongside the broader Gemini research in [findings.md](findings.md).

## Competitors checked directly

| Project | Stars | Activity | Notes |
|---|---|---|---|
| [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) | 29.7k | pushed Oct 21, 2026 | "Your coding agent remembers everything." Automatic capture (12 hooks, 54 MCP tools), viewer, 20+ agents. Runs its own engine on 4 local ports. Focus is more memory, not control. |
| [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) | 31.3k | pushed Oct 21, 2026 | Memory API for developers building AI apps. Not a coding-agent memory manager. |
| [mcpware/cross-code-organizer](https://github.com/mcpware/cross-code-organizer) | 383 | pushed Oct 20, 2026 | Closest to the cleanup idea: dashboard for Claude Code, Codex, OpenCode, DSH; edit/move/delete with undo; hygiene score; exact-duplicate repair; skill copying; token budget. Only ~108 npm downloads in the month to Oct 18 (8 that week). Missing: meaning-based staleness, near-duplicates, contradictions, re-learning guard, Cursor/Windsurf/Gemini. |
| [Autopsias/brainiac](https://github.com/Autopsias/brainiac) | 0 | pushed Oct 17, 2026 | Local "second brain" notes vault searched by Claude Code/Codex/Gemini. Reason the name Brainiac was dropped. |
| [TryingtobeingNikhil/CodeLens](https://github.com/TryingtobeingNikhil/CodeLens) | 10 | pushed Oct 21, 2026 | Not a competitor. Offline hybrid code search (studied earlier); good reference for incremental indexing and hybrid ranking. |

## Naming

Picked **MindStash**: 19 GitHub repos with the name (max 1★), npm and PyPI free.

Rejected:
- Brainiac: same-name project in the same space (`brainiac-cli` on PyPI, Claude Code plugin); `brainiac` taken on npm/PyPI; DC trademark.
- MindBank, MindVault, MindKeep, MindKit: already AI-memory or AI-config tools.
- MindMeld, MindCraft, MindLayer: taken by well-known projects or packages.
- AgentMemory: 29.7k★ project.
- Backup: SharedMind (npm and PyPI free).
