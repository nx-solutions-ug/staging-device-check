import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = 'plugins/staging-device-check/.claude-plugin/plugin.json';
const MARKET = '.claude-plugin/marketplace.json';
const PACKAGE = 'package.json';

function update(root: string, file: string, change: (j: any) => void): void {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  change(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

/** Sets the release version in the plugin manifest, the marketplace entry and package.json. */
export function syncVersion(version: string, root = process.cwd()): void {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`not a version: ${version}`);
  update(root, PLUGIN, (j) => (j.version = version));
  update(root, MARKET, (j) => {
    for (const p of j.plugins) if (p.name === 'staging-device-check') p.version = version;
  });
  update(root, PACKAGE, (j) => (j.version = version));
}

if (import.meta.main) syncVersion(process.argv[2] ?? '');
