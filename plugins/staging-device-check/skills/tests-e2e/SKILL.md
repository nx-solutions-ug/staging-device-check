---
name: tests-e2e
description: Tests what a Jira ticket delivered on real phones (iPhone and Android on BrowserStack) against the ticket's app host on staging, and writes the German result section for the ticket's status comment. Use when the tester runs /tests-e2e <TICKET> or says something like "teste ABC-123 auf echten Handys", "Gerätetest für ABC-123" or "prüf das Ticket auf dem iPhone".
argument-hint: <TICKET>
---

# Device test for one ticket

Ticket: `$ARGUMENTS`. It must look like `ABC-123`; otherwise ask for it.

Talk to the tester in German. Read these before writing the test: `references/stand-format.md` (the status
comment and the result section), `references/layout-rules.md`, `references/ios-limits.md`, `references/safety.md`.
The safety rules win over everything below.

The CLI is `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" <command>`. If a command reports something as "fehlt", stop and
point her to `/staging-device-check:setup`.

**Settings:** `${XDG_CONFIG_HOME:-$HOME/.config}/staging-device-check/config.json` (`jiraSite`, `standMarker`,
`projects`, `accounts`, `hostPattern`, `apex`). Read that file when a step needs a value; it holds no secrets, but
never open or print her `browserstack.yml`. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" doctor` shows whether the setup
is complete.

## 1. Read the ticket (read only)

With her Atlassian tools, on the Jira site from the settings: description, acceptance criteria / "Done when",
attachments (design screenshots), and the **latest comment whose first line starts with the status marker**
(`standMarker`, default "Stand"). Its table is the main source of what to check.

- No such comment: say there is nothing delivered to check yet, and stop.
- Its stage line says `✖ auf Staging`: say the change is not on staging yet, and stop.
- Never write to Jira: no comment, no transition, no attachment. She posts the result herself.

## 2. Pick the host and confirm it

1. Project: from the ticket, or ask. Its host label comes from `projects` in the settings.
2. Branch: `main` when the stage line says `übernommen ✅ · auf Staging ✅` and nothing names a branch. A branch name
   comes from the ticket's development panel or from her, never guessed.
3. Build the host with the CLI, never by hand:
   `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" host <project name or label> [<branch>]` prints it (branch default
   `main`).
4. Show it and wait for her confirmation ("Ich teste auf `<host>` — stimmt das?").
5. Ask whether the branch has a live demo (the status comment may say so). With a live demo, login codes land in
   the demo's own mailbox: the run gets `--mailbox demo`, which the harness reads as `SDC_MAILBOX=demo`. Otherwise
   it uses the shared mailbox (default).

## 3. Look before writing (local, costs no minutes)

1. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" local-state` for a fresh gate session. If the Playwright MCP was already
   running, it needs `/mcp` → reconnect to pick it up.
2. With the Playwright MCP (it starts at 393×852), open `https://<host>/` and the pages the ticket touches. Learn the
   steps, labels, roles and states from the live page. Record selectors and visible texts only — no tokens, no page
   dumps in the chat, and of the cookies only the name and value of a language preference the page can read (step
   4, "Language").
3. If the host shows a provisioning page or a 404 instead of the app: the environment is not started. Tell her to
   open the branch once from the staging dashboard (the plugin never starts environments), and stop.
4. Look under the conditions the phones bring, before any minute is spent:
   - **Late consent banner.** On the first page, wait at least 10 seconds: on phones the cookie banner appears seconds
     after load. Note the exact label of its most privacy-preserving button ("only necessary", "decline"). It goes
     into the spec as `test.use({ consentButton: '<label>' })`, unless the settings already name one for this
     project (`consentButtons`, which wins). No banner → no option.
   - **Narrow phones.** Walk the steps at 393 px and at 360 px wide (`browser_resize`): what wraps, what moves.
   - **Keyboard open.** For every step with a text field, focus it and shrink the window by about 300 px in height
     (the room an on-screen keyboard takes): which elements, suggestions or buttons end up hidden. A check about it
     needs the real keyboard (`{ keyboard: true }`); the next `tap()` closes the keyboard again.
   - The selectors that stay true in all three, and the condition that tells each step apart (a heading, a field),
     go into the spec — never a fixed wait.

## 4. Write the test

`sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" prepare <TICKET> --host <host>` creates the run folder and prints it.
Write `tests-e2e.spec.ts` into that folder: **one `test` per persona** (one device session and one sign-in each),
and inside it **one `check('<Prüfung>', …)` per check**. `check()` is the harness's step: its title is the row of the
result section, and it owns everything about that row (the keyboard skip on iOS, the "zu prüfen" note), so title and
note can never drift apart.

