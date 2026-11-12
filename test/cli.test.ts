import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMANDS, main, type CliDeps } from '../src/cli.js';
import { saveConfig } from '../src/config.js';
import type { SecretDeps } from '../src/secret.js';
import { sampleConfig } from './fixtures/config.js';

const GATE_PW = 'invented-gate-password-0001';
const APEX = 'https://staging.example.test';

function home() {
  const root = mkdtempSync(join(tmpdir(), 'sdc-cli-'));
  return {
    root,
    env: {
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'cfg'),
      XDG_DATA_HOME: join(root, 'data'),
    } as NodeJS.ProcessEnv,
  };
}

const noKeychain = (env: NodeJS.ProcessEnv): SecretDeps => ({
  env,
  platform: 'linux',
  run: () => ({ status: 127, stdout: '' }),
});
const keychainWith = (env: NodeJS.ProcessEnv, v: string): SecretDeps => ({
  env,
  platform: 'linux',
  run: (_c, args) => (args[0] === 'lookup' ? { status: 0, stdout: v } : { status: 0, stdout: '' }),
});

function deps(env: NodeJS.ProcessEnv, over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const d: CliDeps = {
    env,
    secret: noKeychain(env),
    fetchFn: (async () => new Response('', { status: 599 })) as unknown as typeof fetch,
    now: () => new Date('2026-11-12T10:30:00'),
    listTests: async () => 1,
    spawn: async (cmd, args, opts) => {
      spawned.push({ cmd, args, cwd: opts.cwd });
      return 0;
    },
    out: (s) => void out.push(s),
    err: (s) => void err.push(s),
    prompt: async () => '',
    workspaceSource: new URL('../plugins/staging-device-check/workspace', import.meta.url).pathname,
    nodeVersion: '26.13.1',
    ...over,
  };
  return { d, out, err, spawned, text: () => [...out, ...err].join('\n') };
}

/** Fake staging + BrowserStack APIs for a healthy setup. */
const healthyFetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.endsWith('/_gate/run-token')) {
    return Response.json({
      name: 'staging_gate_run',
      value: 'invented-token',
      host: 'd-acme-de--main.dating.staging.example.test',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expiry: 1_800_000_000,
      bootstrapPath: '/health',
    });
  }
  if (u.includes('/automate/builds.json')) return Response.json([]);
  return new Response('', { status: 404 });
}) as unknown as typeof fetch;

describe('COMMANDS', () => {
  test('lists every subcommand', () => {
    expect([...COMMANDS]).toEqual([
      'set-secret',
      'doctor',
      'install-workspace',
      'local-state',
      'prepare',
      'run',
      'report',
    ]);
  });

  test('an unknown command prints German usage and exits 64', async () => {
    const h = home();
    const { d, text } = deps(h.env);
    expect(await main(['frobnicate'], d)).toBe(64);
    expect(text()).toContain('Befehle:');
  });
});

describe('doctor', () => {
  test('doctor reports each missing piece in German and exits 1', async () => {
    const h = home();
    const { d, out } = deps(h.env);
    expect(await main(['doctor'], d)).toBe(1);
    const t = out.join('\n');
    expect(t).toMatch(/^ok Node 26/m);
    expect(t).toMatch(/^fehlt Einstellungen/m);
    expect(t).toMatch(/^fehlt Staging-Passwort/m);
    expect(t).toMatch(/^fehlt Test-Arbeitsbereich/m);
    expect(t).toMatch(/^fehlt Gate-Sitzung/m);
  });

  test('doctor --json and an old Node', async () => {
    const h = home();
    const { d, out } = deps(h.env, { nodeVersion: '20.11.0' });
    expect(await main(['doctor', '--json'], d)).toBe(1);
    const j = JSON.parse(out.join('\n')) as Array<{ status: string; label: string }>;
    expect(j.find((x) => x.label.startsWith('Node'))?.status).toBe('fehlt');
  });

  test('a healthy setup passes, with estimated minutes', async () => {
    const h = home();
    const yml = join(h.root, 'bs', 'browserstack.yml');
    mkdirSync(join(h.root, 'bs'));
    cpSync(new URL('./fixtures/yml/sample.yml', import.meta.url).pathname, yml);
    chmodSync(yml, 0o600);
    saveConfig(sampleConfig({ browserstackYml: yml }), h.env);
    const state = join(h.env.XDG_DATA_HOME as string, 'staging-device-check');
    mkdirSync(join(state, 'workspace', 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(state, 'workspace', 'node_modules', '.bin', 'browserstack-node-sdk'), '');
    writeFileSync(
      join(state, 'gate-state.json'),
      JSON.stringify({ cookies: [{ name: 'staging_gate', expires: 1_900_000_000 }], origins: [] }),
    );
    const { d, out } = deps(h.env, { secret: keychainWith(h.env, GATE_PW), fetchFn: healthyFetch });
    const code = await main(['doctor'], d);
    const t = out.join('\n');
    expect(t).not.toMatch(/^fehlt/m);
    expect(t).toMatch(/geschätzt/);
    expect(t).not.toContain(GATE_PW);
    expect(t).not.toContain('invented-token');
    expect(code).toBe(0);
  });
});

describe('set-secret', () => {
  test('refuses a password shorter than 16 characters, in German', async () => {
    const h = home();
    const { d, err } = deps(h.env, { prompt: async () => 'short-pass' });
    expect(await main(['set-secret'], d)).toBe(1);
    expect(err.join('\n')).toMatch(/16 Zeichen/);
  });

  test('refuses when the second entry differs', async () => {
    const h = home();
    const answers = ['invented-gate-password-0001', 'invented-gate-password-0002'];
    const { d, err } = deps(h.env, { prompt: async () => answers.shift() as string });
    expect(await main(['set-secret'], d)).toBe(1);
    expect(err.join('\n')).toMatch(/stimmen nicht überein/);
  });

  test('stores it and says where, never echoing the value', async () => {
    const h = home();
    const { d, out, text } = deps(h.env, { prompt: async () => GATE_PW });
    expect(await main(['set-secret'], d)).toBe(0);
    expect(out.join('\n')).toBe('gespeichert (Datei)');
    expect(text()).not.toContain(GATE_PW);
    expect(
      readFileSync(
        join(h.env.XDG_CONFIG_HOME as string, 'staging-device-check', 'gate-password'),
        'utf8',
      ).trim(),
    ).toBe(GATE_PW);
  });
});

describe('local-state', () => {
  test('writes the MCP storage state mode 600 and prints only the expiry', async () => {
    const h = home();
    saveConfig(sampleConfig(), h.env);
    const fetchFn = (async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: '/',
          'set-cookie':
            'staging_gate=invented-gate-cookie; Max-Age=604800; path=/; domain=.staging.example.test; secure; httponly; samesite=lax',
        },
      })) as unknown as typeof fetch;
    const { d, text } = deps(h.env, { secret: keychainWith(h.env, GATE_PW), fetchFn });
    expect(await main(['local-state'], d)).toBe(0);
    const file = join(h.env.XDG_DATA_HOME as string, 'staging-device-check', 'gate-state.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    expect(state.cookies[0]).toMatchObject({
      name: 'staging_gate',
      value: 'invented-gate-cookie',
      domain: '.staging.example.test',
      httpOnly: true,
      secure: true,
    });
    expect(text()).toMatch(/gültig bis/);
    expect(text()).not.toContain('invented-gate-cookie');
    expect(text()).not.toContain(GATE_PW);
  });
});

