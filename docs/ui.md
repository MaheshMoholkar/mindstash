# UI and interaction design

Oct 22, 2026 · design only, nothing built

## Ways in

Three front ends on one core:

```
                 ┌─ Terminal UI     npx mindstash          (person at the keyboard)
 MindStash core ─┼─ CLI + JSON      mindstash scan --json  (scripts, CI, agents)
                 └─ Agent skill     /mindstash in Claude Code / Codex
                                    → agent calls the CLI and talks to the user in chat
```

The CLI with JSON output is the real interface. The terminal UI and the agent skill both use it.

| How | When | What happens |
|---|---|---|
| `npx mindstash` | Look around and clean up | Full interactive terminal UI |
| `mindstash scan` | Quick check, scripts, CI | Plain report (`--json` for machines) |
| `/mindstash` in Claude Code / Codex | Without leaving the agent session | Agent runs the CLI and walks through findings in chat |
| Status line (optional, opt-in) | Passive | `🧠 2 new · 1 stale` in Claude Code's status line |

## Design rules

1. Nothing changes without confirmation; every change is backed up and can be undone.
2. Every finding says why it was flagged.
3. False alarms are dismissed with one key ("not a problem") and stay dismissed.
4. Show token cost wherever it helps ("saved ~620 tokens per session").
5. Works at 80 columns; falls back to a plain report when not in an interactive terminal.
6. Suggest-only for merges: MindStash never rewrites what a memory says.

## Terminal UI

### First run

```
 MindStash

 Looking for agents...
   ✓ Claude Code    12 projects · 34 memories · 9 skills
   ✓ Codex CLI       2 projects ·  5 memories · 3 skills
   ✗ Cursor          not found
   ✗ Gemini CLI      not found

 Nothing will be changed without asking you.
 Fixes are backed up and can be undone.

 [Enter] Scan now   [q] Quit
```

After the scan, offer the agent skill: "Add /mindstash to Claude Code and Codex so you can use it from inside your agent? [y/n]"

### Home (overview first)

```
 MindStash                                           Claude Code · Codex
 ─────────────────────────────────────────────────────────────────────────
 39 memories · 12 skills · ~7,400 tokens loaded per session

 Needs attention                                        tokens
   ● 4  Stale            past dates, missing files       1,820
   ● 2  Wrong scope      project notes loading globally    640
   ● 3  Look similar     possible duplicates               410
   ● 1  Contradiction    two memories disagree              90
   ● 1  Too long         MEMORY.md over load limit           -

   ✓ 28 memories look fine

 [Enter] Review findings   [b] Browse all   [c] Cost   [?] Help   [q] Quit
```

### Findings list

```
 Findings › Stale (4)                                    [Tab] next type
 ─────────────────────────────────────────────────────────────────────────
 ▸ [ ] hackathon-notes          global   "Oct 15–18 2026 hackathon"     past date
   [ ] old-api-endpoints        repo:x   mentions src/api/v1/ (deleted) missing file
   [x] node-16-setup            global   "uses Node 16"                 6 months old
   [x] staging-db-creds-note    repo:y   project archived               archived

 2 selected
 [Enter] Details  [Space] Select  [d] Delete  [a] Archive  [m] Move
 [i] Not a problem  [/] Search  [Esc] Back
```

### Finding detail

```
 hackathon-notes                                        global · Claude Code
 ─────────────────────────────────────────────────────────────────────────
 Why flagged
   Mentions "Oct 15–18 2026", which ended 4 days ago.
   Loaded in every session started from ~ (costs ~410 tokens).

 Content
   (memory rendered as markdown)

 File  ~/.claude/projects/<slug>/memory/hackathon-notes.md

 [d] Delete  [a] Archive  [m] Move to project  [e] Edit in $EDITOR
 [i] Not a problem  [Esc] Back
```

`e` opens the file in the user's editor; this is how "suggest only, you edit" works.

### Similar memories (suggest only)

```
 Look similar · 82% match
 ─────────────────────────────────────────────────────────────────────────
 prefers-short-answers.md       │ concise-responses.md
 global                         │ global
                                │
 User wants short answers,      │ Keep responses brief; user is
 no fluff...                    │ busy and skims...
 ─────────────────────────────────────────────────────────────────────────
 These may say the same thing. MindStash won't merge them for you.

 [e] Edit both in $EDITOR  [d] Delete one...  [i] Not duplicates  [Esc] Back
```

### Confirm a fix

```
 Apply 2 changes?
   ✕ delete   node-16-setup            global
   ↓ archive  staging-db-creds-note    repo:y

 A backup is saved first. Undo any time with [u] or `mindstash undo`.

 [y] Apply   [n] Cancel
```

Then: `✓ 2 changes applied · saved ~620 tokens per session · [u] Undo`

**Archive** = hidden from the agent but kept in MindStash; **delete** = removed (still undoable via backup).

### Browse

```
 Browse                                                  [/] search
 ─────────────────────────────────────────────────────────────────────────
 ▾ Global (Claude Code)                      6 memories  2 skills  1,900 tk
     user-role                    ✓
     hackathon-notes              ● stale
 ▸ ~/portfolio/mindstash                     2 memories  0 skills    300 tk
 ▸ ~/work/api-server                         9 memories  4 skills  2,100 tk
 ▾ Codex · global                            3 memories  1 skill     700 tk
```

### Keys (same everywhere)

`↑↓` / `jk` move · `Enter` open · `Space` select · `Tab` next group · `/` search · `e` edit · `u` undo · `?` help · `Esc` back · `q` quit

## Agent skill (`/mindstash`)

Users shouldn't have to leave their agent session. A skill, not an MCP server, because MCP tools load into every session and cost tokens, while a skill only loads its short description until used. MCP can come later for agents without skill support.

```
You:    /mindstash

Claude: Scanned 39 memories and 12 skills (~7,400 tokens per session).
        5 things look off:

        1. hackathon-notes (global): mentions Oct 15–18, ended 4 days ago
        2. old-api-endpoints (repo:x): refers to src/api/v1/, which is deleted
        3. node-16-setup (global): says Node 16; this repo uses Node 22
        4. prefers-short-answers ↔ concise-responses: look like duplicates
        5. MEMORY.md is 240 lines; only the first ~200 load

        Want me to delete 1 and 2? For 4, I can open both files so you
        can merge them yourself.

You:    delete 1 and 2, ignore 3

Claude: Done. Deleted 2 memories, marked 1 as not a problem.
        Saves ~620 tokens per session. Say "undo" to revert.
```

- The agent judges contradictions and staleness against the actual repo (no API key needed).
- The agent may **suggest** a scan when it notices something off mid-task. It never scans or fixes on its own.

### Safety in the agent path

1. `apply` only accepts finding IDs from the latest scan; it can't touch arbitrary files.
2. The skill instructs the agent to list changes and wait for the user's OK before applying.
3. Every change is backed up; `mindstash undo` works from chat or terminal.
4. Suggest-only for merges still applies.

## CLI commands

| Command | Used by |
|---|---|
| `mindstash scan [--json]` | Everyone |
| `mindstash show <id> [--json]` | Agent, scripts |
| `mindstash apply --delete/--archive/--move/--ignore <ids>` | Agent, terminal UI |
| `mindstash undo` | Everyone |
| `mindstash cost [--json]` | Everyone |
| `mindstash install-skill` | Setup (also offered on first run) |

## Decisions

- Home screen: overview first.
- Status line: optional, opt-in.
- Both archive and delete.
- Skill install offered on first run.
- Agent may suggest a scan, never act on its own.
