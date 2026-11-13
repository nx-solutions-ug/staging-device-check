/**
 * The page's address, read in the page. Playwright's own address (`page.url()`, and with it `toHaveURL` and
 * `waitForURL`) did not follow the app's in-app navigation (`history.pushState`) on a real iPhone (iOS 27, Safari):
 * it stayed on the address of the last full load while the page had long moved on. `location.href` in the page is
 * what the user sees. The page gets one parameterless function object (the iPhone drops evaluate arguments).
 */

export type AddressPage = { evaluate(fn: () => unknown): Promise<unknown> };

/** How long one read may take before it counts as failed (the page is swapping documents). */
export const ADDRESS_READ_MS = 1_000;

/** Runs in the page. */
export const hrefInPage = (): string => location.href;

/**
 * `location.href` of the page. A read that fails or takes longer than `timeoutMs` (mid-navigation) is an error —
 * never the stale `page.url()`: the caller polls again.
 */
export async function addressInPage(
  page: AddressPage,
  timeoutMs: number = ADDRESS_READ_MS,
): Promise<string> {
  const read = page.evaluate(hrefInPage);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`Adresse der Seite nicht lesbar: keine Antwort nach ${timeoutMs} ms.`)),
      timeoutMs,
    );
  });
  try {
    // the race also handles a late rejection of a read abandoned after the bound
    const href = await Promise.race([read, bound]);
    if (typeof href !== 'string' || !URL.canParse(href)) {
      throw new Error('Adresse der Seite nicht lesbar: keine gültige Adresse.');
    }
    return href;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For specs: the path the page is on, or `null` while it cannot answer. Poll it, never read it once:
 * `await expect.poll(() => pathInPage(page)).toBe('/dashboard')` (`expect.poll` stops at the first throw, so this
 * never throws).
 */
export async function pathInPage(
  page: AddressPage,
  timeoutMs: number = ADDRESS_READ_MS,
): Promise<string | null> {
  try {
    return new URL(await addressInPage(page, timeoutMs)).pathname;
  } catch {
    return null;
  }
}
