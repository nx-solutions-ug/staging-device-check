/**
 * `layout()` measures only a page at rest: entry animations (an action bar fading in, a sheet sliding up) made rule
 * checks fail on devices. Before measuring, the requested elements must exist, two readings in a row of their boxes,
 * the visual viewport and the scroll position must agree, and none of them may run a finite animation. Elements
 * that animate forever (a bobbing avatar) are left out of the comparison, or the page could never count as at rest.
 * Bounded: a page that is not at rest by then is never a pass.
 * `probeInPage` runs in the page: it is serialized and must stay self-contained.
 */
import type { LayoutOpts } from './measure.js';
import type { RuleResult } from './rules.js';

export type Probe = {
  present: boolean;
  running: number;
  shape: number[];
};

export type SettleClock = { sleep(ms: number): Promise<void>; now(): number };

export type Settled = { stable: true; ms: number } | { stable: false; ms: number; why: string };

export const SETTLE_LIMIT_MS = 3_000;
const POLL_MS = 150;
const TOLERANCE = 0.5;

const same = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE);

export async function settle(
  probe: () => Promise<Probe>,
  clock: SettleClock,
  limitMs = SETTLE_LIMIT_MS,
): Promise<Settled> {
  const start = clock.now();
  let prev: Probe | null = null;
  let last: Probe | null = null;
  for (;;) {
    last = await probe();
    if (last.present && last.running === 0 && prev && same(prev.shape, last.shape))
      return { stable: true, ms: clock.now() - start };
    if (clock.now() - start >= limitMs) break;
    prev = last;
    await clock.sleep(POLL_MS);
  }
  const why = !last.present
    ? 'Elemente fehlen'
    : last.running
      ? 'Animation läuft noch'
      : 'Maße ändern sich noch';
  return { stable: false, ms: clock.now() - start, why };
}

/** A page that never came to rest is never a pass: every rule is "nicht bestanden", with the reason in front. */
export function unsettled(results: RuleResult[], s: Settled): RuleResult[] {
  if (s.stable) return results;
  const note = `Seite kam in ${Math.round(s.ms / 100) / 10} s nicht zur Ruhe (${s.why})`;
  return results.map((r) =>
    r.outcome === 'nicht prüfbar hier'
      ? r
      : { rule: r.rule, outcome: 'nicht bestanden', detail: `${note} — ${r.detail}` },
  );
}

export function probeInPage(o: LayoutOpts): Probe {
  const sels = [o.header, o.actionBar, o.footer, o.actionButton, o.top, o.selectedRow].filter(
    (s): s is string => !!s,
  );
  const animating = (el: Element) =>
    typeof el.getAnimations === 'function'
      ? el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
      : [];
  const endless = (el: Element) =>
    animating(el).some((a) => a.effect?.getTiming().iterations === Infinity);
  let running = 0;
  const shape: number[] = [];
  for (const sel of sels)
    for (const el of Array.from(document.querySelectorAll(sel))) {
      running += animating(el).filter((a) => a.effect?.getTiming().iterations !== Infinity).length;
      if (endless(el)) continue;
      const b = el.getBoundingClientRect();
      shape.push(b.top, b.left, b.width, b.height);
    }
  const vv = window.visualViewport;
  shape.push(window.scrollY, vv ? vv.offsetTop : 0, vv ? vv.height : window.innerHeight);
  const present =
    !!document.querySelector(o.header) && (!o.actionBar || !!document.querySelector(o.actionBar));
  return { present, running, shape };
}
