# What counts as "stale"

Decided Oct 22, 2026. Flagging quality is the core of the product: good flags build trust, bad ones lose users.

## Rules by confidence

**High (checked directly, shown by default)**
- **Missing file or folder:** the memory refers to a path that no longer exists.
- **Missing project:** the memory belongs to a repo folder that is gone or archived.
- **Missing command or skill:** the memory refers to a skill or command that isn't installed anymore.

**Medium (shown by default, always with a reason)**
- **Past date or event:** only dates tied to events ("hackathon Oct 15–18"), not dates mentioned in passing ("decided on Oct 3").
- **Version mismatch:** memory says "Node 16", the repo declares 22 (package.json, go.mod, .nvmrc, etc.).
- **Replaced by a newer memory:** a later memory says the opposite (overlaps with contradictions).

**Low (hidden behind "show more")**
- **Old and untouched:** not modified in N months.
- **Project gone quiet:** no commits in the repo for months.
- **Never relevant:** project memory for a repo the agent hasn't been opened in for a long time.

## Principles

1. **Plain code rules are the engine.** Missing files, dates, versions and project state are checked without an LLM: fast, free, explainable.
2. **The agent is an optional extra check.** Through `/mindstash`, the user's agent can judge "is this still true?" against the actual repo. No API key.
3. **Age alone never triggers a flag.** Preferences don't expire; age only adds weight to another signal.
4. **Users can pin a memory as permanent** ("never flag this"), the up-front version of "not a problem".
5. **Every flag shows its reason and confidence.**
