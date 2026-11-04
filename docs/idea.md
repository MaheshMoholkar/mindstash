# MindStash: idea

Oct 22, 2026 · idea stage, no implementation decisions yet

## The problem

Agents save memories automatically and the user can't easily see or control them:

- **Visibility:** memories and skills are spread across hidden folders per agent and per project.
- **Wrong scope:** memories saved in one context load in unrelated sessions (e.g. a note saved while working from `~` loads in every session started from `~`).
- **Staleness:** memories about finished events or projects, or about files that no longer exist, keep loading.
- **Clutter:** duplicates, contradictions and overlapping skills build up; oversized index files get partly ignored (Claude Code loads only the first ~200 lines of `MEMORY.md`).

The core problem is **trust and control**, not storage. Memories are already plain files.

## The concept

1. **Scan:** find all memories and skills across agents and projects.
2. **Flag:** report what looks wrong, with the reason for each finding:
   - stale: past dates, dead file paths, finished or archived projects
   - wrong scope: project-specific memory sitting somewhere global
   - near-duplicates and contradictions
   - re-learned: a memory the user deleted that the agent saved again
   - oversized files the agent only partly reads
   - overlapping skills that would trigger on the same request
3. **Fix:** simple fixes only (delete, move to the right scope, archive), with backup and undo.
4. **Cost:** show how many tokens memories and skills load each session, and how much of that is spent on flagged items.

## Decisions so far

- **Coexist, don't take over (option 1).** Each agent keeps writing its own memory the way it does today. The agent's files stay the source of truth; MindStash watches and organizes them. No separate store to sync, no fighting the platform.
- **No automatic merge or compress.** MindStash shows likely duplicates side by side and suggests a merge; the user edits the files. MindStash never rewrites what a memory says.
- **Re-learning guard.** Remember what the user deleted and flag it if the agent saves something similar again.
- **Memories and skills together.** Both are knowledge given to an agent, both need scopes, both go stale.
- **Cross-agent over team.** Personal, multi-agent use first; team sharing is a separate, bigger product.
- **No plan usage tracking.** That's a different product and already covered by menu bar apps, ccusage and `/usage`. Only memory/skill token cost is in scope.
- **Name:** MindStash (GitHub, npm and PyPI names were free on Oct 22, 2026).

## Open questions

- Positioning and pitch (decide later).

Resolved:
- Agent support: Claude Code first, Codex second; Gemini CLI and Cursor later. Core stays agent-agnostic so each new agent is one adapter.
- Simple fixes are applied with confirmation, backup and undo (see [ui.md](ui.md)).
- What counts as stale: see [staleness.md](staleness.md).
- Explanation: every finding shows its reason and confidence.

## Lessons from existing tools

- Cross-Code Organizer (383★, but ~108 npm downloads/month): broad config dashboard, browse-only. People starred it but didn't keep using it. Takeaways: lead with one pain people already feel, keep the first version small, give users a reason to come back (e.g. a short summary after each session).
- See [research/findings.md](research/findings.md) for the full landscape and gaps.
