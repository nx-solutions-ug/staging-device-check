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

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <command>`. If a command reports something as "fehlt", stop and
point her to `/staging-device-check:setup`.

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
3. Build the host from `hostPattern` exactly as the CLI does: `{project}` = the label in lower case; `{branch}` =
   lower case, `/` → `--`, every other character outside `a-z 0-9 -` → `-`; `{apexHost}` = the host of `apex`.
4. Show it and wait for her confirmation ("Ich teste auf `<host>` — stimmt das?").
5. Ask whether the branch has a live demo (the status comment may say so). With a live demo, login codes land in
   the demo's own mailbox: the run gets `--mailbox demo`, which the harness reads as `SDC_MAILBOX=demo`. Otherwise
   it uses the shared mailbox (default).

## 3. Look before writing (local, costs no minutes)

1. `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" local-state` for a fresh gate session. If the Playwright MCP was already
   running, it needs `/mcp` → reconnect to pick it up.
2. With the Playwright MCP (it starts at 393×852), open `https://<host>/` and the pages the ticket touches. Learn the
   steps, labels, roles and states from the live page. Record selectors and visible texts only — no cookies, no
   tokens, no page dumps in the chat.
3. If the host shows a provisioning page or a 404 instead of the app: the environment is not started. Tell her to
   open the branch once from the staging dashboard (the plugin never starts environments), and stop.

## 4. Write the test

`node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" prepare <TICKET> --host <host>` creates the run folder and prints it.
Write `tests-e2e.spec.ts` into that folder: **one `test` per persona** (one device session and one sign-in each),
and inside it **one `check('<Prüfung>', …)` per check**. `check()` is the harness's step: its title is the row of the
result section, and it owns everything about that row (the keyboard skip on iOS, the "zu prüfen" note), so title and
note can never drift apart.

```ts
import { check, evaluateWith, expect, test } from './harness/fixtures.js';

test.describe('Konto A (frau)', () => {
  test.use({ persona: 'frau' });

  test('Konto A (frau)', async ({ page, account, staging, shot, layout }) => {
    await account('A'); // first: signs in (quick login or mail code)
    await staging.goto('/registrierung/wohnort'); // only paths on the confirmed host

    await check('Wohnort-Schritt zeigt die Auswahl', async () => {
      await expect.soft(page.getByRole('heading', { name: 'Wohnort' })).toBeVisible();
    });

    await check('Weiter-Knopf bleibt im sichtbaren Bereich', async () => {
      for (const r of await layout({
        header: 'header',
        actionBar: '.bottom-bar',
        footer: '.bottom-bar',
      }))
        expect.soft(r.outcome, `${r.rule}: ${r.detail}`).not.toBe('nicht bestanden');
    });

    await check('Abstände wie im Entwurf', async ({ zuPruefen }) => {
      zuPruefen(await shot('Wohnort')); // the row says "zu prüfen (Bild)" and names the screenshot
    });

    // keyboard: true — on the iPhone this check is "nicht prüfbar hier" and its body is skipped;
    // on Android it runs. The persona's other checks run on both.
    await check(
      'Weiter-Knopf über der Tastatur',
      async () => {
        await page.getByLabel('Ort').tap();
        for (const r of await layout({
          header: 'header',
          actionBar: '.bottom-bar',
          keyboard: true,
        }))
          expect.soft(r.outcome, `${r.rule}: ${r.detail}`).not.toBe('nicht bestanden');
      },
      { keyboard: true },
    );
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
- Assert only with `expect.soft`, so a failing check does not stop the following ones.
- Navigate with `staging.goto(path)`; it refuses other hosts. Never set cookies yourself.
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
- Type with `pressSequentially` (on iOS, `keyboard.type` writes nothing).

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

1. `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" run <folder>`, plus `--mailbox demo` when step 2 said so, and
   `--devices iphone` / `--devices android` only if she wants one. If it refuses for the minutes, tell her the
   numbers; add `--confirm-minutes N` only after she agreed to that number.
2. "Umgebung nicht gestartet" in the output: the run stopped after the first test; tell her to open the branch once
   from the staging dashboard.
3. `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" report <folder> <TICKET>` writes `stand-abschnitt.md` and prints it. Show
   the section as it is, and the path of the `screenshots` folder. She checks the images marked "zu prüfen", then
   pastes the section into the status comment and attaches the images herself.

## Never

- Write to Jira, or post anything anywhere.
- Pay, buy or check out; run a staging action that was not on the confirmed list.
- Report a pass for anything the run did not measure, in particular the iOS keyboard.
- Show, store or pass on the staging password, the gate cookie, a run token or her BrowserStack credentials.
