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

## 12.11.2026 — iOS confirmation (run 4), iPhone 16 / iOS 18 only

`cli.js run … --devices iphone`, same method: the narrowed copy without credentials, mode 600, removed after the
run; the credentials only in the child env. **Minutes: 0.5** (API session sum 9.4 → 9.9). The whole live check used
≈ 3.4 min.

- The test **passed**.
- `layout()` on the smoke page with the `fixed` 100lvh probe gave R1 **`bestanden`** (`maxScroll 0 − Footer 80 =
  -80`). All the other rules came back `bestanden` with their details:
  - start: `scrollY 0`;
  - R2: elements under the 56 px header;
  - R4: action 595..643 inside 0..659;
  - R5: page width 393 equals the window width 393;
  - R6: all controls ≥ 44 px;
  - R3: nothing overlaps the action bar.
- Viewport 659 / 741 / 659. `tap` and `fill` focus. `addCookies(url)` works; `clearCookies({ name })` is rejected,
  and the fallback `clearCookies()` removes the cookie. `shot()` writes the file.
- This confirms that the R1 failure in run 3 came from the old `absolute` probe on the smoke page, not from the
  harness.
- Redaction scan of the temporary HOME (929 files, `node_modules` excluded): 0 hits. No yml copy was left in the run
  folder.

## Still open

- ~~**The `report` note.**~~ Fixed: notes drop ANSI codes.
- ~~**The abort live check.**~~ Done in the staging run below.
- **`result.json` after an abort:** not written (see below).

## 12.11.2026 — first end-to-end run against a staging app

**Setup.**

- A clean Claude Code profile: its own `HOME` and `CLAUDE_CONFIG_DIR`. The plugin was installed from the marketplace,
  pinned to the feature branch (`owner/repo#branch`), and the installed copy was checked against the pushed commit.
- Setup followed the skill through the CLI: `install-workspace`, the settings file, `set-secret` on a pty with the
  password piped in from the secrets store (never on screen or in argv), then `local-state` and `doctor`.
- With no session bus, `set-secret` falls back to the mode-600 file in the profile; the system keyring stayed empty.
- BrowserStack: the same trial setup as above. The test yml has no credentials; they reach the CLI only through its
  child env. Same devices.
- One ticket, read only, with a status comment on staging. Registration up to the last step before the account is
  created, nothing submitted, no account created.

**Minutes.** Seven runs, ≈ 8.4 min in all:

| Run | Devices          | Minutes | Outcome                                                     |
| --- | ---------------- | ------- | ----------------------------------------------------------- |
| 1   | iPhone           | 1.1     | Failed: the device language was English (below)             |
| 2   | iPhone           | 1.5     | Failed: the spec, not the plugin                            |
| 3   | iPhone           | 0.5     | Failed: a tap on an element still fading in (below)         |
| 4   | iPhone           | 1.6     | All checks pass                                             |
| 5   | iPhone + Android | 2.1     | iPhone passes; Android shows two layout failures of the app |
| 6   | Android          | 1.1     | Re-check of one Android measurement                         |
| 7   | iPhone           | 0.5     | Abort probe                                                 |

**Found and fixed.**

- **The local gate session never reached the app hosts.**
  - The gate's `Set-Cookie` names the apex as `Domain`, without a leading dot (RFC 6265: subdomains included).
  - Playwright's storage state reads a domain without the dot as host-only, so the local browser was sent to the gate
    login on every app host.
  - The stored cookie now keeps the dot.
- **The iPhone runs in English.**
  - Playwright's `locale` has no effect there, and BrowserStack's `language`/`locale` capabilities need a paid plan.
  - An app that follows the browser language shows English.
  - The harness's `appCookie` fixture carries a language cookie of the app, seen on the local look, over to the
    confirmed host before the first navigation; with it, the device showed the tester's language.
- **`tap` on the iPhone does not auto-wait.** An element still fading in fails at once with "visibility:hidden";
  specs wait for `toBeVisible()` first.

**Hosts and tokens.** A run token opened both kinds of host:

- the unmarked branch host;
- the host marked with a site label: 200 with the token, 302 to the gate without it.

The ticket's flow exists only on the marked host, so the runs used it.

**Abort (SIGINT to the CLI mid-test, iPhone).**

- The CLI exited 6 s after the signal and cleaned the run folder; no token list or yml copy was left.
- BrowserStack ended the session (status `error`, 27 s): it was not left idling on the trial minutes.
- No SDK or Playwright process of the run was left.
- `result.json` was not written: the SDK group stops before the Playwright reporter writes it, so `report` has
  nothing to read after an abort.

**Redaction scan after the runs.** In-process search for the username, the key, their combined, base64,
URI-encoded and JSON-escaped forms, and the gate password:

| Place searched                                                                            | Files | Hits |
| ----------------------------------------------------------------------------------------- | ----- | ---- |
| Seven run folders                                                                         | 64    | 0    |
| The whole profile `HOME`, including the SDK's `~/.browserstack` (`node_modules` excluded) | 1000  | 0    |
| The streamed CLI output of every run                                                      | 7     | 0    |

Run tokens are masked from the run's own token list, which the clean pass deletes afterwards. They were checked
only by shape.
