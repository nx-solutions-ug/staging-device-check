import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

  test('the consent label: the settings win over the spec option', () => {
    expect(fixture('consent', 'staging')).toContain(
      "consentButtonFor(loadConfig(), need('SDC_HOST'), consentButton)",
    );
  });
});
