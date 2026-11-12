# What BrowserStack can and cannot do

From the probe and the SDK live checks on iPhone 16 / iOS 18 and Samsung Galaxy S23 / Android 13.

## Works on both

- `tap` and `fill` focus inputs. The config sets `hasTouch`, without which Android refuses `tap`. On Android the
  focus can land a moment after the tap: wait for it (`waitForFunction` on `document.activeElement`) instead of
  checking at once.
- `getByRole`, `waitForFunction`, `page.screenshot` (`shot()`), `addCookies` with `url`.
- `page.evaluate` with a **function object** (on iOS a string expression fails).
- Viewport numbers equal real devices. iPhone 16: `innerHeight` 659, `100lvh` 741, `visualViewport` 659.

## iOS only (Safari on a real iPhone)

- **`evaluate` arguments are dropped.** `page.evaluate(fn, arg)` runs as `fn()`, and the same goes for `$eval`,
  `$$eval`, `evaluateAll`, `evaluateHandle` and `waitForFunction` with an argument. Use `evaluateWith(page, fn, arg)`
  from the harness; `run` refuses a spec that passes an argument.
- **The on-screen keyboard never opens through Playwright.** Every check that needs it is `nicht prüfbar hier` —
  "auf eigenem iPhone prüfen" — never a pass.
- `keyboard.type` writes nothing; `pressSequentially` does.
- `clearCookies({ name })` is refused; the harness falls back to clearing all cookies at the end of a test.
- `page.screenshot` shows only the web content, without the Safari toolbar.
- Not supported: console logs, Playwright logs, geolocation, `resolution`. Only Safari; there is no Chrome on iPhone.
- One browser context per session: each persona is its own test.
- **The browser language is English**, and Playwright's `locale` has no effect. An app that follows the browser
  language shows English. BrowserStack's `language`/`locale` capabilities exist, but only on a paid plan. Carry a
  language cookie of the app over from the local look with `appCookie` (SKILL.md, "Language"); otherwise texts are
  "nicht prüfbar hier (Gerätesprache)".

## Android

- `tap` opens the on-screen keyboard. The keyboard phase of the layout rules is measurable there.
