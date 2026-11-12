import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPTS = join(import.meta.dir, '..', 'plugins', 'staging-device-check', 'scripts');

/** A copy of install-node.sh next to a test lock, and a fake nodejs.org with one archive holding a fake node. */
function setup(hash?: string) {
  const root = mkdtempSync(join(tmpdir(), 'sdc-node-'));
  const scripts = join(root, 'scripts');
  mkdirSync(scripts);
  copyFileSync(join(SCRIPTS, 'install-node.sh'), join(scripts, 'install-node.sh'));
  const pkg = join(root, 'pkg', 'node-v1.2.3-linux-x64', 'bin');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'node'), '#!/bin/sh\necho v1.2.3\n');
  chmodSync(join(pkg, 'node'), 0o755);
  const dist = join(root, 'dist', 'v1.2.3');
  mkdirSync(dist, { recursive: true });
  const archive = join(dist, 'node-v1.2.3-linux-x64.tar.gz');
  spawnSync('tar', ['-czf', archive, '-C', join(root, 'pkg'), 'node-v1.2.3-linux-x64']);
  const real = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(
    join(scripts, 'node.lock'),
    `NODE_VERSION=1.2.3\nNODE_SHA256_linux_x64=${hash ?? real}\nNODE_SHA256_darwin_arm64=x\nNODE_SHA256_darwin_x64=x\n`,
  );
  const home = join(root, 'home');
  mkdirSync(home);
  const run = (dist = `file://${join(root, 'dist')}`) =>
    spawnSync('sh', [join(scripts, 'install-node.sh')], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: home,
        SDC_NODE_PLATFORM: 'linux-x64',
        SDC_NODE_DIST: dist,
      },
    });
  const data = join(home, '.local', 'share', 'staging-device-check');
  return { run, data, node: join(data, 'node', 'bin', 'node') };
}

describe('install-node.sh', () => {
  test('a checksum mismatch extracts nothing and says so in German', () => {
    const s = setup('0'.repeat(64));
    const r = s.run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Prüfsumme');
    expect(r.stderr).toContain('Nichts entpackt');
    expect(existsSync(join(s.data, 'node'))).toBe(false);
    // no temp folder left behind either
    expect(readdirSync(s.data)).toEqual([]);
  });

  test('a matching archive is installed, and an installed matching version is kept without a download', () => {
    const s = setup();
    const first = s.run();
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toBe(s.node);
    expect(readFileSync(join(s.data, 'node', '.sdc-version'), 'utf8').trim()).toBe('1.2.3');
    // a server that does not exist: only works if nothing is downloaded
    const again = s.run('file:///does/not/exist');
    expect(again.status).toBe(0);
    expect(again.stdout.trim()).toBe(s.node);
    expect(readdirSync(s.data)).toEqual(['node']);
  });

  test('a copy of another version, or one without the marker (interrupted), is replaced', () => {
    for (const marker of ['1.0.0\n', null]) {
      const s = setup();
      mkdirSync(join(s.data, 'node', 'bin'), { recursive: true });
      writeFileSync(join(s.data, 'node', 'bin', 'node'), '#!/bin/sh\necho old\n');
      chmodSync(join(s.data, 'node', 'bin', 'node'), 0o755);
      if (marker) writeFileSync(join(s.data, 'node', '.sdc-version'), marker);
      expect(s.run().status).toBe(0);
      expect(spawnSync(s.node, { encoding: 'utf8' }).stdout.trim()).toBe('v1.2.3');
      expect(readdirSync(s.data)).toEqual(['node']);
    }
  });

  test('the real lock pins one 26.x release with a hash for each platform', () => {
    const lock = readFileSync(join(SCRIPTS, 'node.lock'), 'utf8');
    expect(lock).toMatch(/^NODE_VERSION=26\.\d+\.\d+$/m);
    for (const p of ['darwin_arm64', 'darwin_x64', 'linux_x64'])
      expect(lock).toMatch(new RegExp(`^NODE_SHA256_${p}=[0-9a-f]{64}$`, 'm'));
  });
});
