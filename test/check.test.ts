import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseResult, type RunCheck } from '../src/report.js';
import { specPlan } from '../src/spec-plan.js';

const ROOT = join(import.meta.dir, '..');
const IPHONE = 'safari-iPhone 16:18-browserstack-mobile';
const ANDROID = 'chrome-Samsung Galaxy S23:13.0-browserstack-mobile';

const SPEC = `
import { appendFileSync } from 'node:fs';
import { check, expect, test } from './harness/fixtures.js';

test('Konto A (frau)', async () => {
  await check('Kopf da', async () => {
    expect.soft(1).toBe(1);
  });
  await check('Weiter-Knopf über der Tastatur', async () => {
    appendFileSync('keyboard-ran.txt', test.info().project.name + '\\n');
  }, { keyboard: true });
  await check('Abstände wie im Entwurf', async ({ zuPruefen }) => {
    zuPruefen('/run/screenshots/ACME-1_x_01-wohnort.png');
  });
});

test('Konto B (mann)', async () => {
  await check('Eins', async () => {
    throw new Error('Knopf nicht gefunden');
  });
  await check('Zwei', async () => {});
  await check('Drei', async () => {});
});

test('Konto C (frau)', async () => {
  test.info().annotations.push({ type: 'zu prüfen', description: 'Gibt es nicht: ACME-1_y.png' });
  await check('Echt', async () => {});
});
`;

/** Runs the spec with real Playwright 1.62.1 (no browser needed) under two device project names. */
function run(): { checks: RunCheck[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sdc-check-'));
  symlinkSync(
    join(ROOT, 'plugins', 'staging-device-check', 'workspace', 'harness'),
    join(dir, 'harness'),
    'dir',
  );
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(
    join(dir, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1,
  reporter: [['json', { outputFile: 'result.json' }]],
  projects: [{ name: ${JSON.stringify(IPHONE)} }, { name: ${JSON.stringify(ANDROID)} }] });\n`,
  );
  writeFileSync(join(dir, 'tests-e2e.spec.ts'), SPEC);
  spawnSync(join(ROOT, 'node_modules', '.bin', 'playwright'), ['test'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const plan = {
    tests: specPlan(SPEC, 'tests-e2e.spec.ts').tests,
    devices: ['iPhone 16', 'Samsung Galaxy S23'],
  };
  const checks = parseResult(
    JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')),
    [],
    plan,
  ).checks;
  return { checks, dir };
}

describe('check() with real Playwright, read by report', () => {
  const { checks, dir } = run();
  const row = (title: string, device: string) =>
    checks.find((c) => c.title === title && c.device === device);

  test('a keyboard check is nicht prüfbar hier on iOS and runs on Android', () => {
    expect(row('Konto A (frau): Weiter-Knopf über der Tastatur', 'iPhone')?.outcome).toBe(
      'nicht prüfbar hier',
    );
    expect(row('Konto A (frau): Weiter-Knopf über der Tastatur', 'Android')?.outcome).toBe(
      'bestanden',
    );
    expect(readFileSync(join(dir, 'keyboard-ran.txt'), 'utf8').trim()).toBe(ANDROID);
    expect(row('Konto A (frau): Kopf da', 'iPhone')?.outcome).toBe('bestanden');
    expect(row('Konto A (frau): Abstände wie im Entwurf', 'iPhone')?.outcome).toBe(
      'zu prüfen (Bild)',
    );
    expect(row('Konto A (frau): Abstände wie im Entwurf', 'iPhone')?.note).toBe(
      'ACME-1_x_01-wohnort.png',
    );
  });

  test('after a hard failure in check 1, checks 2 and 3 are nicht gelaufen', () => {
    for (const device of ['iPhone', 'Android']) {
      expect(row('Konto B (mann): Eins', device)?.outcome).toBe('nicht bestanden');
      expect(row('Konto B (mann): Eins', device)?.note).toContain('Knopf nicht gefunden');
      for (const t of ['Zwei', 'Drei']) {
        expect(row(`Konto B (mann): ${t}`, device)).toMatchObject({
          outcome: 'nicht bestanden',
          note: 'nicht gelaufen',
        });
      }
    }
  });

  test('an annotation without a matching check is an Ablauf failure', () => {
    expect(row('Konto C (frau): Echt', 'Android')?.outcome).toBe('bestanden');
    expect(row('Konto C (frau): Ablauf', 'Android')?.outcome).toBe('nicht bestanden');
    expect(row('Konto C (frau): Ablauf', 'Android')?.note).toContain('Gibt es nicht');
  });

  test('cleanup', () => rmSync(dir, { recursive: true, force: true }));
});
