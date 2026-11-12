import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '../src/config.js';
import { cleanRunFolder, prepare, runTests, type RunDeps } from '../src/run.js';
import type { SecretDeps } from '../src/secret.js';
import { sampleConfig } from './fixtures/config.js';

const FAKE_USER = 'fake-user-0001';
const FAKE_KEY = 'fakeAccessKey000000000';
const GATE_PW = 'invented-gate-password-0001';
const TOKEN = 'invented-run-token-value-0001';

function home() {
  const root = mkdtempSync(join(tmpdir(), 'sdc-run-'));
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'cfg'),
    XDG_DATA_HOME: join(root, 'data'),
  } as NodeJS.ProcessEnv;
  // an installed workspace (only what prepare links)
  const ws = join(root, 'data', 'staging-device-check', 'workspace');
  mkdirSync(join(ws, 'node_modules', '.bin'), { recursive: true });
  mkdirSync(join(ws, 'harness'), { recursive: true });
  const yml = join(root, 'browserstack.yml');
  cpSync(new URL('./fixtures/yml/sample.yml', import.meta.url).pathname, yml);
  chmodSync(yml, 0o600);
  saveConfig(sampleConfig({ browserstackYml: yml }), env);
  return { root, env, ws, yml };
}

const secretDeps = (env: NodeJS.ProcessEnv): SecretDeps => ({
  env,
  platform: 'linux',
  run: (_cmd, args) =>
    args[0] === 'lookup' ? { status: 0, stdout: GATE_PW } : { status: 0, stdout: '' },
});

function deps(env: NodeJS.ProcessEnv, over: Partial<RunDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: Array<{ cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const d: RunDeps = {
    env,
    secret: secretDeps(env),
    fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
    now: () => new Date('2026-11-12T10:30:00'),
    listTests: async () => 2,
    spawn: async (cmd, args, opts) => {
      spawned.push({ cmd, args, ...opts });
      return 0;
    },
    out: (s) => void out.push(s),
    err: (s) => void err.push(s),
    ...over,
  };
  return { d, out, err, spawned };
}

describe('prepare', () => {
  test('prepare creates the folder layout', () => {
    const h = home();
    const { d, out } = deps(h.env);
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(dir).toBe(
      join(h.root, 'Documents', 'staging-device-check', 'ACME-1', '2026-11-12_1030'),
    );
    expect(out.join('\n')).toContain(dir);
    const config = readFileSync(join(dir, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("testDir: '.'");
    expect(config).toContain("outputFile: 'result.json'");
    expect(config).toContain("trace: 'off'");
    // Android Chrome on BrowserStack refuses tap() without it (live check)
    expect(config).toContain('hasTouch: true');
    for (const link of ['node_modules', 'harness']) {
      expect(lstatSync(join(dir, link)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(dir, link))).toBe(join(h.ws, link));
    }
    expect(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))).toMatchObject({
      ticket: 'ACME-1',
      host: 'd-acme-de--main.dating.staging.example.test',
    });
  });

  test('prepare refuses a malformed ticket and a missing workspace', () => {
    const h = home();
    const { d } = deps(h.env);
    expect(() => prepare('acme 1', 'd-acme-de--main.dating.staging.example.test', d)).toThrow(
      'Ticket',
    );
    const other = home();
    const { d: d2 } = deps({ ...other.env, XDG_DATA_HOME: join(other.root, 'empty') });
    expect(() => prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d2)).toThrow(
      'install-workspace',
    );
  });
});

