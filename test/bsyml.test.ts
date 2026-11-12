import { describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkYml, usedMinutes } from '../src/bsyml.js';

const FAKE_USER = 'fake-user-0001';
const FAKE_KEY = 'fakeAccessKey000000000';
const NO_ENV = {} as NodeJS.ProcessEnv;

/** Copies a fixture out of the git working tree, mode 600, so only the warnings under test appear. */
function fixture(name: string, mode = 0o600): string {
  const p = join(mkdtempSync(join(tmpdir(), 'sdc-yml-')), 'browserstack.yml');
  cpSync(new URL(`./fixtures/yml/${name}`, import.meta.url).pathname, p);
  chmodSync(p, mode);
  return p;
}

describe('checkYml', () => {
  test('accepts the sample (iPhone 16/18 safari + Galaxy S23/13 chrome)', () => {
    const r = checkYml(fixture('sample.yml'), NO_ENV);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.mobilePlatforms).toEqual([
      { deviceName: 'iPhone 16', osVersion: '18', browserName: 'safari' },
      { deviceName: 'Samsung Galaxy S23', osVersion: '13.0', browserName: 'chrome' },
    ]);
  });

  test('rejects yml without a mobile platform', () => {
    const r = checkYml(fixture('no-mobile.yml'), NO_ENV);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/deviceName/);
  });

  test('rejects browserstackAutomation false', () => {
    const r = checkYml(fixture('automation-off.yml'), NO_ENV);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/browserstackAutomation/);
  });

  test('warns on browserstackLocal true', () => {
    const r = checkYml(fixture('local-true.yml'), NO_ENV);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/browserstackLocal/);
  });

  test('warns on iOS osVersion below 17, iOS logs and unusual browsers', () => {
    const r = checkYml(fixture('old-ios.yml'), NO_ENV);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/iPhone SE 2022.*15/);
    expect(w).toMatch(/consoleLogs/);
    expect(w).toMatch(/safari/);
    expect(w).toMatch(/chrome/);
  });

  test('rejects a missing file, another framework and missing credentials', () => {
    expect(checkYml('/nonexistent/browserstack.yml', NO_ENV).errors.join(' ')).toMatch(
      /nicht gefunden/,
    );
    const r = checkYml(fixture('no-credentials.yml'), NO_ENV);
    expect(r.ok).toBe(false);
    const e = r.errors.join('\n');
    expect(e).toMatch(/framework/);
    expect(e).toMatch(/userName/);
    expect(e).toMatch(/accessKey/);
  });

  test('credentials from the environment are enough', () => {
    const r = checkYml(fixture('no-credentials.yml'), {
      BROWSERSTACK_USERNAME: 'env-user-0001',
      BROWSERSTACK_ACCESS_KEY: 'fakeEnvAccessKey0000',
    });
    expect(r.errors.join(' ')).not.toMatch(/userName|accessKey/);
    expect(r.secretsForRedaction).toContain('fakeEnvAccessKey0000');
  });

  test('warns when the file is readable by others or sits in a git working tree', () => {
    expect(checkYml(fixture('sample.yml', 0o644), NO_ENV).warnings.join(' ')).toMatch(/600/);
    const inRepo = new URL('./fixtures/yml/sample.yml', import.meta.url).pathname;
    expect(checkYml(inRepo, NO_ENV).warnings.join(' ')).toMatch(/Git/);
  });

  test('never exposes credentials outside secretsForRedaction', () => {
    for (const name of [
      'sample.yml',
      'no-mobile.yml',
      'automation-off.yml',
      'local-true.yml',
      'old-ios.yml',
    ]) {
      const { secretsForRedaction, ...rest } = checkYml(fixture(name, 0o644), NO_ENV);
      const text = JSON.stringify(rest);
      expect(text).not.toContain(FAKE_USER);
      expect(text).not.toContain(FAKE_KEY);
      expect(secretsForRedaction).toContain(FAKE_USER);
      expect(secretsForRedaction).toContain(FAKE_KEY);
      expect(secretsForRedaction).toContain(`${FAKE_USER}:${FAKE_KEY}`);
    }
  });
});

describe('usedMinutes', () => {
  test('sums automation_session.duration (seconds) over every build and session page', async () => {
    const builds = Array.from({ length: 101 }, (_, i) => ({
      automation_build: { hashed_id: `b${i}` },
    }));
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = new URL(String(url));
      urls.push(u.pathname + u.search);
      expect(new Headers(init.headers).get('authorization')).toBe(
        `Basic ${Buffer.from(`${FAKE_USER}:${FAKE_KEY}`).toString('base64')}`,
      );
      const offset = Number(u.searchParams.get('offset') ?? 0);
      if (u.pathname === '/automate/builds.json')
        return Response.json(builds.slice(offset, offset + 100));
      // every build has one session of 60 s, b0 has 150 sessions of 2 s
      if (u.pathname === '/automate/builds/b0/sessions.json') {
        const all = Array.from({ length: 150 }, () => ({ automation_session: { duration: 2 } }));
        return Response.json(all.slice(offset, offset + 100));
      }
      return Response.json(offset === 0 ? [{ automation_session: { duration: 60 } }] : []);
    }) as typeof fetch;
    // 100 builds x 60 s + 150 x 2 s = 6300 s = 105 min
    expect(await usedMinutes(FAKE_USER, FAKE_KEY, fetchFn)).toBe(105);
    expect(urls[0]).toBe('/automate/builds.json?limit=100&offset=0');
    expect(urls).toContain('/automate/builds.json?limit=100&offset=100');
    expect(urls).toContain('/automate/builds/b0/sessions.json?limit=100&offset=100');
  });

  test('an API error is null, not zero', async () => {
    const r401 = (async () =>
      new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;
    expect(await usedMinutes(FAKE_USER, FAKE_KEY, r401)).toBeNull();
  });
});
