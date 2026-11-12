import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dir, '..', 'plugins', 'staging-device-check');

const fake = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

/**
 * The plugin's scripts in a temp plugin folder, a HOME, and a bin folder with only the tools the scripts use (so no
 * real node is found). `copy`: install a fake Node copy; `system`: a fake system node with that major version.
 */
function setup(o: { copy?: boolean; system?: number }) {
  const root = mkdtempSync(join(tmpdir(), 'sdc-launch-'));
  const plugin = join(root, 'plugin');
  cpSync(join(PLUGIN, 'scripts'), join(plugin, 'scripts'), { recursive: true });
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const tool of ['sh', 'dirname', 'cat', 'sed', 'head', 'tr', 'mkdir'])
    spawnSync('ln', [
      '-s',
      spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim(),
      join(bin, tool),
    ]);
  if (o.copy) {
    const nb = join(home, '.local', 'share', 'staging-device-check', 'node', 'bin');
    mkdirSync(nb, { recursive: true });
    fake(join(nb, 'node'), 'echo "copy node $*"; echo "PATH=$PATH"');
    fake(join(nb, 'npx'), 'echo "copy npx $*"');
    writeFileSync(join(nb, '..', '.sdc-version'), '26.13.1\n');
  }
  if (o.system !== undefined) {
    fake(join(bin, 'node'), `case "$1" in -p) echo ${o.system};; *) echo "system node $*";; esac`);
    fake(join(bin, 'npx'), 'echo "system npx $*"');
  }
  const run = (script: string, ...args: string[]) =>
    spawnSync('sh', [join(plugin, 'scripts', script), ...args], {
      encoding: 'utf8',
      env: { PATH: bin, HOME: home },
    });
  return { run, plugin, home };
}

describe('the launcher (scripts/sdc)', () => {
  test('uses the copy and hands it the CLI, with the copy first on PATH for child processes', () => {
    const s = setup({ copy: true, system: 26 });
    const r = s.run('sdc', 'doctor');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `copy node ${join(s.plugin, 'scripts', '..', 'dist', 'cli.js')} doctor`,
    );
    expect(r.stdout).toContain(
      `PATH=${join(s.home, '.local', 'share', 'staging-device-check', 'node', 'bin')}:`,
    );
  });

  test('falls back to a system Node 26 or newer only when the copy is missing', () => {
    expect(setup({ system: 26 }).run('sdc', 'doctor').stdout).toContain('system node');
    expect(setup({ system: 27 }).run('sdc', 'doctor').stdout).toContain('system node');
  });

  test('fails in German when there is neither a copy nor a Node 26', () => {
    for (const s of [setup({}), setup({ system: 24 })]) {
      const r = s.run('sdc', 'doctor');
      expect(r.status).toBe(127);
      expect(r.stderr).toContain('Node fehlt');
      expect(r.stderr).toContain('Setup');
    }
  });
});

describe('the Playwright MCP start (scripts/playwright-mcp)', () => {
  test('runs the pinned @playwright/mcp through the copy, isolated, with the gate session, at phone size', () => {
    const r = setup({ copy: true }).run('playwright-mcp');
    expect(r.stdout).toMatch(
      /^copy npx -y @playwright\/mcp@\d+\.\d+\.\d+ --isolated --storage-state \S+\/staging-device-check\/gate-state\.json --viewport-size 393x852/,
    );
  });

  test('--check says where it would start from, and fails in German without Node', () => {
    const ok = setup({ copy: true }).run('playwright-mcp', '--check');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('eigene Kopie');
    const missing = setup({}).run('playwright-mcp', '--check');
    expect(missing.status).toBe(127);
    expect(missing.stderr).toContain('Node fehlt');
  });

  test('.mcp.json starts that script, with no npx from PATH', () => {
    const mcp = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.playwright).toEqual({
      command: 'sh',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/playwright-mcp'],
    });
  });
});
