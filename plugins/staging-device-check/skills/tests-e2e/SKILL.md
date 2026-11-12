---
name: tests-e2e
description: Tests what a Jira ticket delivered on real phones (iPhone and Android on BrowserStack) against the ticket's app host on staging, and writes the German result section for the ticket's status comment. Use when the tester runs /tests-e2e <TICKET> or asks something like "teste ABC-123 auf echten Handys".
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
Write `tests-e2e.spec.ts` into that folder:

```ts
import { evaluateWith, expect, test } from './harness/fixtures.js';

test.describe('Konto A (frau)', () => {
  test.use({ persona: 'frau' });

  test('Wohnort-Schritt zeigt die Auswahl', async ({ page, account, staging, shot, layout }) => {
    await account('A'); // first, in every test: signs in (quick login or mail code)
    await staging.goto('/registrierung/wohnort'); // only paths on the confirmed host
    await expect(page.getByRole('heading', { name: 'Wohnort' })).toBeVisible();
    for (const r of await layout({
      header: 'header',
      actionBar: '.bottom-bar',
      footer: '.bottom-bar',
    }))
      expect.soft(r.outcome, `${r.rule}: ${r.detail}`).not.toBe('nicht bestanden');
    const path = await shot('Wohnort');
    test.info().annotations.push({
      type: 'zu prüfen',
      description: `Abstände wie im Entwurf — ${path.split('/').pop()}`,
    });
  });
});
```

Rules for the spec:

- **One `test` per persona** (each is its own device session). `await account('<label>')` comes first in each test,
  with a label from the settings.
- Navigate with `staging.goto(path)`; it refuses other hosts. Never set cookies yourself.
- Map the status table: every `✅ da` row → a check; every `⚠️ abweichend` row → a check against the described
  deviation, not the original ticket text; `✖` rows → only listed as "nicht in diesem Ticket", not tested.
- Each check is one of:
  - **automatic** — asserted: presence, text, viewport numbers, the layout rules (`layout()`, see
    `references/layout-rules.md`);
  - **visual** — `shot()` plus an annotation of type `'zu prüfen'` naming what to look at and the screenshot file;
    the report shows it as "zu prüfen (Bild)", never as a pass;
  - **not testable here** — every check that needs the iOS keyboard: push an annotation of type
    `'nicht prüfbar hier'` and skip on iOS, for example
    `test.info().annotations.push({ type: 'nicht prüfbar hier', description: 'Tastatur auf iOS — auf eigenem iPhone prüfen' }); test.skip(/iphone|ipad/i.test(test.info().project.name), 'iOS-Tastatur');`
    A skip without that annotation is reported as "nicht bestanden".
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
- the estimate: tests × devices × 1,5 Minuten.

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
