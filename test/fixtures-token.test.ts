import { describe, expect, test } from 'bun:test';
import {
  classifyLanding,
  UmgebungNichtGestartet,
  withStaging,
  type StagingDeps,
} from '../plugins/staging-device-check/workspace/harness/staging.js';

const HOST = 'd-acme-de--main.dating.staging.example.test';
const token = {
  name: 'staging_gate_run',
  value: 'invented-token-value',
  host: HOST,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
  expiry: 1_800_000_000,
  bootstrapUrl: `https://${HOST}/health`,
};

type Landing = { url: string; status: number | null; title: string; text: string };

/** Fake page/context recording the order of events. */
function fakes(opts: { cookies?: Array<{ name: string }>; landing?: Landing } = {}) {
  const events: string[] = [];
  const added: unknown[] = [];
  const cleared: unknown[] = [];
  let cookies = opts.cookies ?? [];
  const landing = opts.landing ?? {
    url: `https://${HOST}/`,
    status: 200,
    title: 'App',
    text: 'Willkommen',
  };
  const deps: StagingDeps = {
    host: HOST,
    page: {
      goto: async (url: string) => {
        events.push(`goto ${url}`);
      },
      landing: async () => landing,
    },
    context: {
      cookies: async () => cookies,
      addCookies: async (cs) => {
        events.push('addCookies');
        added.push(...cs);
        cookies = [...cookies, ...cs.map((c) => ({ name: c.name }))];
      },
      clearCookies: async (filter) => {
        events.push('clearCookies');
        cleared.push(filter);
      },
    },
    mint: async (host) => {
      events.push(`mint ${host}`);
      return { ...token };
    },
  };
  return { deps, events, added, cleared };
}

describe('withStaging', () => {
  test('mints one token per test, after the page exists', async () => {
    for (let run = 0; run < 2; run++) {
      const { deps, events } = fakes();
      await withStaging(deps, async (s) => {
        expect(s.host).toBe(HOST);
      });
      expect(events.filter((e) => e.startsWith('mint'))).toEqual([`mint ${HOST}`]);
      // the page exists (it is a dependency); nothing was navigated before the mint
      expect(events[0]).toBe(`mint ${HOST}`);
      expect(events.slice(1, 4)).toEqual([
        `goto ${token.bootstrapUrl}`,
        'addCookies',
        `goto https://${HOST}/`,
      ]);
    }
  });

  test('adds the cookie host-only (url, no domain)', async () => {
    const { deps, added } = fakes();
    await withStaging(deps, async () => {});
    expect(added).toEqual([
      {
        name: 'staging_gate_run',
        value: 'invented-token-value',
        url: `https://${HOST}`,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        expires: 1_800_000_000,
      },
    ]);
    expect(added[0]).not.toHaveProperty('domain');
  });

  test('refuses a staging_gate cookie in the context', async () => {
    const { deps, events } = fakes({ cookies: [{ name: 'staging_gate' }] });
    await expect(withStaging(deps, async () => {})).rejects.toThrow('staging_gate');
    expect(events.some((e) => e.startsWith('mint'))).toBe(false);
  });

  test('stops the run when the host lands on provisioning', async () => {
    const { deps } = fakes({
      landing: {
        url: `https://${HOST}/provisioning`,
        status: 200,
        title: 'Provisioning',
        text: '',
      },
    });
    const err = await withStaging(deps, async () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(UmgebungNichtGestartet);
    expect(String(err.message)).toContain('Umgebung nicht gestartet');
    expect(String(err.message)).toContain(HOST);
  });

  test('deletes the token in teardown even when the test fails', async () => {
    const { deps, events, cleared } = fakes();
    await expect(
      withStaging(deps, async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
    expect(events.at(-1)).toBe('clearCookies');
    expect(cleared).toEqual([{ name: 'staging_gate_run' }]);
  });

  test('the gate login page means the token was not accepted', async () => {
    const { deps } = fakes({
      landing: {
        url: `https://${HOST}/_gate/login?return_to=%2F`,
        status: 200,
        title: 'Gate',
        text: '',
      },
    });
    await expect(withStaging(deps, async () => {})).rejects.toThrow('nicht angenommen');
  });
});

describe('classifyLanding', () => {
  test('ok, gate, provisioning, 404', () => {
    const base = { url: `https://${HOST}/`, status: 200, title: 'App', text: '' };
    expect(classifyLanding(base, HOST)).toBe('ok');
    expect(classifyLanding({ ...base, url: `https://${HOST}/_gate/login` }, HOST)).toBe('gate');
    expect(classifyLanding({ ...base, status: 404 }, HOST)).toBe('provisioning');
    expect(classifyLanding({ ...base, text: 'Environment is being provisioned' }, HOST)).toBe(
      'provisioning',
    );
    expect(classifyLanding({ ...base, url: 'https://staging.example.test/' }, HOST)).toBe(
      'provisioning',
    );
  });
});
