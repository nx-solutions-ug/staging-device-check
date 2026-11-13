/**
 * The app's cookie/consent banner, dismissed with the button the local look found (its most privacy-preserving
 * choice, e.g. "only necessary"). On devices it appears late, seconds after load, and covers steps and buttons, so
 * the first navigation of a test waits for it for a bounded time, and every tap, layout() and shot() first looks for
 * it once more without waiting. The plugin knows no label: none given → nothing happens.
 */

export type ConsentPage = {
  /** whether the button is visible right now (one look, no waiting) */
  shown(label: string): Promise<boolean>;
  /** waits up to `ms` for the button to become visible */
  appears(label: string, ms: number): Promise<boolean>;
  /** taps the button and waits until it is gone */
  dismiss(label: string): Promise<void>;
};

export type Consent = {
  afterGoto(): Promise<void>;
  look(): Promise<void>;
  readonly dismissed: boolean;
};

/** How long the first navigation of a test waits for a late banner (devices showed it seconds after load). */
export const FIRST_WAIT_MS = 20_000;

export function consentBanner(
  label: string | undefined,
  page: ConsentPage,
  firstWaitMs = FIRST_WAIT_MS,
): Consent {
  let waited = false;
  let dismissed = false;
  const dismiss = async (l: string) => {
    await page.dismiss(l);
    dismissed = true;
  };
  return {
    async afterGoto() {
      if (!label) return;
      if (!waited && !dismissed) {
        waited = true;
        if (await page.appears(label, firstWaitMs)) await dismiss(label);
        return;
      }
      if (await page.shown(label)) await dismiss(label);
    },
    async look() {
      if (label && (await page.shown(label))) await dismiss(label);
    },
    get dismissed() {
      return dismissed;
    },
  };
}

/** In the page: whether a visible button (or role=button) has exactly this text. Self-contained (serialized). */
export function consentShownInPage(label: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return Array.from(document.querySelectorAll('button, [role="button"]')).some((el) => {
    const text = norm((el as HTMLElement).innerText || el.getAttribute('aria-label') || '');
    if (text !== norm(label)) return false;
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0;
  });
}
