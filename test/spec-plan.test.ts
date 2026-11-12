import { describe, expect, test } from 'bun:test';
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
