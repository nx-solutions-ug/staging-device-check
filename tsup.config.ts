import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
  },
  outDir: 'plugins/staging-device-check/dist',
  format: ['esm'],
  target: 'node26',
  platform: 'node',
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
