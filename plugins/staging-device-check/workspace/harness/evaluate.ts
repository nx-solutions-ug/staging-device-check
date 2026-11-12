/**
 * BrowserStack's SDK iOS shim runs `page.evaluate(fn, arg)` as `fn()`: the argument never reaches the page (live
 * check). So no harness call hands evaluate a second argument; the argument is baked into the function source as a
 * JSON constant instead, and the page receives one parameterless function object.
 */

/** `fn` with `arg` written into its source; the result takes no parameters and is self-contained. */
export function withArg<A, R>(fn: (arg: A) => R, arg: A): () => R {
  const json = JSON.stringify(arg);
  return new Function(
    `return (${fn.toString()})(${json === undefined ? 'undefined' : json});`,
  ) as () => R;
}

type Evaluates = { evaluate: (fn: () => unknown) => Promise<unknown> };

/** `page.evaluate(fn, arg)`, safe on iOS: the argument travels inside the function. */
export function evaluateWith<A, R>(page: Evaluates, fn: (arg: A) => R, arg: A): Promise<R> {
  return page.evaluate(withArg(fn, arg)) as Promise<R>;
}
