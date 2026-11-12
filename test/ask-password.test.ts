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
  for (const tool of ['sh', 'head', 'sed', 'cat', 'dirname', 'uname', 'node'])
    spawnSync('ln', [
      '-s',
      spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim(),
      join(bin, tool),
    ]);
  const queue = join(root, 'answers');
  writeFileSync(queue, answers.map((a) => `${a}\n`).join(''));
  const answer = `a=$(head -n 1 "${queue}"); sed -i '1d' "${queue}"; [ "$a" = CANCEL ] && exit 1; printf '%s\\n' "$a"`;
  for (const d of o.dialogs ?? ['kdialog', 'zenity', 'osascript'])
    fake(join(bin, d), d === 'osascript' ? `cat >/dev/null; ${answer}` : answer);
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
