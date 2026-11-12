import { describe, expect, test } from 'bun:test';
import { GateError, gateLogin, mintRunToken, type GateErrorKind } from '../src/gate.js';

const APEX = 'https://staging.example.test';
const HOST = 'd-acme-de--main.dating.staging.example.test';
const PASSWORD = 'invented gate pass&word=1';

type Seen = { url: string; init: RequestInit };

function mockFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const seen = { url: String(url), init };
    calls.push(seen);
    return respond(seen);
  }) as typeof fetch;
  return { fn, calls };
}

const tokenBody = (over: Record<string, unknown> = {}) => ({
  name: 'staging_gate_run',
  value: 'invented-token-value',
  host: HOST,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
  expiry: 1_800_000_000,
  bootstrapPath: '/health',
  ...over,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GateError);
    return { kind: (e as GateError).kind, message: (e as GateError).message };
  }
  throw new Error('expected a GateError');
};

describe('mintRunToken', () => {
  test('200 maps to a RunToken with bootstrapUrl https://<host>/health', async () => {
    const { fn, calls } = mockFetch(() => json(200, tokenBody()));
    const t = await mintRunToken(APEX, HOST, 20, PASSWORD, fn);
    expect(t).toEqual({
      name: 'staging_gate_run',
      value: 'invented-token-value',
      host: HOST,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expiry: 1_800_000_000,
      bootstrapUrl: `https://${HOST}/health`,
    });
    expect(calls[0].url).toBe(`${APEX}/_gate/run-token`);
    expect(calls[0].init.method).toBe('POST');
  });

  test('mintRunToken sends the password only in the body', async () => {
    const { fn, calls } = mockFetch(() => json(200, tokenBody()));
    await mintRunToken(`${APEX}/`, HOST, 20, PASSWORD, fn);
    const { url, init } = calls[0];
    expect(url).toBe(`${APEX}/_gate/run-token`);
    expect(url).not.toContain(encodeURIComponent(PASSWORD));
    expect(JSON.stringify(init.headers ?? {})).not.toContain('pass');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('password')).toBe(PASSWORD);
    expect(body.get('host')).toBe(HOST);
    expect(body.get('minutes')).toBe('20');
    expect(String(init.body)).not.toContain(PASSWORD); // form-encoded, not raw
  });

  test.each([
    [401, { error: 'Wrong password.' }, 'wrong-password'],
    [
      400,
      {
        error:
          'host must be one Dating host <label>.dating.<apex> without a port, minutes 1 to 120.',
      },
      'bad-host',
    ],
    [404, { error: 'not found' }, 'not-deployed'],
    [429, { error: 'Too many attempts.' }, 'throttled'],
  ])('%i maps to its kind', async (status, body, kind) => {
    const { fn } = mockFetch(() => json(status, body));
    const e = await kindOf(mintRunToken(APEX, HOST, 20, PASSWORD, fn));
    expect(e.kind).toBe(kind as GateErrorKind);
    expect(e.message).not.toContain(PASSWORD);
  });

  test('the 400 message is German and carries the server reason', async () => {
    const { fn } = mockFetch(() => json(400, { error: 'host must be one Dating host' }));
    const e = await kindOf(mintRunToken(APEX, HOST, 20, PASSWORD, fn));
    expect(e.message).toContain(HOST);
    expect(e.message).toContain('host must be one Dating host');
    expect(e.message).toMatch(/Staging-Server/);
  });

  test('a network failure is unreachable', async () => {
    const { fn } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const e = await kindOf(mintRunToken(APEX, HOST, 20, PASSWORD, fn));
    expect(e.kind).toBe('unreachable');
    expect(e.message).toContain('staging.example.test');
  });

  test('a token for another host is refused', async () => {
    const { fn } = mockFetch(() =>
      json(200, tokenBody({ host: 'd-other--main.dating.staging.example.test' })),
    );
    expect((await kindOf(mintRunToken(APEX, HOST, 20, PASSWORD, fn))).kind).toBe('bad-host');
  });

  test('minutes outside 1..120 are refused before any request', async () => {
    const { fn, calls } = mockFetch(() => json(200, tokenBody()));
    for (const m of [0, 121, 2.5])
      await expect(mintRunToken(APEX, HOST, m, PASSWORD, fn)).rejects.toThrow('1');
    expect(calls).toHaveLength(0);
  });
});

describe('apex validation', () => {
  test('a non-https apex is a German error, not a raw TypeError', async () => {
    const { fn, calls } = mockFetch(() => json(200, tokenBody()));
    for (const apex of ['staging.example.test', 'http://staging.example.test']) {
      const e = await kindOf(mintRunToken(apex, HOST, 20, PASSWORD, fn));
      expect(e.message).toMatch(/https/);
      const g = await kindOf(gateLogin(apex, PASSWORD, fn));
      expect(g.message).toMatch(/https/);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('gateLogin', () => {
  const setCookie =
    'staging_gate=invented-gate-cookie; expires=Thu, 19 Nov 2026 10:00:00 GMT; Max-Age=604800; path=/; domain=.staging.example.test; secure; httponly; samesite=lax';

  test('302 with Set-Cookie gives the staging_gate cookie', async () => {
    const { fn, calls } = mockFetch(
      () =>
        new Response(null, { status: 302, headers: { location: '/', 'set-cookie': setCookie } }),
    );
    const before = Math.floor(Date.now() / 1000);
    const c = await gateLogin(APEX, PASSWORD, fn);
    expect(c.name).toBe('staging_gate');
    expect(c.value).toBe('invented-gate-cookie');
    expect(c.domain).toBe('.staging.example.test');
    expect(c.expires).toBeGreaterThanOrEqual(before + 604800);
    expect(c.expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 604800);
    expect(calls[0].url).toBe(`${APEX}/_gate/login`);
    expect(calls[0].init.redirect).toBe('manual');
    expect(new URLSearchParams(String(calls[0].init.body)).get('password')).toBe(PASSWORD);
  });

  test('a Domain attribute without a leading dot still opens the subdomains (storage-state form)', async () => {
    // RFC 6265 ignores a leading dot, so servers send `domain=apex`; Playwright's storage state reads a domain
    // without the dot as host-only, and the app hosts below the apex would never see the cookie
    const { fn } = mockFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: '/', 'set-cookie': setCookie.replace('domain=.', 'domain=') },
        }),
    );
    expect((await gateLogin(APEX, PASSWORD, fn)).domain).toBe('.staging.example.test');
  });

  test('401 is a wrong password', async () => {
    const { fn } = mockFetch(() => new Response('<html>', { status: 401 }));
    expect((await kindOf(gateLogin(APEX, PASSWORD, fn))).kind).toBe('wrong-password');
  });

  test('400 and 404 at the gate login have their own German texts', async () => {
    const r400 = mockFetch(() => new Response('', { status: 400 }));
    const e400 = await kindOf(gateLogin(APEX, PASSWORD, r400.fn));
    expect(e400.message).toMatch(/Gate-Login/);
    expect(e400.message).not.toContain('null');
    const r404 = mockFetch(() => new Response('', { status: 404 }));
    const e404 = await kindOf(gateLogin(APEX, PASSWORD, r404.fn));
    expect(e404.message).toMatch(/Gate-Login/);
    expect(e404.message).not.toMatch(/Run-Token/);
  });

  test('a response without the cookie is an error', async () => {
    const { fn } = mockFetch(() => new Response(null, { status: 302, headers: { location: '/' } }));
    await expect(gateLogin(APEX, PASSWORD, fn)).rejects.toBeInstanceOf(GateError);
  });
});
