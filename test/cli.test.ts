import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
    nodeFrom: 'eigene Kopie',
    readStdin: async () => '',
    mcpStart: () => ({
      status: 0,
      stdout: 'startet über eigene Kopie (/x/node/bin)\n',
      stderr: '',
    }),
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
      'host',
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
    expect(t).toMatch(/^ok Playwright-MCP/m);
    expect(code).toBe(0);
  });

  test('doctor flags a Playwright MCP start that is missing, unpinned, without the gate session or without Node', async () => {
    const h = home();
    const plugin = join(h.root, 'plugin');
    mkdirSync(join(plugin, 'workspace'), { recursive: true });
    mkdirSync(join(plugin, 'scripts'));
    let start = { status: 0, stdout: 'startet über eigene Kopie (/x/node/bin)\n', stderr: '' };
    const check = async () => {
      const { d, out } = deps(h.env, {
        workspaceSource: join(plugin, 'workspace'),
        mcpStart: () => start,
      });
      await main(['doctor', '--json'], d);
      return (
        JSON.parse(out.join('\n')) as Array<{ status: string; label: string; detail: string }>
      ).find((x) => x.label === 'Playwright-MCP');
    };
    expect((await check())?.status).toBe('fehlt');
    const config = (server: object) =>
      writeFileSync(
        join(plugin, '.mcp.json'),
        JSON.stringify({ mcpServers: { playwright: server } }),
      );
    config({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.84'] });
    expect((await check())?.detail).toContain('scripts/playwright-mcp');
    config({ command: 'sh', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/playwright-mcp'] });
    const script = (body: string) => writeFileSync(join(plugin, 'scripts', 'playwright-mcp'), body);
    script(
      'exec npx -y @playwright/mcp@latest --storage-state "$d/staging-device-check/gate-state.json"',
    );
    expect((await check())?.detail).toContain('Version');
    script('exec npx -y @playwright/mcp@0.0.84 --isolated');
    expect((await check())?.detail).toContain('gate-state.json');
    script(
      'exec npx -y @playwright/mcp@0.0.84 --isolated --storage-state "$d/staging-device-check/gate-state.json"',
    );
    expect(await check()).toMatchObject({ status: 'ok' });
    expect((await check())?.detail).toContain('eigene Kopie');
    start = { status: 127, stdout: '', stderr: 'Node fehlt: Bitte zuerst das Setup ausführen.\n' };
    expect(await check()).toMatchObject({ status: 'fehlt' });
    expect((await check())?.detail).toContain('Node fehlt');
  });

  test('doctor names where Node comes from, and hints when the own copy is missing', async () => {
    const h = home();
    const own = deps(h.env);
    await main(['doctor'], own.d);
    expect(own.out.join('\n')).toMatch(/^ok Node 26\.13\.1 \(eigene Kopie\)/m);
    const system = deps(h.env, { nodeFrom: 'System-Node' });
    await main(['doctor'], system.d);
    expect(system.out.join('\n')).toMatch(/^hinweis Node-Kopie/m);
  });
});

describe('set-secret --stdin (the native dialog pipes the value in)', () => {
  test('stores the first line and prints only where, never the value', async () => {
    const h = home();
    const { d, out, err, text } = deps(h.env, { readStdin: async () => `${GATE_PW}\n` });
    expect(await main(['set-secret', '--stdin'], d)).toBe(0);
    expect(out).toEqual(['gespeichert (Datei)']);
    expect(err).toEqual([]);
    expect(text()).not.toContain(GATE_PW);
    expect(
      readFileSync(
        join(h.env.XDG_CONFIG_HOME as string, 'staging-device-check', 'gate-password'),
        'utf8',
      ).trim(),
    ).toBe(GATE_PW);
  });

  test('empty input (dialog cancelled) and a short value store nothing', async () => {
    for (const input of ['', '\n', 'short-pass\n']) {
      const h = home();
      const { d, err, text } = deps(h.env, { readStdin: async () => input });
      expect(await main(['set-secret', '--stdin'], d)).toBe(1);
      expect(err.join('\n')).toMatch(/Nichts gespeichert/i);
      expect(text()).not.toContain('short-pass');
      expect(
        existsSync(join(h.env.XDG_CONFIG_HOME as string, 'staging-device-check', 'gate-password')),
      ).toBe(false);
    }
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
  test('report lists planned checks without a result as nicht gelaufen', async () => {
    const h = home();
    const { d, out } = deps(h.env);
    const dir = join(h.root, 'run');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'run.json'),
      JSON.stringify({
        ticket: 'ACME-1',
        host: 'd-acme-de--main.dating.staging.example.test',
        createdAt: '2026-11-12T10:30:00',
        devices: ['Samsung Galaxy S23'],
        plan: [{ title: 'Konto A (frau)', checks: ['Kopf da', 'Preis'] }],
      }),
    );
    writeFileSync(
      join(dir, 'result.json'),
      JSON.stringify({
        suites: [
          {
            specs: [
              {
                title: 'Konto A (frau)',
                tests: [
                  {
                    projectName: 'chrome-Samsung Galaxy S23:13.0-browserstack-mobile',
                    results: [
                      {
                        status: 'failed',
                        steps: [{ title: 'Kopf da', error: { message: 'Error: weg' } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(await main(['report', dir, 'ACME-1'], d)).toBe(0);
    expect(out.join('\n')).toContain('| Preis | — | nicht bestanden | Android: nicht gelaufen |');
  });

  test('host builds the app host from the settings, by project name or label', async () => {
    const h = home();
    saveConfig(sampleConfig(), h.env);
    const { d, out, err } = deps(h.env);
    expect(await main(['host', 'acme.de'], d)).toBe(0);
    expect(await main(['host', 'acme-de', 'feat/ACME-42-dark-mode'], d)).toBe(0);
    expect(out).toEqual([
      'd-acme-de--main.dating.staging.example.test',
      'd-acme-de--feat--acme-42-dark-mode.dating.staging.example.test',
    ]);
    expect(await main(['host', 'unknown'], d)).toBe(1);
    expect(err.join('\n')).toContain('acme.de');
  });

  test('a second Ctrl+C removes the token list and the yml copy before the hard exit', async () => {
    const h = home();
    const yml = join(h.root, 'browserstack.yml');
    cpSync(new URL('./fixtures/yml/sample.yml', import.meta.url).pathname, yml);
    chmodSync(yml, 0o600);
    saveConfig(sampleConfig({ browserstackYml: yml }), h.env);
    const ws = join(h.env.XDG_DATA_HOME as string, 'staging-device-check', 'workspace');
    mkdirSync(join(ws, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(ws, 'harness'), { recursive: true });
    let handlers: { stop: () => void; hard: () => void } | null = null;
    let leftover: string[] = [];
    const { d } = deps(h.env, {
      fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
      listTests: async () => 1,
      interrupts: (stop, hard) => {
        handlers = { stop, hard };
        return () => {};
      },
      spawn: async (_c, _a, opts) => {
        writeFileSync(join(opts.cwd, '.run-tokens'), 'invented-run-token-value-0002\n', {
          mode: 0o600,
        });
        writeFileSync(join(opts.cwd, '.browserstack.run.yml'), 'framework: playwright\n', {
          mode: 0o600,
        });
        handlers?.stop();
        handlers?.hard();
        leftover = readdirSync(opts.cwd).filter((f) => f.startsWith('.'));
        return 130;
      },
    });
    const dir = (await (async () => {
      await main(['prepare', 'ACME-1', '--host', 'd-acme-de--main.dating.staging.example.test'], d);
      const base = join(h.root, 'Documents', 'staging-device-check', 'ACME-1');
      return join(base, readdirSync(base)[0]);
    })()) as string;
    await main(['run', dir, '--devices', 'iphone'], d);
    expect(leftover).toEqual([]);
  });

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
    expect(await main(['report', dir, 'acme'], d)).toBe(1);
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
