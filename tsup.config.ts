import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  minify: true,
  // One bundled file so `npx mindstash` starts fast with no install step.
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' },
});
