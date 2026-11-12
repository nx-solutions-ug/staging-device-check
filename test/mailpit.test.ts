import { describe, expect, test } from 'bun:test';
import { latestLoginCode } from '../src/mailpit.js';

const APEX = 'https://staging.example.test';
const EMAIL = 'qa+b@example.test';
const COOKIE = 'invented-gate-cookie';
const SINCE = new Date('2026-11-12T10:00:00.000Z');

type Mail = { ID: string; Created: string; Text: string };

/** Fake Mailpit: `search` returns summaries, `message/<ID>` the body. `inbox()` can change between polls. */
function mailpit(inbox: () => Mail[]) {
  const urls: string[] = [];
  const cookies: Array<string | null> = [];
  const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    urls.push(u);
    cookies.push(new Headers(init.headers).get('cookie'));
    if (u.includes('/api/v1/search')) {
      return Response.json({
        messages: inbox().map(({ ID, Created }) => ({ ID, Created })),
        total: inbox().length,
      });
    }
    const id = decodeURIComponent(u.split('/api/v1/message/')[1] ?? '');
    const m = inbox().find((x) => x.ID === id);
    return m
      ? Response.json({ ID: m.ID, Text: m.Text, HTML: '' })
      : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, urls, cookies };
}

/** A fake clock: sleep advances it instead of waiting. */
function clock(start = SINCE.getTime()) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('latestLoginCode', () => {
  test('ignores mail older than the request', async () => {
    const { fetchFn, urls, cookies } = mailpit(() => [
      { ID: 'old', Created: '2026-11-12T09:59:59.000Z', Text: 'Dein Code: 111111' },
      { ID: 'new', Created: '2026-11-12T10:00:05.000Z', Text: 'Dein Code: 222222' },
    ]);
    const c = clock();
    expect(
      await latestLoginCode(APEX, COOKIE, EMAIL, SINCE, fetchFn, c.sleep, { now: c.now }),
    ).toBe('222222');
    expect(urls[0]).toBe(
      `${APEX}/mailpit/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}&limit=20`,
    );
    expect(urls[1]).toBe(`${APEX}/mailpit/api/v1/message/new`);
    expect(cookies.every((c) => c === `staging_gate=${COOKIE}`)).toBe(true);
  });

  test('extracts the code with the default pattern', async () => {
    const { fetchFn } = mailpit(() => [
      {
        ID: 'm',
        Created: '2026-11-12T10:00:01.000Z',
        Text: 'Hallo!\nDein Login-Code lautet 482913. Er gilt 10 Minuten.\nNr. 12',
      },
    ]);
    const c = clock();
    expect(
      await latestLoginCode(APEX, COOKIE, EMAIL, SINCE, fetchFn, c.sleep, { now: c.now }),
    ).toBe('482913');
  });

  test('a custom pattern from the skill wins', async () => {
    const { fetchFn } = mailpit(() => [
      { ID: 'm', Created: '2026-11-12T10:00:01.000Z', Text: 'Code: AB-12CD' },
    ]);
    const c = clock();
    const code = await latestLoginCode(APEX, COOKIE, EMAIL, SINCE, fetchFn, c.sleep, {
      now: c.now,
      pattern: /[A-Z]{2}-\d{2}[A-Z]{2}/,
    });
    expect(code).toBe('AB-12CD');
  });

  test('polls until the mail arrives', async () => {
    const c = clock();
    const arrivesAt = SINCE.getTime() + 7000;
    const { fetchFn } = mailpit(() =>
      c.now() >= arrivesAt
        ? [{ ID: 'm', Created: '2026-11-12T10:00:07.000Z', Text: 'Code 654321' }]
        : [],
    );
    expect(
      await latestLoginCode(APEX, COOKIE, EMAIL, SINCE, fetchFn, c.sleep, { now: c.now }),
    ).toBe('654321');
    expect(c.now()).toBeGreaterThanOrEqual(arrivesAt);
  });

  test('times out after 60 s with a German message', async () => {
    const c = clock();
    const { fetchFn } = mailpit(() => [
      { ID: 'old', Created: '2026-11-12T09:00:00.000Z', Text: 'Code 111111' },
    ]);
    const err = await latestLoginCode(APEX, COOKIE, EMAIL, SINCE, fetchFn, c.sleep, {
      now: c.now,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/Kein Login-Code.*60 s/);
    expect(c.now() - SINCE.getTime()).toBeGreaterThanOrEqual(60_000);
    expect(c.now() - SINCE.getTime()).toBeLessThan(70_000);
    expect(String(err.message)).not.toContain(COOKIE);
  });
});
