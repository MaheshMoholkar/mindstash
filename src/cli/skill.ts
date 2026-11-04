import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanContext } from '../core/types.js';

/** Where each agent reads user skills from. */
export function skillTargets(ctx: ScanContext): { agent: string; name: string; path: string; invoke: string }[] {
  const out = [];
  if (existsSync(ctx.claudeDir)) {
    out.push({ agent: 'claude-code', name: 'Claude Code', path: join(ctx.claudeDir, 'skills', 'mindstash', 'SKILL.md'), invoke: '/mindstash' });
  }
  if (existsSync(ctx.codexDir)) {
    out.push({ agent: 'codex', name: 'Codex', path: join(ctx.home, '.agents', 'skills', 'mindstash', 'SKILL.md'), invoke: '$mindstash' });
  }
  return out;
}

export function skillInstalled(ctx: ScanContext): boolean {
  const t = skillTargets(ctx);
  return t.length > 0 && t.every((x) => existsSync(x.path));
}

/** Write the skill for every detected agent. Returns what was written. */
export function installSkills(ctx: ScanContext, cmd: string) {
  const written = [];
  for (const t of skillTargets(ctx)) {
    const existed = existsSync(t.path);
    mkdirSync(join(t.path, '..'), { recursive: true });
    writeFileSync(t.path, skillMarkdown(cmd));
    written.push({ ...t, existed });
  }
  return written;
}

/** The MindStash skill: lets the user's own agent run MindStash and talk through findings in chat. */
export function skillMarkdown(cmd: string): string {
  return `---
name: mindstash
description: Review and clean up saved agent memories and skills (Claude Code, Codex) with MindStash - stale, wrong scope, duplicates, re-learned, oversized index or AGENTS.md. Use when the user invokes mindstash or asks to audit, clean up or check their agent's memories or skills.
---

# MindStash

MindStash scans this machine's agent memories and skills (Claude Code and Codex) and flags what looks wrong.
Run it with: \`${cmd}\`

## Steps

1. Run \`${cmd} scan --json\`. Read \`summary\` and \`findings\` (each has \`id\`, \`title\`, \`reasons\`, \`confidence\`, \`fixes\`, \`items\`).
2. Tell the user in a short numbered list what looks off: name, scope and the reason, one line each. Mention the token total.
3. For a finding you want to check, run \`${cmd} show <id> --json\` to read the memory text.
   - For **stale** or **similar** findings, check the claim against the actual repo (files, package.json, git log) and say whether you agree.
   - For **similar** pairs, also judge whether they contradict each other.
4. Suggest fixes using only each finding's allowed \`fixes\`. Then **stop and wait** for the user's OK.
5. Only after the user agrees, run \`${cmd} apply --yes --delete <ids> --archive <ids> --move <ids> --ignore <ids>\` with the ids they approved.
6. Report what changed and the tokens saved. If the user says "undo", run \`${cmd} undo --yes\`.

## Checking for contradictions

MindStash can't tell if two notes disagree; it finds candidate pairs and you judge them.
Do this when the scan reports pairs that "may disagree", or when the user asks.

1. Run \`${cmd} check --json\`. Each pair has \`id\`, \`cue\` (why it was picked) and two sides with \`name\`, \`path\` and \`snippet\`.
2. For each pair, read both snippets (open the files if the snippet isn't enough) and decide:
   - they give opposite instructions or facts about the same thing → \`${cmd} judge <id> --conflict "<one line: how they disagree>"\`
   - they say the same thing → \`${cmd} judge <id> --duplicate "<one line>"\`
   - otherwise (different topics, or consistent) → \`${cmd} judge <id> --ok\`
   Recording a verdict only updates MindStash's own notes; no memory files change, so no confirmation is needed for this step.
3. Tell the user which pairs disagree or repeat, quoting both sides briefly, and suggest which to keep. Do not edit the files unless the user asks.

## Rules

- Never apply a fix the user didn't approve in this conversation.
- Never merge or rewrite what a memory says. For duplicates, offer to open both files so the user can edit them.
- Only use finding ids from the latest scan; \`apply\` refuses anything else.
- Codex memories are read-only for MindStash (Codex regenerates them). For those, explain the finding and suggest the user changes it from Codex (\`/memories\`) or edits the file.
- You may suggest a scan when you notice something off mid-task, but never scan or fix on your own.
`;
}