```ts
import { check, expect, test } from './harness/fixtures.js';

test.describe('Konto A (frau)', () => {
  // the consent banner's most privacy-preserving button, as the local look showed it
  test.use({ persona: 'frau', consentButton: 'Nur notwendige' });

  test('Konto A (frau)', async ({ page, account, staging, shot, layout, tap, typeInto }) => {
    await account('A'); // first: signs in (quick login or mail code)
    await staging.goto('/registrierung/wohnort'); // only paths on the confirmed host; dismisses the banner

    await check('Wohnort-Schritt zeigt die Auswahl', async () => {
      await expect.soft(page.getByRole('heading', { name: 'Wohnort' })).toBeVisible();
    });

    await check('Weiter-Knopf bleibt im sichtbaren Bereich', async () => {
      const rules = await layout({
        header: 'header',
        actionBar: '.bottom-bar',
        footer: '.bottom-bar',
      });
      for (const id of ['R1', 'R3', 'R4']) {
        const r = rules.find((x) => x.rule === id);
        expect.soft(r?.outcome, `${id}: ${r?.detail ?? 'nicht gemessen'}`).toBe('bestanden');
      }
    });

    await check('Abstände wie im Entwurf', async ({ zuPruefen }) => {
      zuPruefen(await shot('Wohnort'), 'Abstände prüfen'); // "zu prüfen (Bild)", the image by its number
    });

    // typeInto: fill, then the native setter, then typing — until the app shows it noticed
    const suggestions = page.getByRole('option');
    await typeInto('[role=combobox]', '10115', {
      until: () =>
        suggestions
          .first()
          .waitFor({ state: 'visible', timeout: 1_000 })
          .then(
            () => true,
            () => false,
          ),
    });

    // keyboard: true — on the iPhone this check is "nicht prüfbar hier" and its body is skipped;
    // on Android it measures with the keyboard open. The persona's other checks run on both.
    await check(
      'Weiter-Knopf über der Tastatur',
      async () => {
        const rules = await layout({ header: 'header', actionBar: '.bottom-bar', keyboard: true });
        const r4 = rules.find((x) => x.rule === 'R4');
        expect.soft(r4?.outcome, `R4: ${r4?.detail ?? 'nicht gemessen'}`).toBe('bestanden');
      },
      { keyboard: true },
    );

    await tap(suggestions.first(), { keepKeyboard: true }); // picks a suggestion with the keyboard still open
    await tap(page.getByRole('button', { name: 'Weiter' })); // closes the keyboard first, then taps
    await expect(page.getByRole('heading', { name: 'Konto' })).toBeVisible(); // the next step, not a wait
  });
});
```

Rules for the spec:

- **One `test` per persona**, titled with the account and persona as fixed text. `await account('<label>')` comes
  first, with a label from the settings. Several personas → several tests; never one test per check (each test is a
  new device session and a new sign-in, and mail codes are limited to one per minute and five per hour).
- **Each check is `check('<Prüfung>', body, opts?)`**, its title fixed text in the ticket's wording. No raw
  `test.step`: `run` refuses it, and it reads the planned check titles from the spec before the run, so a check that
  never ran (after a hard failure) still gets its row ("nicht bestanden — nicht gelaufen").
- Assert only with `expect.soft`, so a failing check does not stop the following ones. Assert the **concrete
  outcome** of the rules the check is about (`toBe('bestanden')` for each named rule), never just "not failed": a
  rule that was not measured must not count as a pass.
- `check()` fails closed on iOS: when `layout()` inside it measured nothing or returned "nicht prüfbar hier", the
  check is "nicht prüfbar hier" there, even without `{ keyboard: true }`. A real failure wins: any other failed
  assertion in the same check (a missing element, a wrong text) makes it "nicht bestanden".
- Navigate with `staging.goto(path)`; it refuses other hosts. Never set sign-in, session or gate cookies.
- **Language.** BrowserStack's iPhone runs in English and ignores Playwright's `locale`.
  - If the local look shows that the app keeps its language in a cookie of its own (readable by the page, set on
    the first visit, a short value such as `de`), carry it over with the `appCookie` fixture before the first
    navigation: `await appCookie('<name>', '<value>')`. The device then shows the tester's language, and text
    checks stay possible.
  - Without such a cookie: select by role, id or structure, not by visible text. A check that can only compare
    texts is "nicht prüfbar hier (Gerätesprache)" on the iPhone; say so in the list and in the section.
- Map the status table: every `✅ da` row → a check; every `⚠️ abweichend` row → a check against the described
  deviation, not the original ticket text; `✖` rows → only listed as "nicht in diesem Ticket", no check.
