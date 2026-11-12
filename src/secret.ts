import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, PLUGIN } from './paths.js';

/** Injectable process boundary, as slack-await's TokenDeps: tests record every call. */
export interface SecretDeps {
  run(cmd: string, args: string[], input?: string): { status: number; stdout: string };
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

const SERVICE = PLUGIN;
const ACCOUNT = 'staging-gate';

export const realSecretDeps = (): SecretDeps => ({
  env: process.env,
  platform: process.platform,
  run: (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 10_000 });
    return { status: r.error ? 127 : (r.status ?? 1), stdout: r.stdout ?? '' };
  },
});

/** Linux/dev fallback only (the tester is on macOS and uses the Keychain). */
export const secretFilePath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(dataDir(env), 'gate-password');

const stripNewline = (s: string) => s.replace(/\r?\n$/, '');

/** Quoted for `security -i`, whose line parser understands double quotes and backslash escapes. */
const quote = (v: string) => `"${v.replace(/[\\"]/g, (m) => `\\${m}`)}"`;

function keychainRead(d: SecretDeps): string | null {
  const r =
    d.platform === 'darwin'
      ? d.run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
      : d.run('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT]);
  const v = stripNewline(r.stdout);
  return r.status === 0 && v ? v : null;
}

function keychainWrite(value: string, d: SecretDeps): boolean {
  const r =
    d.platform === 'darwin'
      ? // `security -i` reads the command from stdin, so the value never appears in argv / ps.
        d.run(
          'security',
          ['-i'],
          `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${quote(value)}\n`,
        )
      : d.run(
          'secret-tool',
          ['store', '--label', SERVICE, 'service', SERVICE, 'account', ACCOUNT],
          value,
        );
  return r.status === 0;
}

function keychainDelete(d: SecretDeps): void {
  if (d.platform === 'darwin')
    d.run('security', ['-i'], `delete-generic-password -s ${SERVICE} -a ${ACCOUNT}\n`);
  else d.run('secret-tool', ['clear', 'service', SERVICE, 'account', ACCOUNT]);
}

export function readGatePassword(d: SecretDeps = realSecretDeps()): string | null {
  const fromKeychain = keychainRead(d);
  if (fromKeychain) return fromKeychain;
  const file = secretFilePath(d.env);
  if (!existsSync(file)) return null;
  return stripNewline(readFileSync(file, 'utf8')) || null;
}

/**
 * Stores the staging gate password: Keychain first (read back to be sure), otherwise a mode-600 file. A keychain
 * entry that does not read back is deleted, because reads prefer the keychain.
 */
export function writeGatePassword(
  value: string,
  d: SecretDeps = realSecretDeps(),
): 'keychain' | 'file' {
  if (!value || /[\r\n\0]/.test(value)) throw new Error('gate password must be one non-empty line');
  const file = secretFilePath(d.env);
  if (keychainWrite(value, d)) {
    if (keychainRead(d) === value) {
      rmSync(file, { force: true });
      return 'keychain';
    }
    keychainDelete(d);
  }
  const dir = join(file, '..');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(file, `${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return 'file';
}
