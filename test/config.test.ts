import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, defaults, loadConfig, saveConfig, type Config } from '../src/config.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'sdc-config-'));

const sample = (over: Partial<Config> = {}): Config => ({
  apex: 'https://staging.example.test',
  hostPattern: '{label}.app.{apexHost}',
  projects: { 'Example App': 'example-app' },
  browserstackYml: '/home/tester/browserstack/browserstack.yml',
  accounts: [
    {
      label: 'Tester A',
      email: 'qa+a@example.test',
      persona: 'a',
      project: 'example-app',
      login: 'quick',
    },
    {
      label: 'Tester B',
      email: 'qa+b@example.test',
      persona: 'b',
      project: 'example-app',
      login: 'code',
    },
  ],
  jiraSite: 'example.atlassian.test',
  ...defaults,
  ...over,
});

describe('config path', () => {
  test('ignores CLAUDE_PLUGIN_DATA (one fixed place, whoever calls)', () => {
    expect(configPath({ CLAUDE_PLUGIN_DATA: '/d', HOME: '/h' })).toBe(
      '/h/.config/staging-device-check/config.json',
    );
  });

  test('falls back to XDG_CONFIG_HOME, then ~/.config', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/h' })).toBe(
      '/x/cfg/staging-device-check/config.json',
    );
    expect(configPath({ HOME: '/h' })).toBe('/h/.config/staging-device-check/config.json');
  });
});

describe('settings file', () => {
  test('defaults are the documented values', () => {
    expect(defaults).toEqual({
      standMarker: 'Stand',
      perRunMinutes: 6,
      warnBelowMinutes: 20,
      tokenMinutes: 20,
    });
  });

  test('saveConfig writes mode 600 and loadConfig round-trips', () => {
    const env = { XDG_CONFIG_HOME: join(tempDir(), 'cfg') };
    saveConfig(sample(), env);
    const file = configPath(env);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700);
    expect(loadConfig(env)).toEqual(sample());
    // atomic: no temp file left next to it
    expect(readdirSync(join(file, '..'))).toEqual(['config.json']);
  });

  test('loadConfig returns null when missing', () => {
    expect(loadConfig({ XDG_CONFIG_HOME: join(tempDir(), 'nothing-here') })).toBeNull();
  });

  test('loadConfig fills the defaults a hand-written file leaves out', () => {
    const env = { XDG_CONFIG_HOME: tempDir() };
    mkdirSync(join(configPath(env), '..'), { recursive: true });
    const {
      standMarker: _s,
      perRunMinutes: _p,
      warnBelowMinutes: _w,
      tokenMinutes: _t,
      ...bare
    } = sample();
    writeFileSync(configPath(env), JSON.stringify(bare), { mode: 0o600 });
    expect(loadConfig(env)).toEqual(sample());
  });

  test('rejects tokenMinutes outside 1..120', () => {
    const env = { XDG_CONFIG_HOME: join(tempDir(), 'cfg') };
    for (const tokenMinutes of [0, 121, 1.5, -5]) {
      expect(() => saveConfig(sample({ tokenMinutes }), env)).toThrow('tokenMinutes');
    }
    expect(existsSync(configPath(env))).toBe(false);
    saveConfig(sample({ tokenMinutes: 120 }), env);
    writeFileSync(configPath(env), JSON.stringify(sample({ tokenMinutes: 500 })), { mode: 0o600 });
    expect(() => loadConfig(env)).toThrow('tokenMinutes');
  });

  test('rejects an account whose login is neither quick nor code', () => {
    const env = { XDG_CONFIG_HOME: join(tempDir(), 'cfg') };
    const bad = sample();
    (bad.accounts[0] as { login: string }).login = 'password';
    expect(() => saveConfig(bad, env)).toThrow('login');
  });
});
