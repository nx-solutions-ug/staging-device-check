import { defineConfig } from 'tsup';

const common = {
  format: ['esm' as const],
  target: 'node26',
  platform: 'node' as const,
  dts: false,
  sourcemap: false,
  splitting: false,
};

export default defineConfig([
  {
    ...common,
    entry: { cli: 'src/cli.ts' },
    outDir: 'plugins/staging-device-check/dist',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // The harness folder holds hand-written sources too: never clean it.
    ...common,
    entry: { lib: 'src/harness-lib.ts' },
    outDir: 'plugins/staging-device-check/workspace/harness',
    clean: false,
  },
]);
