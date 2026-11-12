# Live checks on BrowserStack

Results of the opt-in live smoke `test/live/sdk-smoke.spec.ts`, run through the plugin's real CLI path
(`cli.js install-workspace` → `prepare` → `run` → `report`), not through `bun test`.

## 12.11.2026 — SDK smoke, iPhone 16 / iOS 18 and Samsung Galaxy S23 / Android 13

**Setup.**

- A trial account.
- A test `browserstack.yml` without credentials (mode 600, outside the repo, deleted afterwards). It held exactly two
  platforms:
  - `iPhone 16` / `18` / `safari`;
  - `Samsung Galaxy S23` / `13.0` / `chrome`.
- `browserstackLocal: false`.
- The credentials reached the SDK only through `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` in the child's env.
- Settings with invented staging values. No staging call: the spec uses a synthetic page (`page.setContent`) on the
  reserved domain `example.com`.
- `@playwright/test` 1.62.1, `browserstack-node-sdk` 1.79.0. Reported OS: iOS 18.5.

**Two runs.** The second ran after the fixes from the first (below).

**Minutes:** sessions 26 + 10 s (run 1) and 76 + 12 s (run 2), 124 s ≈ **2.1 min**. The API sum of session
durations rose from 6.5 to 8.6 min.

| Question                                                    | iPhone 16 / iOS 18                                                                                                      | Galaxy S23 / Android 13                                                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport `innerHeight` / `100lvh` / `visualViewport.height` | **659 / 741 / 659**, as in the legacy probe (spec §8); `innerWidth` 393                                                 | 649 / 705 / 649; `innerWidth` 360                                                                                                                                                           |
| `tap` focuses the input                                     | yes                                                                                                                     | without `hasTouch`: error "The page does not support tap". With `hasTouch: true` (now in the generated config): no error, but `document.activeElement` is not the input right after the tap |
| `fill` focuses and fills                                    | yes                                                                                                                     | yes                                                                                                                                                                                         |
| `addCookies` with `url`, seen by `document.cookie`          | yes                                                                                                                     | yes                                                                                                                                                                                         |
| `clearCookies({ name })`                                    | **rejected** by the shim: `expectedValue of name: "" does not match providedValue`                                      | works                                                                                                                                                                                       |
| `clearCookies()` without a filter                           | removes the cookie                                                                                                      | removes the cookie                                                                                                                                                                          |
| `page.evaluate` with a function object, no argument         | works                                                                                                                   | works                                                                                                                                                                                       |
| `page.evaluate` with a function object **and an argument**  | **the argument is dropped**: the shim runs `fn()` with no arguments ("Right side of assignment cannot be destructured") | works                                                                                                                                                                                       |
| `shot()` writes a file                                      | yes                                                                                                                     | yes                                                                                                                                                                                         |
| `layout()` returns R1 `bestanden` (pass variant)            | **fails**: it measures through `evaluate(fn, opts)`                                                                     | yes; R1, start, R2, R3, R4, R5, R6 all `bestanden`                                                                                                                                          |

**Which build name wins (her yml read in place).** `BROWSERSTACK_BUILD_NAME` wins over `buildName` in the yml.

- The yml said `sdc-live-yml`; the builds were named `SMOKE-1 2026-11-12  1` and `… 2`.
- For local runs the SDK appends an incremental counter.

**Device column.**

- The SDK's project names are `safari-iPhone 16:18-browserstack-mobile` and
  `chrome-Samsung Galaxy S23:13.0-browserstack-mobile`.
- `report` maps them to the iPhone and Android columns correctly.
- Screenshot names carry the full project name (`…_safari-iphone-16-18-browserstack-mobile_…`).

**Abort (SIGTERM to `run` mid-test).** Not run live: the 2-minute budget was used up.

- `cli.js run` now turns SIGINT/SIGTERM into an abort of the SDK process and still cleans the run folder. This is
  unit-tested (`an outside abort … still cleans the run folder`).
- Still open, for a later live check:
  - whether BrowserStack ends the device session;
  - whether `result.json` is written.

**Redaction scan after the runs.** In-process search for the username, key, `user:key`, its base64 form and the
JSON-escaped and URI-encoded forms:

| Place searched                                                                           | Files | Hits |
| ---------------------------------------------------------------------------------------- | ----- | ---- |
| Both run folders                                                                         | 17    | 0    |
| The whole temporary HOME, `node_modules` excluded (includes the SDK's `~/.browserstack`) | 943   | 0    |

No run token existed, because staging was not used.

### Fixed after run 1

- **Teardown fallback.** The staging fixture's teardown first tries `clearCookies({ name })`. When a device rejects
  the filter (the iOS shim), it falls back to `clearCookies()`; the test is over, so every cookie may go.
- **`hasTouch: true`.** The generated `playwright.config.ts` sets it, so `tap` does not throw on Android.

### Fixed after run 2: `evaluate` arguments on iOS

- **What run 2 showed.** Through the SDK, the iOS shim runs `page.evaluate(fn, arg)` as `fn()`, so the argument
  never reaches the page. The legacy wss route passed it.
- **The fix.** No harness call passes a second argument any more. `evaluateWith(page, fn, arg)` (`harness/evaluate.ts`)
  writes the argument into the function source as a JSON constant; the page receives one parameterless function.
  - `measure()` and the page-end scroll in `layout()` use it.
  - The fixtures re-export it for generated specs.
  - A unit test scans every harness file and fails on any `evaluate`, `evaluateHandle` or `waitForFunction` call
    with a second argument.
- **Android `tap`.** `hasTouch: true` stays in the config. The smoke spec now waits up to 3 s for the focus
  (`waitForFunction` on `document.activeElement`) instead of checking at once.

## 12.11.2026 — re-check after the fixes (run 3), same devices, same method

**Minutes:** 0.8 (API session sum 8.6 → 9.4 min). The whole live check used ≈ 2.9 min.

| Question                          | iPhone 16 / iOS 18                                            | Galaxy S23 / Android 13 |
| --------------------------------- | ------------------------------------------------------------- | ----------------------- |
| `layout()` / `measure()` run      | **yes**: all seven rules come back measured                   | yes                     |
| Rules on the smoke page           | R1 **nicht bestanden**; start, R2, R3, R4, R5, R6 `bestanden` | all `bestanden`         |
| Focus after `tap` (with the wait) | `name`                                                        | **`name`**              |
| Viewport, `fill`, cookies, `shot` | as in run 2                                                   | as in run 2             |

**Why R1 failed on iOS: the smoke page, not the harness.** This is an inference; the rule detail was not recorded in
this run.

- The page's hidden `100lvh` probe was `position: absolute`. It extends the document to 741 px against a 659 px
  viewport: `maxScroll` 82 px against an 80 px bar is 2 px over the 1 px tolerance.
- The same page on Android gives 705 − 649 = 56 px, under the bar, which passes.
- The probe is now `position: fixed`, which never adds to the scroll height, and the spec records each rule's detail.
- Confirming this needs one more short iOS run (≈ 0.5 min), which was not made within the 1-minute budget.

## Still open

- **The `report` note.** It shows the raw first error line, including ANSI colour codes. Notes should drop ANSI
  escapes and long command echoes.
- **The abort live check** (SIGTERM mid-test) moved to Task 10. Cleanup on SIGINT/SIGTERM is unit-tested.
