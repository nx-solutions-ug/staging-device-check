import { afterEach, describe, expect, test } from 'bun:test';
import {
  ADDRESS_READ_MS,
  addressInPage,
  pathInPage,
  type AddressPage,
} from '../plugins/staging-device-check/workspace/harness/address.js';

/**
 * A page as a real iPhone showed it: Playwright's `url()` stays on the address of the last full load, while the app
 * has moved on with `history.pushState`. `evaluate` runs the function against `inPage` as the page's `location`.
 */
function devicePage(inPage: { href: string | null }, stale = 'https://app.example.test/login') {
  const calls: { fn: () => unknown; args: number }[] = [];
  const page: AddressPage & { url(): string } = {
    url: () => stale,
    evaluate: async function (fn: () => unknown) {
      calls.push({ fn, args: arguments.length });
      return runWithLocation(inPage.href, fn);
    },
  };
  return { page, calls };
}

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
function runWithLocation(href: string | null, fn: () => unknown) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: href === null ? undefined : new URL(href),
  });
  try {
    return fn();
  } finally {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
    else delete (globalThis as { location?: unknown }).location;
  }
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => void unhandled.push(e);
process.on('unhandledRejection', onUnhandled);
afterEach(() => {
  unhandled.length = 0;
});

describe('addressInPage', () => {
  test('reads location.href in the page, not the address Playwright remembers', async () => {
    const { page } = devicePage({ href: 'https://app.example.test/dashboard' });
    expect(page.url()).toBe('https://app.example.test/login');
    expect(await addressInPage(page)).toBe('https://app.example.test/dashboard');
  });

  test('the page gets one function without parameters (the iPhone drops evaluate arguments)', async () => {
    const { page, calls } = devicePage({ href: 'https://app.example.test/dashboard' });
    await addressInPage(page);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toBe(1);
    expect(typeof calls[0].fn).toBe('function');
    expect(calls[0].fn.length).toBe(0);
  });

  test('a read that fails mid-navigation fails, it never falls back to the stale address', async () => {
    let urlRead = false;
    const page: AddressPage & { url(): string } = {
      url: () => {
        urlRead = true;
        return 'https://app.example.test/login';
      },
      evaluate: async () => {
        throw new Error('Execution context was destroyed, most likely because of a navigation');
      },
    };
    expect(await addressInPage(page).catch((e: Error) => e.message)).toContain(
      'Execution context was destroyed',
    );
    expect(urlRead).toBe(false);
  });

  test('a read that hangs gives up after the bound; its late answer is ignored', async () => {
    let late: (v: unknown) => void = () => {};
    let lateFail: (e: unknown) => void = () => {};
    const page: AddressPage = {
      evaluate: () =>
        new Promise((resolve, reject) => {
          late = resolve;
          lateFail = reject;
        }),
    };
    const t0 = Date.now();
    const err = await addressInPage(page, 20).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('20 ms');
    expect(Date.now() - t0).toBeLessThan(1_000);
    late('https://app.example.test/dashboard');
    lateFail(new Error('too late'));
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toHaveLength(0);
  });

  test('without a bound of its own, a hung read gives up after about a second', async () => {
    expect(ADDRESS_READ_MS).toBe(1_000);
    const page: AddressPage = { evaluate: () => new Promise(() => {}) };
    const t0 = Date.now();
    expect(await addressInPage(page).catch((e: Error) => e.message)).toContain('1000 ms');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(Date.now() - t0).toBeLessThan(2_500);
  });

  test('a hung read that rejects after the bound causes no unhandled rejection', async () => {
    let lateFail: (e: unknown) => void = () => {};
    const page: AddressPage = {
      evaluate: () =>
        new Promise((_resolve, reject) => {
          lateFail = reject;
        }),
    };
    await addressInPage(page, 5).catch(() => undefined);
    lateFail(new Error('Target closed'));
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toHaveLength(0);
  });

  test('the bound is cleared once the page has answered (no timer left behind per poll)', async () => {
    const { page } = devicePage({ href: 'https://app.example.test/dashboard' });
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const set: unknown[] = [];
    const cleared: unknown[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const id = realSet(fn, ms);
      set.push(id);
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
      cleared.push(id);
      realClear(id);
    }) as typeof clearTimeout;
    try {
      await addressInPage(page);
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
    expect(set).toHaveLength(1);
    expect(cleared).toEqual(set);
  });

  test('an answer that is no address counts as a failed read', async () => {
    for (const answer of [undefined, null, 42, '', 'not a url']) {
      const page: AddressPage = { evaluate: async () => answer };
      expect(await addressInPage(page).catch(() => 'failed')).toBe('failed');
    }
  });
});

describe('pathInPage (for specs, inside expect.poll)', () => {
  test('the path the page itself is on', async () => {
    const { page } = devicePage({ href: 'https://app.example.test/dashboard?tab=2' });
    expect(await pathInPage(page)).toBe('/dashboard');
  });

  test('null while the page cannot answer, so the poll goes on instead of failing at once', async () => {
    const failing: AddressPage = {
      evaluate: async () => {
        throw new Error('Execution context was destroyed');
      },
    };
    expect(await pathInPage(failing)).toBeNull();
    const hanging: AddressPage = { evaluate: () => new Promise(() => {}) };
    expect(await pathInPage(hanging, 5)).toBeNull();
  });
});