describe('install-workspace', () => {
  test('copies the workspace without node_modules and runs npm ci there', async () => {
    const h = home();
    const { d, spawned, out } = deps(h.env);
    expect(await main(['install-workspace'], d)).toBe(0);
    const dest = join(h.env.XDG_DATA_HOME as string, 'staging-device-check', 'workspace');
    expect(existsSync(join(dest, 'package.json'))).toBe(true);
    expect(existsSync(join(dest, 'harness', 'fixtures.ts'))).toBe(true);
    expect(existsSync(join(dest, 'harness', 'lib.js'))).toBe(true);
    expect(spawned).toEqual([{ cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'], cwd: dest }]);
    expect(out.join('\n')).toContain(dest);
  });
});

describe('prepare, run and report through the CLI', () => {
  test('report renders stand-abschnitt.md from result.json', async () => {
    const h = home();
    const dir = join(h.root, 'run');
    mkdirSync(join(dir, 'screenshots'), { recursive: true });
    cpSync(
      new URL('./fixtures/report/result.json', import.meta.url).pathname,
      join(dir, 'result.json'),
    );
    writeFileSync(join(dir, 'screenshots', 'ACME-1_iphone-16_tester-a_01-start.png'), '');
    writeFileSync(join(dir, 'screenshots', 'ACME-1_samsung-galaxy-s23_tester-a_01-start.png'), '');
    writeFileSync(
      join(dir, 'run.json'),
      JSON.stringify({
        ticket: 'ACME-1',
        host: 'd-acme-de--main.dating.staging.example.test',
        createdAt: '2026-11-12T10:30:00',
        devices: ['iPhone 16', 'Samsung Galaxy S23'],
      }),
    );
    const { d, out } = deps(h.env);
    expect(await main(['report', dir, 'ACME-1'], d)).toBe(0);
    const md = readFileSync(join(dir, 'stand-abschnitt.md'), 'utf8');
    expect(md).toBe(readFileSync(new URL('./fixtures/report/stand.md', import.meta.url), 'utf8'));
    expect(out.join('\n')).toContain('**Gerätetest 12.11.2026');
  });

  test('prepare validates its arguments', async () => {
    const h = home();
    const { d, err } = deps(h.env);
    expect(await main(['prepare', 'ACME-1'], d)).toBe(64);
    expect(err.join('\n')).toMatch(/--host/);
    expect(await main(['run', '/nowhere', '--mailbox', 'other'], d)).toBe(64);
  });

  test('a German error never shows a stack trace', async () => {
    const h = home();
    const { d, err } = deps(h.env);
    expect(
      await main(['prepare', 'acme', '--host', 'd-acme-de--main.dating.staging.example.test'], d),
    ).toBe(1);
    expect(err.join('\n')).toMatch(/Ticket/);
    expect(err.join('\n')).not.toMatch(/at .*\.ts:\d+/);
  });
});

void APEX;
