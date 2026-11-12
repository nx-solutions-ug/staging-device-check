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
