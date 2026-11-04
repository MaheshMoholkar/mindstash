import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadCache } from '../src/core/cache.js';
import { scan } from '../src/core/scan.js';
import { Fixture } from './fixture.js';

let fx: Fixture;
beforeEach(() => { fx = new Fixture(); });
afterEach(() => fx.cleanup());

it('stores private, root-specific scan snapshots and restores dates', async () => {
  const path = fx.memory(fx.project('repo'), 'note.md', 'Memory body.');
  const ctx = fx.ctx();
  const result = await scan(ctx);
  const cached = loadCache(ctx)?.result;
  expect(cached?.at).toEqual(result.at);
  expect(cached?.items.find((item) => item.path === path)?.modified).toBeInstanceOf(Date);
  expect(statSync(join(ctx.mindstashDir, 'cache.json')).mode & 0o077).toBe(0);
  expect(loadCache({ ...ctx, claudeDir: join(fx.home, 'other') })).toBeUndefined();
});

it('falls back to a scan when the cache payload is incomplete', () => {
  const ctx = fx.ctx();
  fx.write(join(ctx.mindstashDir, 'cache.json'), JSON.stringify({
    version: 2, roots: [ctx.home, ctx.claudeDir, ctx.codexDir], result: { items: [] }, pairs: [],
  }));
  expect(loadCache(ctx)).toBeUndefined();
});
