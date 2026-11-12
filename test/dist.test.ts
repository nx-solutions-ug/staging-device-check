import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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

  const run = (args: string[], home: string, input = '') =>
    spawnSync('node', args, {
      encoding: 'utf8',
      input,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: join(home, 'c'),
        XDG_DATA_HOME: join(home, 'd'),
      },
      timeout: 10_000,
    });

  test('runs when started through a symlink', () => {
    const home = mkdtempSync(join(tmpdir(), 'sdc-dist-'));
    try {
      symlinkSync(CLI, join(home, 'link.js'));
      const r = run([join(home, 'link.js'), 'nope'], home);
      expect(r.stderr).toContain('Befehle:');
      expect(r.status).toBe(64);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('set-secret refuses input that does not come from a terminal', () => {
    const home = mkdtempSync(join(tmpdir(), 'sdc-dist-'));
    try {
      const r = run([CLI, 'set-secret'], home, 'aaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbb\n');
      expect(r.stderr).toContain('Terminal');
      expect(r.status).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
