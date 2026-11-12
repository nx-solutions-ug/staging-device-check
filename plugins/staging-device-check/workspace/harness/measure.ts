import type { Page } from '@playwright/test';
import type { Metrics, Rect } from './rules.js';

/** CSS selectors of the step's structure; only `header` is required. */
export type LayoutOpts = {
  header: string;
  actionBar?: string;
  footer?: string;
  selectedRow?: string;
  /** elements that must start below the header (R2), e.g. the first content block */
  top?: string;
  /** the bar's action button, when the spec knows it (otherwise: submit in the bar, else its last visible button) */
  actionButton?: string;
};

/**
 * The measured action button of the pinned bar (review ruling): the spec's selector when given; otherwise the
 * submit button in the bar; otherwise the bar's last visible button. Self-contained — it is injected into the page.
 */
export function pickActionButton(
  bar: Element | null,
  explicit: string | undefined,
  visible: (el: Element) => boolean,
): Element | null {
  if (!bar) return null;
  if (explicit)
    return (
      bar.querySelector(explicit) ||
      (bar.ownerDocument ? bar.ownerDocument.querySelector(explicit) : null)
    );
  const submits = Array.from(
    bar.querySelectorAll('button[type="submit"], input[type="submit"]'),
  ).filter(visible);
  if (submits.length) return submits[0];
  const buttons = Array.from(
    bar.querySelectorAll('button, [role="button"], input[type="button"]'),
  ).filter(visible);
  return buttons.length ? buttons[buttons.length - 1] : null;
}

/**
 * One measurement in the page. A single `page.evaluate` with a FUNCTION OBJECT — BrowserStack's iOS shim calls a
 * string as a function and fails on an expression. The function is self-contained (it is serialized).
 */
/** The in-page body; `pick` is pickActionButton, injected by IN_PAGE. */
const measureBody = ({ o }: { o: LayoutOpts }, pick: typeof pickActionButton): Metrics => {
  const round = (v: number) => Math.round(v * 10) / 10;
  const box = (el: Element | null): Rect | null => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      top: round(b.top),
      bottom: round(b.bottom),
      left: round(b.left),
      right: round(b.right),
      width: round(b.width),
      height: round(b.height),
    };
  };
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return (
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0 &&
      b.width > 0 &&
      b.height > 0
    );
  };
  const label = (el: Element) => {
    const text = (
      (el as HTMLElement).innerText ||
      (el as HTMLInputElement).value ||
      el.getAttribute('aria-label') ||
      ''
    )
      .trim()
      .slice(0, 40);
    return `${el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`;
  };
  const one = (sel?: string) => (sel ? document.querySelector(sel) : null);
  const all = (sel?: string) => (sel ? [...document.querySelectorAll(sel)] : []);
  const root = document.documentElement;
  const vv = window.visualViewport;

  const header = one(o.header);
  const footer = one(o.footer);
  const bar = one(o.actionBar);
  const cta = pick(bar, o.actionButton, visible);

  // R3: content elements intersecting the action bar, where one of the two is on top at the overlap centre
  const overlaps: string[] = [];
  if (bar && visible(bar)) {
    const bb = bar.getBoundingClientRect();
    const fixedAncestor = (el: Element) => {
      for (let p: Element | null = el; p && p !== root; p = p.parentElement)
        if (getComputedStyle(p).position === 'fixed') return true;
      return false;
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (
        bar.contains(el) ||
        el.contains(bar) ||
        (header && header.contains(el)) ||
        fixedAncestor(el)
      )
        continue;
      const hasText = [...el.childNodes].some(
        (c) => c.nodeType === 3 && (c.textContent || '').trim(),
      );
      if (
        !hasText &&
        !el.matches(
          'img,input,textarea,select,button,[role="option"],[role="radio"],[role="slider"]',
        )
      )
        continue;
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      const ox = Math.min(b.right, bb.right) - Math.max(b.left, bb.left);
      const oy = Math.min(b.bottom, bb.bottom) - Math.max(b.top, bb.top);
      if (ox < 2 || oy < 2) continue;
      const hit = document.elementFromPoint(
        Math.max(b.left, bb.left) + ox / 2,
        Math.max(b.top, bb.top) + oy / 2,
      );
      if (hit && (bar.contains(hit) || el === hit || el.contains(hit)))
        overlaps.push(`${label(el)} ${round(oy)}px`);
    }
  }

  // R6: interactive controls smaller than 44x44 (inline text links excluded)
  const smallTargets: string[] = [];
  for (const el of document.querySelectorAll(
    'button,[role="button"],[role="radio"],[role="checkbox"],[role="tab"],[role="option"],input:not([type="hidden"]),select',
  )) {
    if (!visible(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.bottom < 0 || b.top > window.innerHeight) continue;
    if (b.width < 43 || b.height < 43)
      smallTargets.push(`${label(el)} ${round(b.width)}x${round(b.height)}`);
  }

  return {
    scrollY: round(window.scrollY),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollWidth: root.scrollWidth,
    maxScroll: round(root.scrollHeight - window.innerHeight),
    footerHeight: footer ? round(footer.getBoundingClientRect().height) : null,
    visualViewport: vv
      ? { offsetTop: round(vv.offsetTop), height: round(vv.height), width: round(vv.width) }
      : null,
    header: box(header),
    top: all(o.top)
      .filter(visible)
      .map((el) => box(el) as Rect),
    actionBar: bar && visible(bar) ? box(bar) : null,
    cta: cta && visible(cta) ? box(cta) : null,
    overlaps,
    smallTargets,
    selectedRows: all(o.selectedRow)
      .filter(visible)
      .map((el) => box(el) as Rect),
  };
};

/**
 * The function object handed to `page.evaluate`: pickActionButton and the body, assembled here in Node so the page
 * receives one self-contained function (no string expression, no eval in the page).
 */
const IN_PAGE = new Function(
  'arg',
  `const pickActionButton = ${pickActionButton.toString()};\nreturn (${measureBody.toString()})(arg, pickActionButton);`,
) as (arg: { o: LayoutOpts }) => Metrics;

export async function measure(page: Page, opts: LayoutOpts): Promise<Metrics> {
  return page.evaluate(IN_PAGE, { o: opts });
}
