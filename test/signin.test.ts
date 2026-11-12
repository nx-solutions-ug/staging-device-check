import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestAccount } from '../src/config.js';
import {
  NichtPruefbarHier,
  signIn,
  type SignInDeps,
  type SignInPage,
} from '../plugins/staging-device-check/workspace/harness/signin.js';

const quickAccount: TestAccount = {
  label: 'Tester A',
  email: 'qa+a@example.test',
  persona: 'a',
  project: 'acme-de',
  login: 'quick',
};
const codeAccount: TestAccount = {
  label: 'Tester B',
  email: 'qa+b@example.test',
  persona: 'b',
  project: 'acme-de',
  login: 'code',
};

/** Fake page: every locator records what was done to it; keyboard.type is forbidden. */
function fakePage(log: string[] = []) {
  const loc = (sel: string, filter = ''): ReturnType<SignInPage['locator']> => ({
    filter: (o) => loc(sel, `${filter}[hasText=${o.hasText}]`),
    first: () => loc(sel, `${filter}:first`),
    tap: async () => void log.push(`tap ${sel}${filter}`),
    click: async () => void log.push(`click ${sel}${filter}`),
    fill: async (v) => void log.push(`fill ${sel}${filter} ${v}`),
    pressSequentially: async (t) => void log.push(`pressSequentially ${sel}${filter} ${t}`),
  });
  const page = {
    locator: (sel: string) => loc(sel),
    keyboard: {
      type: async () => {
        throw new Error('keyboard.type is not allowed (iOS shim writes nothing)');
      },
    },
  };
  return { page: page as SignInPage, log };
}

/** Shared fake clock + mailbox; every `deps()` built from the same harness shares the run folder. */
function harness(runDir = mkdtempSync(join(tmpdir(), 'sdc-signin-'))) {
  let t = Date.parse('2026-11-12T10:00:00.000Z');
  const sends: number[] = [];
  const snapshots: number[] = [];
  const clock = {
    now: () => t,
    sleep: async (ms: number) => {
      // yield, so concurrent sign-ins interleave like real workers
      await new Promise((r) => setTimeout(r, 0));
      t += ms;
    },
  };
  const deps = (over: Partial<SignInDeps> = {}): SignInDeps => ({
    goto: async () => {},
    loginPath: '/login',
    selectors: {
      quickToggle: '[data-test=quick-toggle]',
      quickEntry: '[data-test=quick-entry]',
      email: '#email',
      send: '[data-test=send-code]',
      code: '#code',
    },
    runDir,
    mailbox: 'shared',
    codes: {
      snapshot: async () => {
        snapshots.push(t);
        return new Set(['earlier-mail']);
      },
      read: async (_email, known) => {
        expect(known.has('earlier-mail')).toBe(true);
        return '482913';
      },
    },
    now: clock.now,
    sleep: clock.sleep,
    ...over,
  });
  return { deps, clock, sends, snapshots, runDir };
}

/** A page whose send button records the clock time of every code request. */
function sendingPage(h: ReturnType<typeof harness>) {
  const fp = fakePage();
  const orig = fp.page.locator;
  fp.page.locator = (sel) => {
    const l = orig(sel);
    return sel === '[data-test=send-code]'
      ? { ...l, tap: async () => void h.sends.push(h.clock.now()) }
      : l;
  };
  return fp.page;
}

