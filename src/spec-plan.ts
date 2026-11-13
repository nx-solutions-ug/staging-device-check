/**
 * The checks a generated spec plans: one `test` per persona, one `check('<Titel>', …)` per check. `run` stores them in
 * run.json before the SDK starts, so `report` can list every planned check that never ran. Raw `test.step` calls are
 * refused: only `check()` keeps a step's title and its annotations in one place. Raw `.tap()`, `.fill()` and
 * `.pressSequentially()` are refused too: on real phones only the harness's `tap()` and `typeInto()` hold (keyboard
 * over the button, a late consent banner, iOS input).
 */
import { parse } from '@babel/parser';

export type SpecPlan = { tests: Array<{ title: string; checks: string[] }>; problems: string[] };

type Node = { type: string; loc?: { start: { line: number } }; [k: string]: unknown };

const literal = (n: Node | undefined): string | null => {
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value as string;
  if (n.type === 'TemplateLiteral' && (n.expressions as unknown[]).length === 0)
    return ((n.quasis as Node[])[0].value as { cooked: string }).cooked;
  return null;
};

/** `test(...)`, `test.only(...)`; not `test.describe`, `test.use`, `test.step`. */
const isTestCall = (callee: Node) =>
  (callee.type === 'Identifier' && callee.name === 'test') ||
  (callee.type === 'MemberExpression' &&
    (callee.object as Node).type === 'Identifier' &&
    (callee.object as Node).name === 'test' &&
    ['only', 'fixme', 'fail', 'slow'].includes(((callee.property as Node).name as string) ?? ''));

/** raw Playwright input → the harness helper that replaces it */
const RAW_INPUT: Record<string, string> = {
  tap: 'tap(locator)',
  fill: 'typeInto(selector, Wert)',
  pressSequentially: 'typeInto(selector, Wert)',
};

const memberName = (callee: Node): string | null =>
  (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
  (callee.property as Node).type === 'Identifier' &&
  !callee.computed
    ? ((callee.property as Node).name as string)
    : null;

const isStepCall = (callee: Node) =>
  callee.type === 'MemberExpression' &&
  (callee.property as Node).type === 'Identifier' &&
  (callee.property as Node).name === 'step';

export function specPlan(source: string, file: string): SpecPlan {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] }) as unknown as Node;
  const plan: SpecPlan = { tests: [], problems: [] };
  const visit = (n: unknown, current: { title: string; checks: string[] } | null) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x, current);
      return;
    }
    const node = n as Node;
    let inner = current;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const raw = memberName(node.callee as Node);
      if (raw && Object.hasOwn(RAW_INPUT, raw))
        plan.problems.push(
          `${file}:${node.loc?.start.line ?? '?'}: .${raw}() direkt — bitte ${RAW_INPUT[raw]} aus der Harness verwenden`,
        );
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee as Node;
      const args = node.arguments as Node[];
      const at = `${file}:${node.loc?.start.line ?? '?'}`;
      if (isTestCall(callee)) {
        const title = literal(args[0]);
        if (title === null) plan.problems.push(`${at}: der Testtitel muss ein fester Text sein`);
        else {
          inner = { title, checks: [] };
          plan.tests.push(inner);
        }
      } else if (callee.type === 'Identifier' && callee.name === 'check') {
        const title = literal(args[0]);
        if (title === null)
          plan.problems.push(`${at}: der Prüfungstitel muss ein fester Text sein`);
        else if (!current) plan.problems.push(`${at}: check() steht außerhalb eines Tests`);
        else current.checks.push(title);
      } else if (isStepCall(callee)) {
        plan.problems.push(
          `${at}: test.step statt check() — Prüfungen bitte mit check() schreiben`,
        );
      }
    }
    for (const [k, v] of Object.entries(node))
      if (k !== 'loc' && k !== 'start' && k !== 'end') visit(v, inner);
  };
  visit(ast, null);
  return plan;
}
