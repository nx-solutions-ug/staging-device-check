import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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

  test('no harness call passes a second argument to evaluate, evaluateHandle or waitForFunction', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(HARNESS).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'),
    )) {
      const file = join(HARNESS, name);
      const src = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (n: ts.Node) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ['evaluate', 'evaluateHandle', 'waitForFunction'].includes(n.expression.name.text)
        ) {
          const [, second] = n.arguments;
          const passes = second && !(ts.isIdentifier(second) && second.text === 'undefined');
          if (passes) {
            const { line } = src.getLineAndCharacterOfPosition(n.getStart());
            offenders.push(`${name}:${line + 1}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(src);
    }
    expect(offenders).toEqual([]);
  });
});
