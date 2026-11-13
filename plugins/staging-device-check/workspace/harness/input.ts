/**
 * Tapping and typing that hold on real phones (pure logic; fixtures.ts wires it to Playwright).
 * - Android: the open keyboard covers the bottom action button and taps land beside it, so `tap` closes the
 *   keyboard first (blur, then wait until the visual viewport is back) unless told to keep it.
 * - iOS (BrowserStack's shim): no single input method works everywhere, so `typeInto` tries a fixed order and stops
 *   at the first one the app noticed: `fill`, then the native value setter with input/change events, then
 *   `pressSequentially` into the cleared field.
 * The `…InPage` functions run in the page: they are serialized and must stay self-contained.
 */

export type Viewport = { inner: number; visual: number; editableFocused: boolean };

export const KEYBOARD_GAP = 100;
export const keyboardMayBeOpen = (v: Viewport) =>
  v.editableFocused || v.inner - v.visual > KEYBOARD_GAP;

export type Clock = { sleep(ms: number): Promise<void>; now(): number };

export type TapDeps = Clock & {
  viewport(): Promise<Viewport>;
  blur(): Promise<void>;
  ready(): Promise<void>;
  tap(): Promise<void>;
  consent(): Promise<void>;
};

export type TapOptions = { keepKeyboard?: boolean };

export const KEYBOARD_CLOSE_MS = 3_000;
const POLL_MS = 150;

export async function closeKeyboard(
  d: Omit<TapDeps, 'ready' | 'tap' | 'consent'>,
): Promise<boolean> {
  if (!keyboardMayBeOpen(await d.viewport())) return true;
  await d.blur();
  const end = d.now() + KEYBOARD_CLOSE_MS;
  let prev: Viewport | null = null;
  while (d.now() < end) {
    await d.sleep(POLL_MS);
    const v = await d.viewport();
    if (
      prev &&
      prev.visual === v.visual &&
      prev.inner === v.inner &&
      v.inner - v.visual <= KEYBOARD_GAP
    )
      return true;
    prev = v;
  }
  return false;
}

export async function tapSafely(d: TapDeps, opts: TapOptions = {}): Promise<void> {
  await d.consent();
  if (!opts.keepKeyboard) await closeKeyboard(d);
  await d.ready();
  await d.tap();
}

export type TypeMethod = 'fill' | 'setter' | 'pressSequentially';

export type TypeDeps = Clock & {
  tapField(): Promise<void>;
  fill(value: string): Promise<void>;
  /** the native value setter on the field plus input/change events; false when the field is not an input */
  setNative(value: string): Promise<boolean>;
  pressSequentially(value: string): Promise<void>;
  /** whether the app noticed the value (default: the field reads it back) */
  arrived(): Promise<boolean>;
};

export type TypeOptions = {
  /** how long each method waits for `arrived` (default 6 s: suggestions and checks may need the network) */
  waitMs?: number;
};

export const TYPE_WAIT_MS = 6_000;

export class EingabeFehler extends Error {
  constructor(field: string) {
    super(`Die Eingabe in ${field} kam nicht an (fill, Setter und Tippen versucht).`);
    this.name = 'EingabeFehler';
  }
}

async function within(d: Clock, ms: number, ok: () => Promise<boolean>): Promise<boolean> {
  const end = d.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (d.now() >= end) return false;
    await d.sleep(POLL_MS);
  }
}

export async function typeSafely(
  d: TypeDeps,
  field: string,
  value: string,
  opts: TypeOptions = {},
): Promise<TypeMethod> {
  const wait = opts.waitMs ?? TYPE_WAIT_MS;
  await d.tapField();
  await d.fill(value).catch(() => undefined);
  if (await within(d, wait, d.arrived)) return 'fill';
  if ((await d.setNative(value)) && (await within(d, wait, d.arrived))) return 'setter';
  await d.setNative('');
  await d.pressSequentially(value);
  if (await within(d, wait, d.arrived)) return 'pressSequentially';
  throw new EingabeFehler(field);
}

export function viewportInPage(): Viewport {
  const a = document.activeElement as HTMLElement | null;
  const editable =
    !!a &&
    (a.isContentEditable ||
      a.tagName === 'TEXTAREA' ||
      (a.tagName === 'INPUT' &&
        !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(
          (a as HTMLInputElement).type,
        )));
  return {
    inner: window.innerHeight,
    visual: window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight,
    editableFocused: editable,
  };
}

/** The setter path proven in the device trial: querySelector, focus, native setter, events. */
export function setNativeInPage({ selector, value }: { selector: string; value: string }): boolean {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  el.focus();
  const proto =
    el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function valueInPage(selector: string): string | null {
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  return el && 'value' in el ? el.value : null;
}
