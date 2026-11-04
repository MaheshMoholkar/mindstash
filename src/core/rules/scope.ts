import { basename, join } from 'node:path';
import type { Finding, Project } from '../types.js';
import { sanitizePath, tildify } from '../text.js';
import { findingId, type Rule } from './context.js';

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrong scope: a memory saved in a parent folder (like ~) that is really about one project
 * inside it. It loads in every session started from the parent, and never in the project.
 */
export const wrongScope: Rule = ({ ctx, projects, items }) => {
  const out: Finding[] = [];
  // Moving files between scopes is a Claude Code fix; Codex keeps one generated store.
  const live = projects.filter((p) => p.exists && p.agent === 'claude-code');

  for (const parent of live) {
    const children = live.filter((c) => c.path.startsWith(parent.path + '/'));
    if (children.length === 0) continue;

    for (const m of items) {
      if (m.kind !== 'memory' || m.projectKey !== parent.key) continue;
      const text = `${m.name}\n${m.description ?? ''}\n${m.body}`;

      let best: { child: Project; score: number; why: string } | undefined;
      for (const child of children) {
        const pathRe = new RegExp(
          `(?:${escape(child.path)}|${escape(tildify(child.path, ctx.home))})(?![\\w.-])`,
          'g',
        );
        const pathHits = (text.match(pathRe) ?? []).length;
        const name = basename(child.path).toLowerCase();
        const nameHit = name.length >= 4 && new RegExp(`(^|[^a-z0-9])${escape(name)}([^a-z0-9]|$)`).test(m.name.toLowerCase());
        const score = pathHits * 2 + (nameHit ? 3 : 0);
        if (score >= 2 && (!best || score > best.score)) {
          best = {
            child,
            score,
            why: nameHit
              ? `Its name matches the project folder "${basename(child.path)}".`
              : `It mentions ${tildify(child.path, ctx.home)} ${pathHits === 1 ? 'once' : `${pathHits} times`}.`,
          };
        }
      }
      if (!best) continue;

      const target = best.child;
      const memoryDir = target.memoryDir ?? join(ctx.claudeDir, 'projects', sanitizePath(target.path), 'memory');
      const targetLabel = tildify(target.path, ctx.home);
      out.push({
        id: findingId('wrong-scope', [m.id, target.path]),
        rule: 'wrong-scope',
        category: 'scope',
        confidence: 'medium',
        title: `about ${targetLabel}, but saved under ${m.scope.label}`,
        reasons: [
          best.why,
          `It loads in sessions started from ${m.scope.label}, not in ${targetLabel}.`,
        ],
        itemIds: [m.id],
        tokens: m.loadTokens,
        fixes: ['move', 'delete', 'archive', 'ignore'],
        moveTo: { projectPath: target.path, memoryDir, indexPath: join(memoryDir, 'MEMORY.md'), label: targetLabel },
      });
    }
  }
  return out;
};