describe('runTests', () => {
  test('run refuses when checkYml has errors', async () => {
    const h = home();
    writeFileSync(h.yml, 'framework: selenium\nplatforms: []\n', { mode: 0o600 });
    const { d, err, spawned } = deps(h.env);
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(1);
    expect(spawned).toEqual([]);
    expect(err.join('\n')).toMatch(/framework/);
  });

  test('run refuses above perRunMinutes without --confirm-minutes', async () => {
    const h = home();
    const { d, err, spawned } = deps(h.env, { listTests: async () => 3 }); // 3 tests x 2 devices x 1.5 = 9 > 6
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(1);
    expect(spawned).toEqual([]);
    expect(err.join('\n')).toMatch(/9 Min/);
    expect(err.join('\n')).toMatch(/--confirm-minutes/);
    expect(await runTests(dir, { confirmMinutes: 9 }, d)).toBe(0);
    expect(spawned).toHaveLength(1);
  });

  test('refuses when no test is found', async () => {
    const h = home();
    const { d, err, spawned } = deps(h.env, { listTests: async () => 0 });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(1);
    expect(spawned).toEqual([]);
    expect(err.join('\n')).toContain('Keine Tests');
  });

  test('stops the SDK when a test reports an environment that is not started', async () => {
    const h = home();
    let signal: AbortSignal | undefined;
    const { d, err } = deps(h.env, {
      spawn: (_c, _a, opts, onStdout) => {
        signal = opts.signal;
        onStdout(
          '  1) [iPhone 16] ACME-1 › start\n    UmgebungNichtGestartet: Umgebung nicht gestartet: d-acme-de--main.dating.staging.example.test zeigt nicht die App.\n',
        );
        return new Promise((resolve) => {
          if (opts.signal?.aborted) resolve(143);
          opts.signal?.addEventListener('abort', () => resolve(143));
        });
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).not.toBe(0);
    expect(signal?.aborted).toBe(true);
    expect(err.join('\n')).toContain('abgebrochen');
  });

  test('runs the SDK with the run context in env, credentials not in argv', async () => {
    const h = home();
    const { d, spawned, out } = deps(h.env);
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, { devices: ['iphone'], mailbox: 'demo' }, d)).toBe(0);
    const s = spawned[0];
    expect(s.cmd).toBe(join(dir, 'node_modules', '.bin', 'browserstack-node-sdk'));
    expect(s.args).toEqual(['playwright', 'test']);
    expect(s.cwd).toBe(dir);
    expect(s.env).toMatchObject({
      SDC_HOST: 'd-acme-de--main.dating.staging.example.test',
      SDC_RUN_DIR: dir,
      SDC_TICKET: 'ACME-1',
      SDC_MAILBOX: 'demo',
      BROWSERSTACK_CONFIG_FILE: join(dir, '.browserstack.run.yml'),
    });
    expect(JSON.stringify(s.args)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(s)).not.toContain(GATE_PW);
    // the yml copy is gone after the run
    expect(existsSync(join(dir, '.browserstack.run.yml'))).toBe(false);
    expect(out.join('\n')).toMatch(/geschätzt/);
  });

  test('the SDK gets a mode-600 copy narrowed to the chosen devices with the build name', async () => {
    const h = home();
    let seen = '';
    let mode = 0;
    const { d } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        const f = opts.env.BROWSERSTACK_CONFIG_FILE as string;
        seen = readFileSync(f, 'utf8');
        mode = statSync(f).mode & 0o777;
        return 0;
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    await runTests(dir, { devices: ['android'] }, d);
    expect(mode).toBe(0o600);
    expect(seen).toContain('Samsung Galaxy S23');
    expect(seen).not.toContain('iPhone 16');
    expect(seen).toContain('buildName: ACME-1 2026-11-12');
  });

  test('the narrowed copy carries no credentials; the child env does', async () => {
    const h = home();
    let seen = '';
    let env: NodeJS.ProcessEnv = {};
    const { d } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        seen = readFileSync(opts.env.BROWSERSTACK_CONFIG_FILE as string, 'utf8');
        env = opts.env;
        return 0;
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, { devices: ['iphone'] }, d)).toBe(0);
    expect(seen).not.toContain(FAKE_USER);
    expect(seen).not.toContain(FAKE_KEY);
    expect(seen).not.toMatch(/userName|accessKey/);
    expect(env.BROWSERSTACK_USERNAME).toBe(FAKE_USER);
    expect(env.BROWSERSTACK_ACCESS_KEY).toBe(FAKE_KEY);
  });

  test('her yml with exactly one iPhone and one Android is read in place, no copy', async () => {
    const h = home();
    let env: NodeJS.ProcessEnv = {};
    let copyDuringRun = true;
    const { d } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        env = opts.env;
        copyDuringRun = existsSync(join(opts.cwd, '.browserstack.run.yml'));
        return 0;
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(0);
    expect(env.BROWSERSTACK_CONFIG_FILE).toBe(h.yml);
    expect(env.BROWSERSTACK_BUILD_NAME).toBe('ACME-1 2026-11-12');
    expect(env.BROWSERSTACK_USERNAME).toBeUndefined();
    expect(env.BROWSERSTACK_ACCESS_KEY).toBeUndefined();
    expect(copyDuringRun).toBe(false);
  });

  test('narrowing keeps scalars as written (osVersion 13.10 and 13.0)', async () => {
    const h = home();
    writeFileSync(
      h.yml,
      [
        `userName: ${FAKE_USER}`,
        `accessKey: ${FAKE_KEY}`,
        'framework: playwright',
        'platforms:',
        '  - deviceName: iPhone 16',
        '    osVersion: 18.0',
        '    browserName: safari',
        '  - deviceName: Samsung Galaxy S23',
        '    osVersion: 13.10',
        '    browserName: chrome',
        '  - deviceName: Google Pixel 8',
        '    osVersion: 13.0',
        '    browserName: chrome',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    let seen = '';
    const { d } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        seen = readFileSync(opts.env.BROWSERSTACK_CONFIG_FILE as string, 'utf8');
        return 0;
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, { devices: ['iphone', 'android'] }, d)).toBe(0);
    expect(seen).toContain('osVersion: 18.0');
    expect(seen).toContain('osVersion: 13.10');
    expect(seen).not.toContain('Google Pixel 8');
  });

  test('the default narrows to the first iPhone and the first Android, never a desktop platform', async () => {
    const h = home();
    writeFileSync(
      h.yml,
      [
        `userName: ${FAKE_USER}`,
        `accessKey: ${FAKE_KEY}`,
        'framework: playwright',
        'platforms:',
        '  - os: Windows',
        '    osVersion: 11',
        '    browserName: chrome',
        '  - deviceName: iPhone 16',
        '    osVersion: 18',
        '    browserName: safari',
        '  - deviceName: Samsung Galaxy S23',
        '    osVersion: 13.0',
        '    browserName: chrome',
        '  - deviceName: Google Pixel 8',
        '    osVersion: 14.0',
        '    browserName: chrome',
        'browserstackLocal: false',
        'browserstackLocalOptions:',
        `  key: ${FAKE_KEY}`,
        '  proxyPass: invented-proxy-pass-0001',
        '  forceLocal: false',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    let seen = '';
    let env: NodeJS.ProcessEnv = {};
    const { d, out } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        env = opts.env;
        seen = readFileSync(opts.env.BROWSERSTACK_CONFIG_FILE as string, 'utf8');
        return 0;
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(0);
    expect(env.BROWSERSTACK_CONFIG_FILE).toBe(join(dir, '.browserstack.run.yml'));
    expect(seen).toContain('iPhone 16');
    expect(seen).toContain('Samsung Galaxy S23');
    expect(seen).not.toContain('Google Pixel 8');
    expect(seen).not.toContain('Windows');
    expect(seen).not.toContain(FAKE_KEY);
    expect(seen).not.toContain('invented-proxy-pass-0001');
    expect(seen).not.toMatch(/^\s*(key|proxyPass):/m);
    expect(seen).toContain('forceLocal: false');
    expect(env.BROWSERSTACK_USERNAME).toBe(FAKE_USER);
    expect(env.BROWSERSTACK_ACCESS_KEY).toBe(FAKE_KEY);
    expect(out.join('\n')).toContain('2 Gerät(e)');
    expect(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).devices).toEqual([
      'iPhone 16',
      'Samsung Galaxy S23',
    ]);
  });

  test('an outside abort (Ctrl+C, SIGTERM) stops the SDK and still cleans the run folder', async () => {
    const h = home();
    const outside = new AbortController();
    let signal: AbortSignal | undefined;
    const { d, err } = deps(h.env, {
      spawn: (_c, _a, opts) => {
        signal = opts.signal;
        writeFileSync(join(opts.cwd, '.run-tokens'), `${TOKEN}\n`, { mode: 0o600 });
        writeFileSync(join(opts.cwd, 'partial.txt'), `token ${TOKEN}`);
        outside.abort();
        return new Promise((resolve) => {
          if (opts.signal?.aborted) resolve(143);
          opts.signal?.addEventListener('abort', () => resolve(143));
        });
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, { signal: outside.signal }, d)).not.toBe(0);
    expect(signal?.aborted).toBe(true);
    expect(err.join('\n')).toContain('Lauf abgebrochen');
    expect(err.join('\n')).not.toContain('Umgebung nicht gestartet');
    expect(existsSync(join(dir, '.run-tokens'))).toBe(false);
    expect(readFileSync(join(dir, 'partial.txt'), 'utf8')).not.toContain(TOKEN);
  });

  test('a stale yml copy is removed before anything else', async () => {
    const h = home();
    const { d } = deps(h.env, { listTests: async () => 0 });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    writeFileSync(join(dir, '.browserstack.run.yml'), `accessKey: ${FAKE_KEY}\n`, { mode: 0o600 });
    expect(await runTests(dir, {}, d)).toBe(1);
    expect(existsSync(join(dir, '.browserstack.run.yml'))).toBe(false);
  });

  test('unknown remaining minutes require --confirm-minutes', async () => {
    const h = home();
    const { d, err, spawned } = deps(h.env, {
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(1); // 2 tests x 2 devices x 1.5 = 6, within perRunMinutes
    expect(spawned).toEqual([]);
    expect(err.join('\n')).toContain('--confirm-minutes 6');
    expect(await runTests(dir, { confirmMinutes: 6 }, d)).toBe(0);
    expect(spawned).toHaveLength(1);
  });

  test('cleans SDK logs and redacts the run folder', async () => {
    const h = home();
    const { d } = deps(h.env, {
      spawn: async (_c, _a, opts) => {
        const dir = opts.cwd;
        mkdirSync(join(dir, 'log'), { recursive: true });
        writeFileSync(
          join(dir, 'log', 'sdk.log'),
          `user=${FAKE_USER} key=${FAKE_KEY} pw=${GATE_PW}`,
        );
        writeFileSync(
          join(dir, 'browserstack.err'),
          `auth ${Buffer.from(`${FAKE_USER}:${FAKE_KEY}`).toString('base64')}`,
        );
        writeFileSync(
          join(dir, 'result.json'),
          JSON.stringify({ note: `token ${TOKEN} and "${GATE_PW}"` }),
        );
        writeFileSync(join(dir, '.run-tokens'), `${TOKEN}\n`, { mode: 0o600 });
        mkdirSync(join(dir, 'screenshots'), { recursive: true });
        writeFileSync(
          join(dir, 'screenshots', 'a.png'),
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
        );
        return 1; // a failing run cleans up too
      },
    });
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    expect(await runTests(dir, {}, d)).toBe(1);
    expect(existsSync(join(dir, 'log'))).toBe(false);
    expect(existsSync(join(dir, '.run-tokens'))).toBe(false);
    for (const f of ['browserstack.err', 'result.json', 'run.json', 'playwright.config.ts']) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const s of [
        FAKE_USER,
        FAKE_KEY,
        GATE_PW,
        TOKEN,
        Buffer.from(`${FAKE_USER}:${FAKE_KEY}`).toString('base64'),
      ]) {
        expect(text).not.toContain(s);
      }
    }
    expect(readFileSync(join(dir, 'result.json'), 'utf8')).toContain('«geheim»');
    expect([...readFileSync(join(dir, 'screenshots', 'a.png'))]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0, 1, 2,
    ]);
  });

  test('cleanRunFolder never follows the workspace links', () => {
    const h = home();
    const { d } = deps(h.env);
    const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
    writeFileSync(join(h.ws, 'harness', 'keep.txt'), `x ${FAKE_KEY}`);
    cleanRunFolder(dir, [FAKE_KEY]);
    expect(readFileSync(join(h.ws, 'harness', 'keep.txt'), 'utf8')).toContain(FAKE_KEY);
  });
});
