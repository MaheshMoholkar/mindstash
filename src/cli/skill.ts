/** The /mindstash skill: lets the user's own agent run MindStash and talk through findings in chat. */
export function skillMarkdown(cmd: string): string {
  return `---
name: mindstash
description: Review and clean up Claude Code's saved memories and skills (stale, wrong scope, duplicates, re-learned, oversized MEMORY.md) with MindStash. Use when the user types /mindstash or asks to audit, clean up or check their agent's memories or skills.
---

# MindStash

MindStash scans this machine's agent memories and skills and flags what looks wrong.
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

## Rules

- Never apply a fix the user didn't approve in this conversation.
- Never merge or rewrite what a memory says. For duplicates, offer to open both files so the user can edit them.
- Only use finding ids from the latest scan; \`apply\` refuses anything else.
- You may suggest a scan when you notice something off mid-task, but never scan or fix on your own.
`;
}
