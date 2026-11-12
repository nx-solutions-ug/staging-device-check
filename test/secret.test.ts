import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readGatePassword,
  secretFilePath,
  writeGatePassword,
  type SecretDeps,
} from '../src/secret.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'sdc-secret-'));
const PASSWORD = 'not-a-real "gate" pass\\word with spaces';

type Call = { cmd: string; args: string[]; input?: string };

/** A fake `security` (darwin) / `secret-tool` (linux) backed by a map, recording every call. */
function deps(platform: NodeJS.Platform, keychain: 'works' | 'missing' | 'mangles') {
  const store = new Map<string, string>();
  const calls: Call[] = [];
  const d: SecretDeps = {
    env: { CLAUDE_PLUGIN_DATA: join(tempDir(), 'data') },
    platform,
    run: (cmd, args, input) => {
      calls.push({ cmd, args, input });
      if (keychain === 'missing') return { status: 127, stdout: '' };
      if (cmd === 'security' && args[0] === '-i') {
        const line = input ?? '';
        if (line.startsWith('add-generic-password')) {
          const raw = /-w "((?:[^"\\]|\\.)*)"\n$/.exec(line)?.[1] ?? '';
          store.set('k', keychain === 'mangles' ? 'mangled' : raw.replace(/\\(.)/g, '$1'));
          return { status: 0, stdout: '' };
        }
        if (line.startsWith('delete-generic-password')) {
          store.delete('k');
          return { status: 0, stdout: '' };
        }
        return { status: 1, stdout: '' };
      }
      if (cmd === 'security' && args[0] === 'find-generic-password') {
        const v = store.get('k');
        return v === undefined ? { status: 44, stdout: '' } : { status: 0, stdout: `${v}\n` };
      }
      if (cmd === 'secret-tool' && args[0] === 'store') {
        store.set('k', keychain === 'mangles' ? 'mangled' : (input ?? ''));
        return { status: 0, stdout: '' };
      }
      if (cmd === 'secret-tool' && args[0] === 'lookup') {
        const v = store.get('k');
        return v === undefined ? { status: 1, stdout: '' } : { status: 0, stdout: v };
      }
      if (cmd === 'secret-tool' && args[0] === 'clear') {
        store.delete('k');
        return { status: 0, stdout: '' };
      }
      return { status: 1, stdout: '' };
    },
  };
  return { d, calls, store };
}

const noValueInArgv = (calls: Call[]) =>
  calls.every((c) => c.args.every((a) => !a.includes(PASSWORD)));

describe('gate password store', () => {
  test('writeGatePassword uses security -i on darwin and never puts the value in argv', () => {
    const { d, calls } = deps('darwin', 'works');
    expect(writeGatePassword(PASSWORD, d)).toBe('keychain');
    expect(readGatePassword(d)).toBe(PASSWORD);
    const add = calls.find((c) => c.input?.startsWith('add-generic-password'));
    expect(add?.cmd).toBe('security');
    expect(add?.args).toEqual(['-i']);
    expect(add?.input).toContain('-s staging-device-check -a staging-gate');
    expect(noValueInArgv(calls)).toBe(true);
    expect(existsSync(secretFilePath(d.env))).toBe(false);
  });

  test('on linux the value goes to secret-tool on stdin', () => {
    const { d, calls } = deps('linux', 'works');
    expect(writeGatePassword(PASSWORD, d)).toBe('keychain');
    expect(calls.find((c) => c.args[0] === 'store')?.input).toBe(PASSWORD);
    expect(noValueInArgv(calls)).toBe(true);
    expect(readGatePassword(d)).toBe(PASSWORD);
  });

  test('falls back to a mode-600 file when the keychain fails', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { d, calls } = deps(platform, 'missing');
      expect(writeGatePassword(PASSWORD, d)).toBe('file');
      const file = secretFilePath(d.env);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700);
      expect(readGatePassword(d)).toBe(PASSWORD);
      expect(noValueInArgv(calls)).toBe(true);
    }
  });

  test('a keychain entry that does not read back is removed and the file is used', () => {
    const { d, store } = deps('darwin', 'mangles');
    expect(writeGatePassword(PASSWORD, d)).toBe('file');
    expect(store.has('k')).toBe(false);
    expect(readGatePassword(d)).toBe(PASSWORD);
  });

  test('a keychain write removes an older fallback file', () => {
    const missing = deps('darwin', 'missing');
    writeGatePassword('old-value', missing.d);
    const { d } = deps('darwin', 'works');
    d.env = missing.d.env;
    expect(writeGatePassword(PASSWORD, d)).toBe('keychain');
    expect(existsSync(secretFilePath(d.env))).toBe(false);
  });

  test('no password anywhere reads as null', () => {
    expect(readGatePassword(deps('darwin', 'missing').d)).toBeNull();
  });

  test('rejects an empty value and line breaks', () => {
    const { d } = deps('darwin', 'works');
    expect(() => writeGatePassword('', d)).toThrow();
    expect(() => writeGatePassword('a\nb', d)).toThrow();
  });

  test('the fallback file sits next to the settings', () => {
    expect(secretFilePath({ CLAUDE_PLUGIN_DATA: '/d/data' })).toBe('/d/data/gate-password');
    expect(secretFilePath({ HOME: '/h' })).toBe('/h/.config/staging-device-check/gate-password');
  });
});
