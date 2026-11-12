import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

const PLUGIN = 'plugins/staging-device-check/.claude-plugin/plugin.json';
const MARKET = '.claude-plugin/marketplace.json';

describe('manifests', () => {
  test('the marketplace lists exactly the staging-device-check plugin from its folder', () => {
    const market = readJson(MARKET);
    expect(market.name).toBe('staging-device-check');
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe('staging-device-check');
    expect(market.plugins[0].source).toBe('./plugins/staging-device-check');
  });

  test('the plugin manifest names the same plugin', () => {
    const plugin = readJson(PLUGIN);
    expect(plugin.name).toBe('staging-device-check');
    expect(plugin.license).toBe('MIT');
  });

  test('marketplace, plugin and package versions are equal', () => {
    const versions = [
      readJson(MARKET).plugins[0].version,
      readJson(PLUGIN).version,
      readJson('package.json').version,
    ];
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+/);
  });
});
