import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The committed bundle is what the plugin runs; it must start under real Node, not only under bun.
const CLI = join(import.meta.dir, '..', 'plugins', 'staging-device-check', 'dist', 'cli.js');

describe('bundled cli', () => {
  test('starts under node and prints the usage for an unknown command', () => {
    const home = mkdtempSync(join(tmpdir(), 'sdc-dist-'));
    try {
      const r = spawnSync('node', [CLI, 'nope'], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: home,
          XDG_CONFIG_HOME: join(home, 'c'),
          XDG_DATA_HOME: join(home, 'd'),
        },
      });
      expect(r.stderr).not.toContain('Dynamic require');
      expect(r.stderr).toContain('Befehle:');
      expect(r.status).toBe(64);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