describe('signIn', () => {
  test('quick login taps the entry that contains the address', async () => {
    const { page, log } = fakePage();
    await signIn(page, quickAccount, harness().deps());
    expect(log).toEqual([
      'tap [data-test=quick-toggle]',
      'tap [data-test=quick-entry][hasText=qa+a@example.test]:first',
    ]);
  });

  test('uses pressSequentially, never keyboard.type', async () => {
    const { page, log } = fakePage();
    await signIn(page, codeAccount, harness().deps());
    expect(log).toEqual([
      'fill #email qa+b@example.test',
      'tap [data-test=send-code]',
      'pressSequentially #code 482913',
    ]);
  });

  test('the mailbox snapshot is taken before the code is requested', async () => {
    const h = harness();
    await signIn(sendingPage(h), codeAccount, h.deps());
    expect(h.snapshots[0]).toBeLessThanOrEqual(h.sends[0]);
  });

  test('waits on the resend limit (fake clock)', async () => {
    const h = harness();
    await signIn(sendingPage(h), codeAccount, h.deps());
    h.clock.sleep(20_000);
    await signIn(sendingPage(h), codeAccount, h.deps());
    expect(h.sends[1] - h.sends[0]).toBeGreaterThanOrEqual(60_000);
  });

  test('two parallel sign-ins with the same address: the second waits for its own slot', async () => {
    const h = harness();
    await Promise.all([
      signIn(sendingPage(h), codeAccount, h.deps()),
      signIn(sendingPage(h), codeAccount, h.deps()),
    ]);
    expect(h.sends).toHaveLength(2);
    const [a, b] = [...h.sends].sort((x, y) => x - y);
    expect(b - a).toBeGreaterThanOrEqual(60_000);
    expect(readdirSync(h.runDir).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });

  test('a lock held by another worker is waited for until it is released', async () => {
    const h = harness();
    await signIn(sendingPage(h), codeAccount, h.deps());
    const ledgerFile = readdirSync(h.runDir).find((f) => f.endsWith('.json')) as string;
    const lock = join(h.runDir, `${ledgerFile}.lock`);
    writeFileSync(lock, String(h.clock.now())); // held by "another worker"
    const t0 = h.clock.now();
    let retries = 0;
    const deps = h.deps({
      sleep: async (ms) => {
        await h.clock.sleep(ms);
        if (existsSync(lock) && ++retries === 3) rmSync(lock); // the other worker finishes
      },
    });
    await signIn(sendingPage(h), codeAccount, deps);
    expect(retries).toBeGreaterThanOrEqual(3);
    expect(h.sends).toHaveLength(2);
    expect(h.sends[1] - h.sends[0]).toBeGreaterThanOrEqual(60_000);
    expect(existsSync(lock)).toBe(false);
    void t0;
  });

  test('a stale lock (left by a crashed worker) is broken after the timeout', async () => {
    const h = harness();
    await signIn(sendingPage(h), codeAccount, h.deps());
    const ledgerFile = readdirSync(h.runDir).find((f) => f.endsWith('.json')) as string;
    const lock = join(h.runDir, `${ledgerFile}.lock`);
    writeFileSync(lock, String(h.clock.now() - 60_000)); // written a minute ago, never released
    await signIn(sendingPage(h), codeAccount, h.deps());
    expect(h.sends).toHaveLength(2);
    expect(existsSync(lock)).toBe(false);
  });

  test('refuses a sixth code within the hour', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      await signIn(sendingPage(h), codeAccount, h.deps());
      await h.clock.sleep(61_000);
    }
    await expect(signIn(sendingPage(h), codeAccount, h.deps())).rejects.toThrow('5 Codes');
  });

  test('demo mailbox: a code login is skipped as nicht prüfbar hier, no code requested', async () => {
    const h = harness();
    const { page, log } = fakePage();
    const err = await signIn(page, codeAccount, h.deps({ mailbox: 'demo' })).catch((e) => e);
    expect(err).toBeInstanceOf(NichtPruefbarHier);
    expect(String(err.message)).toContain('nicht prüfbar hier');
    expect(log).toEqual([]);
    expect(h.snapshots).toEqual([]);
    expect(readdirSync(h.runDir)).toEqual([]);
  });

  test('demo mailbox does not affect a quick login', async () => {
    const { page, log } = fakePage();
    await signIn(page, quickAccount, harness().deps({ mailbox: 'demo' }));
    expect(log).toHaveLength(2);
  });

  test('shared mailbox: a timeout stays an ordinary failure (nicht bestanden)', async () => {
    const h = harness();
    const deps = h.deps({
      codes: {
        snapshot: async () => new Set(),
        read: async () => {
          throw new Error(
            'Kein Login-Code für qa+b@example.test innerhalb von 60 s in Mailpit angekommen.',
          );
        },
      },
    });
    const err = await signIn(fakePage().page, codeAccount, deps).catch((e) => e);
    expect(err).not.toBeInstanceOf(NichtPruefbarHier);
    expect(String(err.message)).toContain('Kein Login-Code');
  });
});
