import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The fixtures need a browser, which CI does not install: these guards read their source, as check.test.ts does.
const src = readFileSync(
  join(
    import.meta.dir,
    '..',
    'plugins',
    'staging-device-check',
    'workspace',
    'harness',
    'fixtures.ts',
  ),
  'utf8',
);
const fixture = (name: string, next: string) =>
  src.slice(src.indexOf(`  ${name}: async`), src.indexOf(`  ${next}: async`));

describe('the helpers are wired into the fixtures', () => {
  test('layout(): looks for the banner, waits for rest before each measurement, never passes a page not at rest', () => {
    const layout = src.slice(
      src.indexOf('  layout: async'),
      src.indexOf('});', src.indexOf('  layout: async')),
    );
    expect(layout.indexOf('consent.look()')).toBeGreaterThan(-1);
    expect(layout.indexOf('consent.look()')).toBeLessThan(layout.indexOf('measure('));
    expect(layout.match(/await atRest\(page, opts\)/g)).toHaveLength(2);
    // every rule result goes through unsettled(), except the iOS keyboard phase (never measured anyway)
    expect(layout.match(/evaluateRules\(/g)?.length).toBe(
      (layout.match(/unsettled\(/g)?.length ?? 0) + 1,
    );
  });

  test('shot(): looks for the banner before the screenshot', () => {
    const shot = fixture('shot', 'appCookie');
    expect(shot.indexOf('consent.look()')).toBeGreaterThan(-1);
    expect(shot.indexOf('consent.look()')).toBeLessThan(shot.indexOf('page.screenshot('));
  });

  test('staging.goto: every navigation is followed by the banner check', () => {
    const staging = fixture('staging', 'account');
    expect(staging).toMatch(/await s\.goto\(path\);\s*await consent\.afterGoto\(\);/);
  });

  test('tap and typeInto go through the tested logic', () => {
    expect(fixture('tap', 'typeInto')).toContain('tapSafely(');
    expect(fixture('tap', 'typeInto')).toContain('consent: () => consent.look()');
    const typeInto = fixture('typeInto', 'layout');
    expect(typeInto).toContain('typeSafely(');
    expect(typeInto).toContain('tap(field, { keepKeyboard: true })');
    expect(fixture('closeKeyboard', 'tap')).toContain('closeKeyboard(');
  });

  test('account(): signIn reads the address in the page (page.url() lags behind in-app navigation on iOS)', () => {
    const account = fixture('account', 'shot');
    expect(account).toContain('await signIn(page, account, {');
    expect(account).toContain('currentUrl: () => addressInPage(page),');
    expect(account).not.toContain('page.url()');
  });

  test('staging: the landing check reads the address in the page; page.url() only when the page cannot answer', () => {
    const staging = fixture('staging', 'account');
    expect(staging).toContain('url: await addressInPage(page).catch(() => page.url()),');
  });

  test('pathInPage is offered to specs', () => {
    expect(src).toContain("export { addressInPage, pathInPage } from './address.js';");
  });

  test('the consent label: the settings win over the spec option', () => {
    expect(fixture('consent', 'staging')).toContain(
      "consentButtonFor(loadConfig(), need('SDC_HOST'), consentButton)",
    );
  });
});

// Playwright's own address (page.url(), toHaveURL, waitForURL) does not follow history.pushState on a real iPhone
// (iOS 27, Safari): no harness helper may wait on it. The one read left is the landing fallback above.
describe("no harness helper reads Playwright's own address", () => {
  const dir = join(
    import.meta.dir,
    '..',
    'plugins',
    'staging-device-check',
    'workspace',
    'harness',
  );
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    // code only: the comments explain why page.url() is not used
    .map((f) => ({
      f,
      text: readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    }));

  test('url() appears only as the landing fallback in fixtures.ts', () => {
    const hits = sources.flatMap(({ f, text }) =>
      text
        .split('\n')
        .filter((line) => /\.url\(\)/.test(line))
        .map((line) => `${f}: ${line.trim()}`),
    );
    expect(hits).toEqual(['fixtures.ts: url: await addressInPage(page).catch(() => page.url()),']);
  });

  test('no toHaveURL or waitForURL', () => {
    for (const { f, text } of sources)
      expect(`${f}: ${/toHaveURL|waitForURL/.test(text)}`).toBe(`${f}: false`);
  });
});
