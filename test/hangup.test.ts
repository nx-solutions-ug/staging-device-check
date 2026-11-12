import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/**
 * A real CLI process with a running SDK stand-in (an `sh` whose background `sleep` is the grandchild), the CLI's real
 * signal wiring and a run folder holding a token list, a yml copy and a file with a token and a secret in it.
 */
const SCRIPT = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realDeps } from ${JSON.stringify(join(ROOT, 'src', 'cli.ts'))};
import { hardStop, realSpawn, trackRun } from ${JSON.stringify(join(ROOT, 'src', 'run.ts'))};
const [dir, mode] = process.argv.slice(2);
writeFileSync(join(dir, '.run-tokens'), 'invented-run-token-0003\\n', { mode: 0o600 });
writeFileSync(join(dir, '.browserstack.run.yml'), 'framework: playwright\\n', { mode: 0o600 });
writeFileSync(join(dir, 'out.txt'), 'token invented-run-token-0003 key invented-secret-0003\\n');
trackRun(dir, ['invented-secret-0003']);
const abort = new AbortController();
realDeps().interrupts(() => abort.abort(), hardStop);
void realSpawn('sh', ['-c', 'sleep 60 & echo $! > grandchild.pid; wait'], { cwd: dir, env: process.env, signal: abort.signal }, () => {}, () => {});
const ready = setInterval(() => {
  if (!existsSync(join(dir, 'grandchild.pid')) || !readFileSync(join(dir, 'grandchild.pid'), 'utf8').trim()) return;
  clearInterval(ready);
  if (mode === 'exit') process.exit(0);
  process.stdout.write('ready\\n');
}, 50);
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function stopWith(mode: 'hup' | 'exit') {
  const dir = mkdtempSync(join(tmpdir(), 'sdc-hup-'));
  const script = join(dir, 'cli-stand-in.ts');
  writeFileSync(script, SCRIPT);
  const child = spawn(process.execPath, [script, dir, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>((r) => child.on('close', (c) => r(c)));
  if (mode === 'hup') {
    const ready = new Promise<boolean>((r) =>
      child.stdout.on('data', (b) => String(b).includes('ready') && r(true)),
    );
    if (await Promise.race([ready, exited.then(() => false)])) child.kill('SIGHUP');
  }
  const code = await exited;
  const grandchild = Number(readFileSync(join(dir, 'grandchild.pid'), 'utf8'));
  await new Promise((r) => setTimeout(r, 200));
  return { dir, code, grandchild };
}

describe('the CLI process ends without leaving the SDK or secrets behind', () => {
  for (const mode of ['hup', 'exit'] as const) {
    test(`${mode === 'hup' ? 'SIGHUP' : 'a plain exit'} kills the SDK group and cleans the run folder`, async () => {
      const { dir, code, grandchild } = await stopWith(mode);
      try {
        expect(code).toBe(mode === 'hup' ? 129 : 0);
        expect(alive(grandchild)).toBe(false);
        expect(existsSync(join(dir, '.run-tokens'))).toBe(false);
        expect(existsSync(join(dir, '.browserstack.run.yml'))).toBe(false);
        const out = readFileSync(join(dir, 'out.txt'), 'utf8');
        expect(out).not.toContain('invented-run-token-0003');
        expect(out).not.toContain('invented-secret-0003');
      } finally {
        if (alive(grandchild)) process.kill(grandchild, 'SIGKILL');
        rmSync(dir, { recursive: true, force: true });
      }
    }, 15_000);
  }
});

/**
 * A real CLI process running `runTests` (the SDK stand-in is an `sh` with a background `sleep`), with the CLI's real
 * signal wiring. It prints its run folder once the SDK runs.
 */
const RUN_SCRIPT = `
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realDeps } from ${JSON.stringify(join(ROOT, 'src', 'cli.ts'))};
import { saveConfig } from ${JSON.stringify(join(ROOT, 'src', 'config.ts'))};
import { hardStop, prepare, realSpawn, runTests } from ${JSON.stringify(join(ROOT, 'src', 'run.ts'))};
import { sampleConfig } from ${JSON.stringify(join(ROOT, 'test', 'fixtures', 'config.ts'))};
const [root] = process.argv.slice(2);
const env = { HOME: root, XDG_CONFIG_HOME: join(root, 'cfg'), XDG_DATA_HOME: join(root, 'data'), PATH: process.env.PATH };
const ws = join(root, 'data', 'staging-device-check', 'workspace');
mkdirSync(join(ws, 'node_modules', '.bin'), { recursive: true });
mkdirSync(join(ws, 'harness'), { recursive: true });
const yml = join(root, 'browserstack.yml');
cpSync(${JSON.stringify(join(ROOT, 'test', 'fixtures', 'yml', 'sample.yml'))}, yml);
chmodSync(yml, 0o600);
saveConfig(sampleConfig({ browserstackYml: yml }), env);
const d = {
  env,
  secret: { env, platform: 'linux', run: (_c, args) => ({ status: 0, stdout: args[0] === 'lookup' ? 'invented-gate-password-0004' : '' }) },
  fetchFn: async () => Response.json([]),
  now: () => new Date('2026-11-12T10:30:00'),
  listTests: async () => 1,
  spawn: (_cmd, _args, opts, out, err) =>
    realSpawn('sh', ['-c', 'echo $$ > sdk.pid; sleep 60 & echo $! > grandchild.pid; wait'], opts, out, err),
  out: () => {},
  err: () => {},
};
const dir = prepare('ACME-1', 'd-acme-de--main.dating.staging.example.test', d);
const abort = new AbortController();
realDeps().interrupts(() => abort.abort(), hardStop);
void runTests(dir, { signal: abort.signal }, d);
const ready = setInterval(() => {
  const f = join(dir, 'grandchild.pid');
  if (!existsSync(f) || !readFileSync(f, 'utf8').trim()) return;
  clearInterval(ready);
  process.stdout.write(dir + '\\n');
}, 50);
`;

describe('a run ended without reaching its own end still says so in run.json', () => {
  for (const signal of ['SIGHUP', 'SIGKILL'] as const) {
    test(`${signal}: run.json keeps aborted "sofort beendet"`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'sdc-hard-'));
      const script = join(root, 'cli-run.ts');
      writeFileSync(script, RUN_SCRIPT);
      const child = spawn(process.execPath, [script, root], { stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise<number | null>((r) => child.on('close', (c) => r(c)));
      const dir = await Promise.race([
        new Promise<string>((r) => child.stdout.on('data', (b) => r(String(b).trim()))),
        exited.then(() => ''),
      ]);
      let pids: number[] = [];
      try {
        expect(dir).not.toBe('');
        pids = ['sdk.pid', 'grandchild.pid'].map((f) => Number(readFileSync(join(dir, f), 'utf8')));
        child.kill(signal);
        await exited;
        expect(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).aborted).toBe(
          'sofort beendet',
        );
      } finally {
        // a SIGKILL'd CLI leaves its detached SDK group behind: reap it here
        for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
        rmSync(root, { recursive: true, force: true });
      }
    }, 15_000);
  }
});
