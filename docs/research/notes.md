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

Rechecked Nov 4, 2026 (kept MindStash):
- Supermind: taken on npm (unused 2022 placeholder, so `npx supermind` would run it) and PyPI; `supermind-claude` on npm is a Claude Code skill engine.
- Free on npm and PyPI with no notable GitHub project: superstash, supersift, superscope, superrecall, superprune, superlobe.
- Memory names free on npm and PyPI: memtidy, memorytidy, memoryaudit, memorydoctor, memjanitor, memoryhygiene. Taken or crowded: memscope, memaudit, memsift (MemSifter, 70★), memwise.
- New same-space projects found while checking (all 0★): [memlint](https://github.com/jacelovehaha/memlint) "hygiene linter for AI-agent memory files", [memorylint](https://github.com/Balaji91221/memorylint) "evidence-backed validation of repository memories", [memdoctor](https://github.com/npoitevin-max/memdoctor) "check and repair AI agent long-term memory stores". Worth a closer look before launch.
- Avoid: supermem (next to supermemory, 31k★; PyPI taken), supercontext (an AI-agent context engine), superknow (close to IBM SuperKnowa), superctx (npm taken).
