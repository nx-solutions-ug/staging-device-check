/**
 * What `layout()` measured inside the running `check()`. `check()` fails closed from it: on iOS a check whose layout
 * results were "nicht prüfbar hier", or that measured nothing at all, becomes "nicht prüfbar hier" — never a pass,
 * even when the spec forgot `{ keyboard: true }` or asserted too little.
 */
import type { RuleResult } from './rules.js';

let current: RuleResult[][] | null = null;

/** Starts collecting for one check; the returned function ends it and hands back every layout() result. */
export function beginCheck(): () => RuleResult[][] {
  const mine: RuleResult[][] = [];
  current = mine;
  return () => {
    if (current === mine) current = null;
    return mine;
  };
}

/** Called by the layout fixture with every result it returns. */
export function noteLayout(results: RuleResult[]): RuleResult[] {
  current?.push(results);
  return results;
}

/** Why the check could not be measured here, or null. */
export function unmeasured(calls: RuleResult[][]): string | null {
  if (calls.some((r) => r.length === 0))
    return 'Layout hier nicht messbar (keine Regel gemessen) — auf eigenem iPhone prüfen';
  const notHere = calls.flat().find((r) => r.outcome === 'nicht prüfbar hier');
  return notHere ? `${notHere.rule}: ${notHere.detail}` : null;
}
