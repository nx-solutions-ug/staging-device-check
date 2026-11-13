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

/**
 * Fake page: every locator records what was done to it; keyboard.type is forbidden. `submitted` is called when the
 * login is sent (the quick-login entry tapped, the code typed), so the harness can let the app navigate away.
 */
function fakePage(log: string[] = [], submitted: () => void = () => {}) {
  const loc = (sel: string, filter = ''): ReturnType<SignInPage['locator']> => ({
    filter: (o) => loc(sel, `${filter}[hasText=${o.hasText}]`),
    first: () => loc(sel, `${filter}:first`),
    tap: async () => {
      log.push(`tap ${sel}${filter}`);
      if (sel === '[data-test=quick-entry]') submitted();
    },
    click: async () => void log.push(`click ${sel}${filter}`),
    fill: async (v) => void log.push(`fill ${sel}${filter} ${v}`),
    pressSequentially: async (t) => {
      log.push(`pressSequentially ${sel}${filter} ${t}`);
      if (sel === '#code') submitted();
    },
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

/**
 * Shared fake clock + mailbox + browser address; every `deps()` built from the same harness shares the run folder.
 * After the login is sent the app navigates to `app.after`, `app.delayMs` later (0: at once).
 */
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
  const origin = 'https://app.example.test';
  const app = { url: `${origin}/`, after: `${origin}/discover`, delayMs: 0, leaveAt: Infinity };
  const submitted = () => {
    app.leaveAt = t + app.delayMs;
  };
  const currentUrl = () => (t >= app.leaveAt ? app.after : app.url);
  const page = (log: string[] = []) => fakePage(log, submitted);
  const deps = (over: Partial<SignInDeps> = {}): SignInDeps => ({
    goto: async (path) => {
      app.url = `${origin}${path}`;
      app.leaveAt = Infinity; // a new visit to the login page: nothing sent yet
    },
    currentUrl,
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
  return { deps, clock, sends, snapshots, runDir, app, origin, page, currentUrl };
}

/** A page whose send button records the clock time of every code request. */
function sendingPage(h: ReturnType<typeof harness>) {
  const fp = h.page();
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
    const h = harness();
    const { page, log } = h.page();
    await signIn(page, quickAccount, h.deps());
    expect(log).toEqual([
      'tap [data-test=quick-toggle]',
      'tap [data-test=quick-entry][hasText=qa+a@example.test]:first',
    ]);
  });

  test('uses pressSequentially, never keyboard.type', async () => {
    const h = harness();
    const { page, log } = h.page();
    await signIn(page, codeAccount, h.deps());
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
    const { page, log } = h.page();
    const err = await signIn(page, codeAccount, h.deps({ mailbox: 'demo' })).catch((e) => e);
    expect(err).toBeInstanceOf(NichtPruefbarHier);
    expect(String(err.message)).toContain('nicht prüfbar hier');
    expect(log).toEqual([]);
    expect(h.snapshots).toEqual([]);
    expect(readdirSync(h.runDir)).toEqual([]);
  });

  test('demo mailbox does not affect a quick login', async () => {
    const h = harness();
    const { page, log } = h.page();
    await signIn(page, quickAccount, h.deps({ mailbox: 'demo' }));
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
    const err = await signIn(h.page().page, codeAccount, deps).catch((e) => e);
    expect(err).not.toBeInstanceOf(NichtPruefbarHier);
    expect(String(err.message)).toContain('Kein Login-Code');
  });
});

describe('signIn waits until the login is finished', () => {
  const where = (h: ReturnType<typeof harness>) => new URL(h.currentUrl()).pathname;

  test('quick login: returns only after the app has left the login page', async () => {
    const h = harness();
    h.app.delayMs = 2_000;
    const t0 = h.clock.now();
    await signIn(h.page().page, quickAccount, h.deps());
    expect(where(h)).toBe('/discover');
    expect(h.clock.now() - t0).toBeGreaterThanOrEqual(2_000);
  });

  test('code login: returns only after the app has left the login page', async () => {
    const h = harness();
    h.app.delayMs = 3_000;
    await signIn(h.page().page, codeAccount, h.deps());
    expect(where(h)).toBe('/discover');
  });

  test('a login that takes 19 s still counts', async () => {
    const h = harness();
    h.app.delayMs = 19_000;
    await signIn(h.page().page, quickAccount, h.deps());
    expect(where(h)).toBe('/discover');
  });

  test('still on the login page after 20 s: a German error, bounded', async () => {
    const h = harness();
    h.app.delayMs = Infinity;
    const t0 = h.clock.now();
    const err = await signIn(h.page().page, quickAccount, h.deps()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NichtPruefbarHier);
    expect(String(err.message)).toBe(
      'Anmeldung nicht abgeschlossen: Die Seite steht nach 20 s noch auf /login.',
    );
    expect(h.clock.now() - t0).toBeGreaterThanOrEqual(20_000);
    expect(h.clock.now() - t0).toBeLessThan(21_000);
  });

  test('a code login that never leaves the login page fails the same way', async () => {
    const h = harness();
    h.app.delayMs = Infinity;
    const err = await signIn(h.page().page, codeAccount, h.deps()).catch((e) => e);
    expect(String(err.message)).toContain('Anmeldung nicht abgeschlossen');
  });

  test('the login page with a return_to query, a trailing slash or a sub-step still counts as the login page', async () => {
    for (const after of ['/login?return_to=%2Fdiscover', '/login/', '/login/code']) {
      const h = harness();
      h.app.after = `${h.origin}${after}`;
      const err = await signIn(h.page().page, quickAccount, h.deps()).catch((e) => e);
      expect(String(err?.message)).toContain('Anmeldung nicht abgeschlossen');
    }
  });

  test('a page whose path only starts like the login path counts as left', async () => {
    const h = harness();
    h.app.after = `${h.origin}/login-done`;
    await signIn(h.page().page, quickAccount, h.deps());
    expect(where(h)).toBe('/login-done');
  });

  test('the configured login path is the one waited on', async () => {
    const h = harness();
    h.app.after = `${h.origin}/anmelden`;
    const err = await signIn(h.page().page, quickAccount, h.deps({ loginPath: '/anmelden' })).catch(
      (e) => e,
    );
    expect(String(err?.message)).toBe(
      'Anmeldung nicht abgeschlossen: Die Seite steht nach 20 s noch auf /anmelden.',
    );
  });

  test('a configured login path with a trailing slash matches the page without it', async () => {
    const h = harness();
    h.app.after = `${h.origin}/login`;
    const err = await signIn(h.page().page, quickAccount, h.deps({ loginPath: '/login/' })).catch(
      (e) => e,
    );
    expect(String(err?.message)).toContain('Anmeldung nicht abgeschlossen');
  });

  test('login path / : only the start page counts as the login page', async () => {
    const h = harness();
    h.app.delayMs = 1_000;
    await signIn(h.page().page, quickAccount, h.deps({ loginPath: '/' }));
    expect(where(h)).toBe('/discover');
  });

  test('a read of the address that fails mid-navigation is tried again', async () => {
    const h = harness();
    h.app.delayMs = 1_000;
    let failures = 0;
    const deps = h.deps({
      currentUrl: async () => {
        if (failures++ < 2) throw new Error('Execution context was destroyed');
        return h.currentUrl();
      },
    });
    await signIn(h.page().page, quickAccount, deps);
    expect(failures).toBeGreaterThan(2);
    expect(where(h)).toBe('/discover');
  });

  test('a second sign-in waits again, after its own tap', async () => {
    const h = harness();
    await signIn(h.page().page, quickAccount, h.deps());
    h.app.delayMs = 5_000;
    const t0 = h.clock.now();
    await signIn(h.page().page, quickAccount, h.deps());
    expect(h.clock.now() - t0).toBeGreaterThanOrEqual(5_000);
  });
});
