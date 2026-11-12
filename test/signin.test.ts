import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestAccount } from '../src/config.js';
import {
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
function fakePage() {
  const log: string[] = [];
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

function deps(over: Partial<SignInDeps> = {}) {
  let t = Date.parse('2026-11-12T10:00:00.000Z');
  const gotos: string[] = [];
  const codeRequests: Array<{ email: string; since: number }> = [];
  const d: SignInDeps = {
    goto: async (path) => void gotos.push(path),
    loginPath: '/login',
    selectors: {
      quickToggle: '[data-test=quick-toggle]',
      quickEntry: '[data-test=quick-entry]',
      email: '#email',
      send: '[data-test=send-code]',
      code: '#code',
    },
    runDir: mkdtempSync(join(tmpdir(), 'sdc-signin-')),
    now: () => t,
    sleep: async (ms) => void (t += ms),
    readCode: async (email, since) => {
      codeRequests.push({ email, since: since.getTime() });
      return '482913';
    },
    ...over,
  };
  return {
    d,
    gotos,
    codeRequests,
    clock: {
      get now() {
        return t;
      },
      advance: (ms: number) => void (t += ms),
    },
  };
}

describe('signIn', () => {
  test('quick login taps the entry that contains the address', async () => {
    const { page, log } = fakePage();
    const { d, gotos } = deps();
    await signIn(page, quickAccount, d);
    expect(gotos).toEqual(['/login']);
    expect(log).toEqual([
      'tap [data-test=quick-toggle]',
      'tap [data-test=quick-entry][hasText=qa+a@example.test]:first',
    ]);
  });

  test('uses pressSequentially, never keyboard.type', async () => {
    const { page, log } = fakePage();
    const { d, codeRequests } = deps();
    await signIn(page, codeAccount, d);
    expect(log).toEqual([
      'fill #email qa+b@example.test',
      'tap [data-test=send-code]',
      'pressSequentially #code 482913',
    ]);
    expect(codeRequests).toHaveLength(1);
  });

  test('the code is read only from mail after the request', async () => {
    const { page } = fakePage();
    const { d, codeRequests, clock } = deps();
    const before = clock.now;
    await signIn(page, codeAccount, d);
    expect(codeRequests[0].since).toBeGreaterThanOrEqual(before);
  });

  test('waits on the resend limit (fake clock)', async () => {
    const shared = deps();
    await signIn(fakePage().page, codeAccount, shared.d);
    shared.clock.advance(20_000); // a second request 20 s later
    const t0 = shared.clock.now;
    await signIn(fakePage().page, codeAccount, shared.d);
    expect(shared.clock.now - t0).toBeGreaterThanOrEqual(40_000);
    expect(shared.codeRequests[1].since - shared.codeRequests[0].since).toBeGreaterThanOrEqual(
      60_000,
    );
  });

  test('refuses a sixth code within the hour', async () => {
    const shared = deps();
    for (let i = 0; i < 5; i++) {
      await signIn(fakePage().page, codeAccount, shared.d);
      shared.clock.advance(61_000);
    }
    await expect(signIn(fakePage().page, codeAccount, shared.d)).rejects.toThrow('5 Codes');
  });
});
