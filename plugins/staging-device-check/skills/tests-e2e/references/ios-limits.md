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
- **Text input: no single method works everywhere.** `keyboard.type` writes nothing. `pressSequentially` worked on
  iOS 18 and, on iOS 17, in a plain text field — but wrote nothing into an autocomplete field (`role=combobox`),
  where `fill` worked. So specs type only with the harness's `typeInto`, in this order, stopping at the first one the
  app noticed (its `until`): `fill` → the native value setter on the field (`querySelector`, `focus()`, setter,
  `input` and `change` events) → `pressSequentially` into the cleared field. Each run's output says which one
  worked (`typeInto <selector>: <method>`).
- **`tap` and `click` do not wait** for the element to be visible: an element that is still fading in fails at once
  with `element is not actionable: element is not visible (visibility:hidden)`. The harness's `tap` waits for
  visible and enabled first.
- `clearCookies({ name })` is refused; the harness falls back to clearing all cookies at the end of a test.
- `page.screenshot` shows only the web content, without the Safari toolbar.
- Not supported: console logs, Playwright logs, geolocation, `resolution`. Only Safari; there is no Chrome on iPhone.
- One browser context per session: each persona is its own test.
- **The browser language is English**, and Playwright's `locale` has no effect. An app that follows the browser
  language shows English. BrowserStack's `language`/`locale` capabilities exist, but only on a paid plan. Carry a
  language cookie of the app over from the local look with `appCookie` (SKILL.md, "Language"); otherwise texts are
  "nicht prüfbar hier (Gerätesprache)".

## Both, from the device trial

- **The consent banner appears late**, seconds after load, and covers steps and buttons. The harness waits for it
  on the first navigation and looks again before every `tap`, `layout()` and `shot()` (`consentButton`).
- **Entry animations** (an action bar fading in) make an early measurement wrong: `layout()` waits until the
  measured boxes, the visual viewport and the scroll position are at rest.

## Android

- `tap` opens the on-screen keyboard. The keyboard phase of the layout rules is measurable there.
- **The open keyboard covers the bottom action button**; a tap aimed at it lands beside it. The harness's `tap`
  blurs the field and waits until the visual viewport is back before tapping (`keepKeyboard` to keep it open).
