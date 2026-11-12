/**
 * BrowserStack's SDK iOS shim runs `page.evaluate(fn, arg)` as `fn()`: the argument never reaches the page (live
 * check). This finds every call that would rely on such an argument — in the harness (unit test) and in a generated
 * spec before `run` starts the SDK. The harness's `evaluateWith` bakes the argument into the function instead.
 */
import { parse } from '@babel/parser';

/** method → index of the page-function argument that iOS drops */
const ARG_INDEX: Record<string, number> = {
  evaluate: 1,
  evaluateHandle: 1,
  evaluateAll: 1,
  waitForFunction: 1,
  $eval: 2,
  $$eval: 2,
};

type Node = { type: string; loc?: { start: { line: number } }; [k: string]: unknown };

const isUndefined = (n: Node | undefined) => n?.type === 'Identifier' && n.name === 'undefined';

/** `file:line method` for each call that passes the dropped argument. */
export function evaluateArgFindings(source: string, file: string): string[] {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
    errorRecovery: false,
  }) as unknown as Node;
  const out: string[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    const node = n as Node;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee as Node;
      const prop =
        callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression'
          ? (callee.property as Node)
          : null;
      const name = prop?.type === 'Identifier' ? (prop.name as string) : null;
      const index = name ? ARG_INDEX[name] : undefined;
      const args = node.arguments as Node[];
      if (index !== undefined && args.length > index && !isUndefined(args[index]))
        out.push(`${file}:${node.loc?.start.line ?? '?'} ${name}`);
    }
    for (const [k, v] of Object.entries(node))
      if (k !== 'loc' && k !== 'start' && k !== 'end') visit(v);
  };
  visit(ast);
  return out;
}
