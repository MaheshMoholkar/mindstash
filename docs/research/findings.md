# Memory & Skills Managers for AI Coding Agents

Oct 22, 2026 · @Mahesh Moholkar

## Summary

The closest matches to the full problem list are **Global Agent Memory** and **Beacon**. Global Agent Memory covers visibility, approval, cross-agent sharing and project/global scope. Beacon covers approval, cross-agent sharing, turning memories into skills, and team sharing.

No project found does per-tag scopes, checks memories against the actual state of the repo across agents, or manages memory and skills in one approval workflow that syncs to every agent's own folders.

The problems, numbered as used throughout:

1. **Visibility** — one place to see, edit and delete saved memories
2. **Scope** — global, per-project and per-tag (e.g. all .NET repos)
3. **Approval** — approve, edit, re-scope or reject a proposed memory
4. **Staleness** — out-of-date memories flagged or expired
5. **Cross-agent sharing** — one store used by several agents
6. **Skills** — reusable SKILL.md procedures managed and synced too
7. **Team sharing** — project memories shared with a team (optional)

## Projects

Fifteen projects across six approaches. Anything not confirmed from a primary source is marked "unverified".

### Shared memory with a human review step

**[Global Agent Memory](https://github.com/ozankasikci/global-agent-memory)**

- **Meta:** MIT, v0.1.6, latest PyPI release Jul 16 2026. Stars unverified. Alpha.
- **Solves 1, 3, 5, part of 2 and 4.** Agents submit memories as candidates; a person approves them before they become durable, and can later update, supersede, archive or hard-delete them. Markdown files are the source of truth, a local MCP daemon is the agent interface, and a dashboard handles review. Retrieval is scoped to the active project via git roots, remotes and a project registry; the CLI accepts `--scope project`.
- **Agents:** Claude Code, Codex and other MCP clients share one service.
- **Missing:** per-tag scoping (a `memory_tags` tool exists; scoping by tag unverified), automatic staleness detection, management of your own skills, team sharing.

**[Beacon](https://github.com/Asymptote-Labs/agent-beacon)**

- **Meta:** MIT, about 2.1k stars. Last release date unverified.
- **Solves 3, 5, part of 6 and 7.** Records sessions from Claude Code, Cursor, Codex, OpenCode and 20+ other harnesses, then extracts workflows, corrections and debugging patterns as candidates. You approve or supersede them. Approved memories can be installed as Agent Skills in `.agents/skills`; once committed they reach teammates and every harness that reads that folder.
- **Missing:** global and per-tag scope (memory is scoped to the current project), automatic staleness checks, a memory management UI (the local dashboard is read-only traces).

### Shared memory captured automatically

**[claude-mem](https://github.com/thedotmack/claude-mem)**

- **Meta:** Apache-2.0, about 102k stars, active (v13.8.0 shipped June 21 2026).
- **Solves 1, 5, part of 7.** Local web viewer; optional TeamBrain workspace where each person chooses what to share; `<private>` tags exclude content.
- **Agents:** Claude Code, OpenClaw, Codex, Gemini, Hermes, Copilot, OpenCode and others. Session-start context covers the current harness by default; a setting pulls in all sources.
- **Missing:** approval, staleness handling (unverified), skills, explicit global/project/tag scopes.

**[memor](https://github.com/bnimit/memor-ai)**

- **Meta:** MIT, v0.16.0, released Oct 17 2026. Stars unverified.
- **Solves 4, 5, part of 1 and 2.** Deactivates memories unused for 30+ days, merges near-duplicates, and deactivates older memories contradicted by newer ones. Patterns found in 3+ projects are promoted to global automatically. Reads transcripts agents already write, so agents need no integration to contribute.
- **Agents:** Claude Code, Cursor, Codex, Copilot, Kimi, Goose.
- **Missing:** approval, manual or tag scoping, skills, team sharing. Dashboard editing unverified.

**[ByteRover CLI](https://github.com/campfirein/byterover-cli)** (formerly Cipher)

- **Meta:** about 4.8k stars (SourcePulse); MIT per a third-party listing. Last commit unverified.
- **Solves 5, 7, part of 1, 2 and 3.** Knowledge is curated into a "context tree" versioned with Git-like branch, commit and merge commands. Personal memory is separate from team "workspace" memory. Team sync is a paid cloud add-on.
- **Missing:** a review queue (curation is a manual command), staleness (unverified), skills.

**[mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)**

- **Meta:** license and stars unverified; frequent releases (v11.10.0).
- **Solves 1, 4, 5, part of 2 and 7.** Web dashboard to browse and manage memories; scheduled consolidation decays old memories by importance and recency; an agent-ID header tags memories by writer.
- **Missing:** approval, skills, true global/project/tag scopes.

**[OpenMemory](https://github.com/mem0ai/mem0/tree/main/openmemory)** (Mem0)

- **Meta:** license, activity and stars unverified; a hosted version exists.
- **Solves 1, 5.** Store context in Cursor, retrieve it in Claude or Windsurf; a dashboard shows and creates memories.
- **Missing:** approval, scopes (unverified), staleness (unverified), skills.

**[Basic Memory](https://github.com/basicmachines-co/basic-memory)**

- **Meta:** AGPL-3.0; stars and last commit unverified.
- **Solves 1, 5, part of 4.** Plain Markdown editable by you or any MCP client; a companion memory-defrag skill merges duplicates and removes stale information.
- **Missing:** approval, scopes (unverified), real skills management.

**[threadctx-mcp](https://github.com/threadctx-dev/threadctx-mcp)**

- **Meta:** 1 star; license and activity unverified.
- Works with Claude Code and Cursor; a `list` command shows stored memories; a paid tier shares memory across a repo's team. Missing most of the list.

### Focused on staleness

**[memory-boost](https://github.com/arnaugonzalez/memory-boost)**

- **Meta:** MIT, v0.2.0, released Oct 18 2026. Stars unverified.
- **Solves 1, 4, part of 2 and 5.** Best staleness handling found: decisions carry status and review-by dates, search results are tagged current, review, historic or superseded, and a drift command reports expired decisions and quiet projects. Closest to per-tag scope: "lessons" with `applies_when` tags reach every project with matching tags.
- **Agents:** Claude Code plugin; Codex, Cursor, VS Code, Gemini CLI via MCP.
- **Missing:** approval, skills, team sharing (single user).

### Dashboard over each tool's own memory

**[Cross-Code Organizer](https://github.com/mcpware/cross-code-organizer)** (formerly Claude Code Organizer)

- **Meta:** MIT, 383 stars, v0.20.0 in September 2026.
- **Solves 1, part of 2 and 6.** View, edit, move and delete Claude memories and skills across global and project scope, find duplicates, undo every change, and copy SKILL.md bundles between Claude Code, Codex CLI, OpenCode and DSH.
- **Missing:** a shared store, approval, stale-memory detection, team features (planned). Cursor, Windsurf and Aider support planned.

### Memory and skills kept in the repo, synced through git

**[elephagent](https://github.com/zhicongsun/elephagent)**

- **Meta:** MIT, v0.3.2, released May 12 2026. Alpha.
- **Solves 5, 6, 7, part of 1.** One git-synced `.agent/` folder rendered into CLAUDE.md, AGENTS.md and Cursor rules; an MCP server for direct reads and writes; commands to import existing memories and skills and create shared skills.
- **Missing:** approval, staleness, global and per-tag scope.

**[agent-memory](https://github.com/Accenture/mercury-go)** (Accenture Mercury family)

- **Meta:** Apache-2.0; stars and release date unverified.
- **Solves 5, 6, 7, likely part of 3 and 4.** Folds a repo's existing AI setup into a shared layer via an AGENTS.md shim; regenerates skill pointers for Claude Code, Gemini CLI, Cursor, Kiro, Copilot CLI and Antigravity. Docs include "Review Memory" and "Decay & Tiers" guides; their mechanisms are unverified.
- **Missing:** global and tag scopes, a UI.

### Rules and skills sync only (no learned memory)

- **[rulesync](https://github.com/dyoshikawa/rulesync)** — generates rules, ignore files, MCP config, commands, subagents and skills for many tools from one source; project and global modes. Active (May 2026 PRs). License unverified.
- **[Ruler](https://github.com/intellectronica/ruler)** — distributes rules, MCP config and skills to Claude Code, Codex, Cursor, Windsurf, Gemini CLI and others; nested `.ruler` folders. License and activity unverified.
- **[skill-sync](https://github.com/eezzekl/skill-sync)** — mesh sync of skills across agents; picks a winner by version, then timestamp.
- **[sync-skill](https://github.com/william-garden/sync-skill)** — copies skills between agents, globally or per project.
- **Vercel `npx skills`** — installs skills globally or per project for many agents. Canonical repo link unverified (only [a fork](https://github.com/luvisir/vercel-labs-skills) found).

## Comparison

No project covers more than four of the seven problems fully. Key: ✓ solves it, ◐ partial, ✗ no, ? unverified.

| Project | 1 Visibility | 2 Scope | 3 Approval | 4 Staleness | 5 Cross-agent | 6 Skills | 7 Team |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Global Agent Memory | ✓ | ◐ | ✓ | ◐ | ✓ | ✗ | ✗ |
| Beacon | ◐ | ◐ | ✓ | ◐ | ✓ | ◐ | ◐ |
| claude-mem | ✓ | ◐ | ✗ | ? | ✓ | ✗ | ◐ |
| memor | ◐ | ◐ | ✗ | ✓ | ✓ | ✗ | ✗ |
| ByteRover CLI | ◐ | ◐ | ◐ | ? | ✓ | ✗ | ✓ |
| mcp-memory-service | ✓ | ◐ | ✗ | ✓ | ✓ | ✗ | ◐ |
| OpenMemory | ✓ | ? | ✗ | ? | ✓ | ✗ | ◐ |
| Basic Memory | ✓ | ? | ✗ | ◐ | ✓ | ✗ | ◐ |
| memory-boost | ✓ | ◐ (tags) | ✗ | ✓ | ◐ | ✗ | ✗ |
| Cross-Code Organizer | ✓ | ◐ (re-scope) | ✗ | ◐ | ✗ | ◐ | ✗ |
| elephagent | ◐ | ◐ | ✗ | ✗ | ✓ | ✓ | ✓ |
| agent-memory (Accenture) | ◐ | ◐ | ? | ? | ✓ | ✓ | ✓ |
| rulesync / Ruler | ✗ | ◐ | ✗ | ✗ | ✓ (rules) | ✓ | ✓ |
| Skill syncers | ✗ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ |

## Gaps nobody solves well

The real gaps are cross-agent: per-tag scope, staleness checked against the repo, and memory plus skills managed together.

1. **Per-tag scopes ("all .NET repos").** Nobody does this properly. memory-boost's `applies_when` lessons and memor's automatic promotion to global (after a pattern appears in 3 projects) are the nearest, but neither lets you say "apply to repos tagged X".
2. **Choosing scope at approval time, across agents.** Global Agent Memory and Beacon have review queues, but neither clearly lets you re-scope a memory while approving it. Cross-Code Organizer re-scopes after the fact, only for Claude and partly Codex. Gemini CLI's built-in inbox does scope choice during review, for one agent only.
3. **Staleness checked against reality.** Existing tools use review-by dates (memory-boost), unused-for-30-days (memor), decay scores (mcp-memory-service) or contradiction detection. None checks a shared store against deleted files, archived projects or past event dates. Claude Code's audit flags missing-file references, but only in instruction files.
4. **One tool for memory and skills.** Only the git-in-repo tools (elephagent, Accenture agent-memory) do both, per repo and without approval. Beacon turns approved memories into skills but doesn't manage skills you wrote.
5. **One view of every agent's built-in memory.** Cross-Code Organizer covers Claude and Codex. Nothing shows Claude auto memory, Codex memories, Gemini's inbox and Windsurf memories together.
6. **Team sharing with review and privacy.** Team sharing exists (claude-mem TeamBrain, ByteRover Cloud, Beacon, git-based tools). Only Beacon has a review step before anything is shared.

## What the agents already do built in

Approval with scope choice (Gemini CLI), per-repo isolation (all), a viewer and editor (Claude `/memory`, Windsurf panel) and basic staleness tooling (Claude audit, Copilot expiry) already exist inside single tools, so they are not gaps.

| Agent | Scopes | Auto memory | View / edit | Approval | Staleness | Team |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | CLAUDE.md at managed, user, project, local; rules scoped by path globs; shared rules can be symlinked into many projects | Per repo, shared across worktrees, machine-local markdown | `/memory` browse, edit, delete, toggle | None for auto memory | `modified` timestamps; `/doctor prompt-audit` flags outdated instructions and missing files | Project CLAUDE.md via git; auto memory not shared |
| Cursor | Project rules, user rules, `~/.cursor/rules`, AGENTS.md | Memories removed in 2.1.x per staff; a later staff reply says only the UI was removed. Status unclear | Rules files only | — | — | Rules via git |
| Codex | Global `~/.codex/AGENTS.md`, repo AGENTS.md, overrides | Off by default; local `~/.codex/memories/`; per-chat `/memories` controls | Treat as generated state; delete whole store per machine | None | Not documented | None for memories |
| Gemini CLI | Global and project GEMINI.md, subfolders | `save_memory` writes to global GEMINI.md; experimental Auto Memory mines past sessions | `/memory show`, `/memory inbox` | **Yes:** inbox to apply private-project or global memory patches and promote skills to user or workspace | Not documented | Project GEMINI.md via git |
| Windsurf / Devin Desktop | Global, workspace, system rules | Workspace-scoped, local, legacy Cascade agent only | Manage Memories panel | None | Migration wizard moves memories into Skills | Not committed to repo |
| GitHub Copilot | Instruction files | Copilot Memory (GitHub-hosted) | Unverified | Unverified | Auto-expires after 28 days (third-party source, unverified) | Unverified |

## Sources

- [Global Agent Memory (PyPI)](https://pypi.org/project/global-memory-mcp/)
- [Beacon repo](https://github.com/Asymptote-Labs/agent-beacon) · [distill skill](https://smithery.ai/skills/beacon/memory-distill) · [promote skill](https://smithery.ai/skills/beacon/memory-promote) · [recall skill](https://smithery.ai/skills/beacon/memory-recall)
- [claude-mem repo](https://github.com/thedotmack/claude-mem) · [v13.8.0 write-up](https://www.augmentcode.com/learn/claude-mem-v13-persistent-agent-memory)
- [memor-cli (PyPI)](https://pypi.org/project/memor-cli/)
- [ByteRover CLI (x-cmd)](https://www.x-cmd.com/install/byterover-cli/) · [Cipher docs](https://docs.byterover.dev/cipher/overview) · [ByteRover (TypingMind)](https://www.typingmind.com/mcp/cipher) · [SourcePulse](https://www.sourcepulse.org/projects/11023906)
- [mcp-memory-service v11.10.0](https://github.com/doobidoo/mcp-memory-service/releases/tag/v11.10.0) · [Glama listing](https://glama.ai/mcp/servers/@doobidoo/mcp-memory-service/tree/59e4da8674def2aa01ab009f42a97fa908d92505) · [mdskills listing](https://www.mdskills.ai/mcp-servers/mcp-memory-service)
- [OpenMemory launch post](https://mem0.ai/blog/introducing-openmemory-mcp) · [OpenMemory guide](https://mem0.ai/blog/how-to-make-your-clients-more-context-aware-with-openmemory-mcp) · [OpenMemory docs](https://docs.mem0.ai/openmemory)
- [Basic Memory technical docs](https://docs.basicmemory.com/reference/technical-information) · [basic-memory-skills](https://github.com/basicmachines-co/basic-memory-skills)
- [threadctx-mcp](https://github.com/threadctx-dev/threadctx-mcp)
- [memory-boost (PyPI)](https://pypi.org/project/memory-boost/)
- [Cross-Code Organizer](https://github.com/mcpware/cross-code-organizer)
- [elephagent (PyPI)](https://pypi.org/project/elephagent/)
- [Accenture agent-memory vendor support](https://accenture.github.io/mercury-go/reference/vendor-support/)
- [rulesync wiki](https://github.com/dyoshikawa/rulesync/wiki) · [rulesync (Context7)](https://context7.com/dyoshikawa/rulesync) · [rulesync PR #1708](https://github.com/dyoshikawa/rulesync/pull/1708)
- [Ruler wiki](https://github.com/intellectronica/ruler/wiki) · [Ruler docs search](https://docsearch.algolia.com/mcp/docs/repo/intellectronica/ruler)
- [skill-sync](https://github.com/eezzekl/skill-sync) · [sync-skill](https://github.com/william-garden/sync-skill) · [skills CLI (fork)](https://github.com/luvisir/vercel-labs-skills)
- [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- [Cursor memory status (MemoryPlugin)](https://blog.memoryplugin.com/cursor-memory/) · [Cursor forum: Are my memories gone?](https://forum.cursor.com/t/are-my-memories-gone/144057/3.md) · [Cursor forum: Memory tool disappeared](https://forum.cursor.com/t/memory-tool-dissapeared/148405)
- [Codex Memories docs](https://learn.chatgpt.com/docs/customization/memories) · [How Codex memory works](https://blog.memoryplugin.com/does-codex-remember-past-conversations/)
- [Gemini CLI save\_memory](https://geminicli.com/docs/tools/memory) · [Gemini CLI Auto Memory](https://geminicli.com/docs/cli/auto-memory.md)
- [Windsurf memories docs](https://docs.windsurf.com/windsurf/cascade/memories.md) · [Windsurf context (MemoryLake)](https://www.memorylake.ai/en/blogs/stop-windsurf-cascade-losing-context)
- [VS Code agent memory (Medium)](https://medium.com/@dele-oke/how-to-use-memory-in-visual-studio-code-vs-code-agents-in-2026-9b471a2bed6e)
