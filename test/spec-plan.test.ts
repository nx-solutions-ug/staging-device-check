import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateArgFindings } from '../src/evaluate-guard.js';
import { specPlan } from '../src/spec-plan.js';

describe('specPlan', () => {
  test('lists the checks of each persona test', () => {
    const src = [
      "import { check, test } from './harness/fixtures.js';",
      "test.describe('A', () => {",
      "  test.use({ persona: 'frau' });",
      "  test('Konto A (frau)', async ({ account }) => {",
      "    await account('A');",
      "    await check('Kopf da', async () => {});",
      '    await check(`Tastatur`, async () => {}, { keyboard: true });',
      '  });',
      '});',
      "test('Konto B (mann)', async () => { await check('Preis', async () => {}); });",
    ].join('\n');
    expect(specPlan(src, 's.ts')).toEqual({
      tests: [
        { title: 'Konto A (frau)', checks: ['Kopf da', 'Tastatur'] },
        { title: 'Konto B (mann)', checks: ['Preis'] },
      ],
      problems: [],
    });
  });

  test('refuses raw test.step and titles that are not fixed text', () => {
    const src = [
      "const t = 'x';",
      "test('Konto A', async () => {",
      "  await test.step('roh', async () => {});",
      '  await check(t, async () => {});',
      '});',
    ].join('\n');
    expect(specPlan(src, 's.ts').problems).toEqual([
      's.ts:3: test.step statt check() — Prüfungen bitte mit check() schreiben',
      's.ts:4: der Prüfungstitel muss ein fester Text sein',
    ]);
  });
});

describe('raw input is refused: only the harness helpers hold on real phones', () => {
  const plan = (body: string) =>
    specPlan(
      [
        "import { check, test } from './harness/fixtures.js';",
        "test('Konto A', async ({ page, tap, typeInto }) => {",
        body,
        '});',
      ].join('\n'),
      'tests-e2e.spec.ts',
    ).problems;

  test.each([
    ["  await page.getByRole('button').tap();", 'tap', 'tap(locator)'],
    ["  await page.locator('#ort').fill('91077');", 'fill', 'typeInto(selector, Wert)'],
    [
      "  await page.locator('#ort').pressSequentially('x');",
      'pressSequentially',
      'typeInto(selector, Wert)',
    ],
    ["  await page.locator('#ort')?.tap();", 'tap', 'tap(locator)'],
    ["  await check('A', async () => { await page.locator('a').tap(); });", 'tap', 'tap(locator)'],
  ])('%s', (line, raw, helper) => {
    expect(plan(line)).toEqual([
      `tests-e2e.spec.ts:3: .${raw}() direkt — bitte ${helper} aus der Harness verwenden`,
    ]);
  });

  test('the helpers, a click and in-page code are fine', () => {
    expect(
      plan(
        [
          "  await tap(page.getByRole('button'));",
          "  await typeInto('#ort', '91077', { until: async () => true });",
          "  await page.locator('a').click();",
          "  await page.evaluate(() => document.querySelector('a')?.click());",
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

describe('the skill example passes every guard of run', () => {
  test('the spec example in SKILL.md', () => {
    const md = readFileSync(
      join(
        import.meta.dir,
        '..',
        'plugins',
        'staging-device-check',
        'skills',
        'tests-e2e',
        'SKILL.md',
      ),
      'utf8',
    );
    const example = md.match(/```ts\n([\s\S]*?)```/)?.[1] ?? '';
    expect(example).toContain('check(');
    const p = specPlan(example, 'tests-e2e.spec.ts');
    expect(p.problems).toEqual([]);
    expect(p.tests[0].checks.length).toBeGreaterThan(2);
    expect(evaluateArgFindings(example, 'tests-e2e.spec.ts')).toEqual([]);
  });
});
