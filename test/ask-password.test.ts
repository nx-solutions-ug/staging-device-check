import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dir, '..', 'plugins', 'staging-device-check');
const SECRET = 'invented-dialog-password-0001';

const fake = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\necho "$0 $*" >> "$ARGV_LOG"\n${body}\n`);
  chmodSync(path, 0o755);
};

/**
 * The plugin (scripts + built CLI) in a temp folder; fake dialogs that answer from a queue file (a line CANCEL
 * cancels), and a fake secret-tool that keeps the stored value in a file. Every fake logs its argv.
 */
function setup(
  answers: string[],
  o: { system?: string; display?: boolean; dialogs?: string[] } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'sdc-ask-'));
  const plugin = join(root, 'plugin');
  cpSync(join(PLUGIN, 'scripts'), join(plugin, 'scripts'), { recursive: true });
  cpSync(join(PLUGIN, 'dist'), join(plugin, 'dist'), { recursive: true });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const tool of [
    'sh',
    'head',
    'sed',
    'cat',
    'dirname',
    'uname',
    'node',
    'timeout',
    'grep',
    'mktemp',
    'rm',
    'sleep',
  ])
    spawnSync('ln', [
      '-s',
      spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim(),
      join(bin, tool),
    ]);
  const queue = join(root, 'answers');
  writeFileSync(queue, answers.map((a) => `${a}\n`).join(''));
  // CANCEL: the cancel button (osascript: error -128); NOGUI: osascript without a GUI session; HANG: never answers
  const answer = (cancel: string) =>
    `a=$(head -n 1 "${queue}"); sed -i '1d' "${queue}"; [ "$a" = CANCEL ] && { ${cancel} exit 1; }; [ "$a" = NOGUI ] && { echo 'execution error: No user interaction allowed. (-1713)' >&2; exit 1; }; [ "$a" = HANG ] && { sleep 30; exit 0; }; printf '%s\\n' "$a"`;
  for (const d of o.dialogs ?? ['kdialog', 'zenity', 'osascript'])
    fake(
      join(bin, d),
      d === 'osascript'
        ? `cat >/dev/null; ${answer("echo 'execution error: User canceled. (-128)' >&2;")}`
        : answer(''),
    );
  const store = join(root, 'store');
  fake(
    join(bin, 'secret-tool'),
    `case "$1" in store) cat > "${store}";; lookup) [ -f "${store}" ] && cat "${store}" || exit 1;; clear) rm -f "${store}";; esac`,
  );
  const home = join(root, 'home');
  mkdirSync(home);
  const argvLog = join(root, 'argv.log');
  writeFileSync(argvLog, '');
  const r = spawnSync('sh', [join(plugin, 'scripts', 'ask-password.sh')], {
    encoding: 'utf8',
    env: {
      PATH: bin, // only the fakes and the tools below: never a real dialog or keychain
      HOME: home,
      ARGV_LOG: argvLog,
      SDC_DIALOG_SYSTEM: o.system ?? 'Linux',
      SDC_DIALOG_TIMEOUT: '2',
      ...(o.display === false ? {} : { DISPLAY: ':99' }),
    },
  });
  const passwordFile = join(home, '.config', 'staging-device-check', 'gate-password');
  return { r, store, passwordFile, argv: () => readFileSync(argvLog, 'utf8') };
}

describe('ask-password.sh (native dialog → set-secret --stdin)', () => {
  for (const system of ['Linux', 'Darwin']) {
    test(`${system}: cancel stores nothing`, () => {
      const s = setup(['CANCEL'], { system });
      expect(s.r.status).not.toBe(0);
      expect(s.r.stderr).toContain('Abgebrochen. Nichts gespeichert.');
      // the cancel ends it at once: one dialog, no further question
      expect(s.argv().trim().split('\n')).toHaveLength(1);
      expect(existsSync(s.store)).toBe(false);
      expect(existsSync(s.passwordFile)).toBe(false);
    });

    test(`${system}: two equal entries go to the keychain on stdin, nowhere visible`, () => {
      const s = setup([SECRET, SECRET], { system });
      expect(s.r.status).toBe(0);
      expect(s.r.stdout.trim()).toBe('gespeichert (Schlüsselbund)');
      expect(readFileSync(s.store, 'utf8').trim()).toBe(SECRET);
      expect(s.r.stdout + s.r.stderr).not.toContain(SECRET);
      expect(s.argv()).not.toContain(SECRET);
      expect(existsSync(s.passwordFile)).toBe(false);
    });
  }

  test('a second entry that differs asks again; a short one too', () => {
    const s = setup(['short', SECRET, 'something-else-entirely', SECRET, SECRET]);
    expect(s.r.status).toBe(0);
    expect(readFileSync(s.store, 'utf8').trim()).toBe(SECRET);
    expect(s.argv()).toContain('kdialog');
    expect(s.argv()).toMatch(/stimmten nicht überein/);
    expect(s.argv()).toMatch(/16 Zeichen/);
  });

  test('a mismatch followed by a cancel stores nothing', () => {
    const s = setup([SECRET, 'something-else-entirely', 'CANCEL']);
    expect(s.r.status).not.toBe(0);
    expect(existsSync(s.store)).toBe(false);
  });

  test('osascript without a GUI session hands over to the terminal path (exit 3), not "Abgebrochen"', () => {
    const s = setup(['NOGUI'], { system: 'Darwin' });
    expect(s.r.status).toBe(3);
    expect(s.r.stderr).toContain('set-secret');
    expect(s.r.stderr).not.toContain('Abgebrochen');
    expect(existsSync(s.store)).toBe(false);
  });

  for (const system of ['Linux', 'Darwin']) {
    test(`${system}: a dialog nobody answers times out and counts as cancelled`, () => {
      const started = Date.now();
      const s = setup(['HANG', SECRET, SECRET], { system, dialogs: ['kdialog', 'osascript'] });
      expect(s.r.status).toBe(1);
      expect(s.r.stderr).toContain('Nichts gespeichert');
      expect(existsSync(s.store)).toBe(false);
      expect(Date.now() - started).toBeLessThan(20_000);
    }, 30_000);
  }

  test('every dialog gets the time limit', () => {
    expect(setup([SECRET, SECRET], { dialogs: ['zenity'] }).argv()).toContain('--timeout=2');
    expect(setup([SECRET, SECRET], { system: 'Darwin' }).argv()).toMatch(/osascript - .* 2$/m);
  });

  test('zenity when there is no kdialog', () => {
    const s = setup([SECRET, SECRET], { dialogs: ['zenity'] });
    expect(s.r.status).toBe(0);
    expect(s.argv()).toContain('zenity --password');
  });

  test('without a display (or a dialog program) it says to use the terminal, exit 3', () => {
    const s = setup([SECRET, SECRET], { display: false });
    expect(s.r.status).toBe(3);
    expect(s.r.stderr).toContain('set-secret');
    expect(existsSync(s.store)).toBe(false);
  });
});
