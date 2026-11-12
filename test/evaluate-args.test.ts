import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateArgFindings } from '../src/evaluate-guard.js';
import {
  evaluateWith,
  withArg,
} from '../plugins/staging-device-check/workspace/harness/evaluate.js';

const HARNESS = new URL('../plugins/staging-device-check/workspace/harness/', import.meta.url)
  .pathname;

describe('evaluate arguments (BrowserStack iOS drops them)', () => {
  test('withArg bakes the argument into a parameterless function', () => {
    const f = withArg((a: { n: number; s: string }) => `${a.s}:${a.n * 2}`, { n: 21, s: 'x"y' });
    expect(f.length).toBe(0);
    expect(f()).toBe('x"y:42');
    expect(f.toString()).toContain('"x\\"y"');
  });

  test('evaluateWith hands the page one function and no second argument', async () => {
    const calls: unknown[][] = [];
    const page = {
      evaluate: async (...args: unknown[]) => {
        calls.push(args);
        return (args[0] as () => unknown)();
      },
    };
    expect(await evaluateWith(page, (top: number) => top + 1, 41)).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
  });

  test('no harness call passes a dropped argument to evaluate and friends', () => {
    const offenders = readdirSync(HARNESS)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .flatMap((f) => evaluateArgFindings(readFileSync(join(HARNESS, f), 'utf8'), f));
    expect(offenders).toEqual([]);
  });

  test('the guard knows every evaluate form and its argument position', () => {
    const src = [
      'await page.evaluate((y) => y, 1);',
      'await page.evaluate(() => 1);',
      'await page.waitForFunction(() => true, undefined, { timeout: 1 });',
      'await page.locator("a").evaluateAll((els, n) => n, 2);',
      'await page.$eval("a", (el, c) => c, 3);',
      'await page.$$eval("a", (els) => els.length);',
      'await handle.evaluateHandle((x, y) => y, 4);',
    ].join('\n');
    expect(evaluateArgFindings(src, 's.ts')).toEqual([
      's.ts:1 evaluate',
      's.ts:4 evaluateAll',
      's.ts:5 $eval',
      's.ts:7 evaluateHandle',
    ]);
  });
});