- Each check is one of:
  - **automatic** — asserted with `expect.soft`: presence, text, viewport numbers, the layout rules (`layout()`, see
    `references/layout-rules.md`);
  - **visual** — `zuPruefen(await shot('<name>'))` with the `zuPruefen` that `check` hands the body: the row says
    "zu prüfen (Bild)" and names the screenshot, never a pass;
  - **needs the iOS keyboard** — `check(title, body, { keyboard: true })`: "nicht prüfbar hier" on the iPhone, run
    on Android. Never skip the whole test for it.
- A whole-test skip is only for the demo mailbox case, which the harness handles in `account()`; its checks then
  read "nicht prüfbar hier". A skip without that annotation is reported as "nicht bestanden".
- **Never** `page.evaluate(fn, arg)`, `$eval(sel, fn, arg)`, `evaluateAll(fn, arg)` or `waitForFunction(fn, arg)`
  with an argument: BrowserStack's iPhone driver drops it. Use `evaluateWith(page, fn, arg)` from the harness;
  calls without an argument are fine. `run` refuses a spec that breaks this.
- **Tap only with `tap(locator)`, type only with `typeInto('<CSS selector>', value, { until })`** — the fixtures
  from the harness. `run` refuses a spec with a raw `.tap()`, `.fill()` or `.pressSequentially()`.
  - `tap` dismisses a late consent banner, closes the on-screen keyboard (on Android it covers the bottom button and
    taps land beside it), waits until the target is visible and enabled, then taps. To pick a suggestion while the
    keyboard stays open: `tap(option, { keepKeyboard: true })`.
  - `typeInto` tries `fill`, then the native value setter, then typing character by character, and stops at the
    first one the app noticed. Give it `until`: what the app does when it got the value (suggestions visible,
    "Weiter" enabled). Without it, only the field's own value is read back.
  - A check that needs the keyboard open measures first; the next `tap()` closes it, or `closeKeyboard()` when
    nothing is tapped next.
- **No fixed waits** (`waitForTimeout`): wait for what tells the next state apart — a heading, a field, a button
  (`await expect(…).toBeVisible()`, `expect.poll`). `layout()` waits by itself until the page is at rest (entry
  animations done), at most about 3 s; a page that does not come to rest is "nicht bestanden", never a pass.
- A step that reveals itself piece by piece (a typing indicator, content fading in one after another): wait for
  its end — the indicator hidden (`expect.poll` on an in-page check) — before a screenshot or a text check;
  `layout()` already waits for every element it measures to be shown.
- `staging.goto` waits up to 20 s for the consent banner on the test's first navigation and dismisses it; every
  `tap`, `layout()` and `shot()` looks for it once more. This needs the `consentButton` option (step 3).
- **Messages are sentences for the tester.** The message of an `expect.soft` is what the row's note shows (without
  `Error:`), so write a short German sentence about the app: `Abstand Hinweis → Knopf ${gap} px`, not `gap`. For a
  list, join only what is wrong; parts that say just `ok` are dropped. Playwright's own texts become a short
  sentence plus "(Details im Log)".

## 5. The list before any minutes are spent

Show her, in German, and wait for an explicit yes:

- the host, and whether the demo mailbox is used;
- every check in plain language with its kind (automatisch / Bild / nicht prüfbar hier) and every `✖` row;
- the accounts and personas;
- **every action on staging** in words ("sendet eine Nachricht von Konto A an Konto B", "legt ein neues Testkonto
  qa+…@… an") — nothing else may happen;
- the devices (by default one iPhone and one Android phone from her `browserstack.yml`);
- the estimate: persona tests × devices × 1,5 Minuten.

She may drop or add checks; then show the list again. Hard stops, even with her yes: payments, checkout, coin or
premium purchases, anything that would send mail outside staging.

## 6. Run and report

1. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" run <folder>`, plus `--mailbox demo` when step 2 said so, and
   `--devices iphone` / `--devices android` only if she wants one. If it refuses for the minutes, tell her the
   numbers; add `--confirm-minutes N` only after she agreed to that number.
   - A run takes several minutes. Start it with the Bash tool in the background (`run_in_background: true`), never a
     plain call: that one is cut off after 2 minutes, mid-run. Without background runs, give the call a timeout of
     600000 ms.
   - Then wait for its completion notice — no polling, no `sleep` — and read its output and exit code. While it
     runs, tell her it is running and on which devices.
2. "Umgebung nicht gestartet" in the output: the run stopped after the first test; tell her to open the branch once
   from the staging dashboard.
3. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" report <folder> <TICKET>` writes `stand-abschnitt.md` and prints it. Show
   the section as it is, and the path of the `screenshots` folder. She checks the images marked "zu prüfen", then
   pastes the section into the status comment and attaches the images herself.

## Never

- Write to Jira, or post anything anywhere.
- Pay, buy or check out; run a staging action that was not on the confirmed list.
- Report a pass for anything the run did not measure, in particular the iOS keyboard.
- Show, store or pass on the staging password, the gate cookie, a run token or her BrowserStack credentials.
