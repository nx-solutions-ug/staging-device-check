# The status comment ("Stand") and the result section

## Reading the status comment

The ticket's status comment is recognised by its first line. There is one per ticket; take the latest version.

1. **Header**, bold: `Stand TT.MM.JJJJ, HH:MM – <one sentence>`. The marker word comes from the setting
   `standMarker`.
2. **Stage line**, always three stages: `✅ gebaut · ✅ übernommen · ✅ auf Staging`.
   - `auf Staging ✅` means testable there.
   - `✖ auf Staging` means "bitte noch nicht testen": stop.
3. One sentence to the reviewer.
4. **Table** `| Element | Status | Hinweis |`. Each status is one of:
   - `✅ da`;
   - `⚠️ abweichend`;
   - `✖ nicht in diesem Ticket` (often naming the follow-up ticket).
5. **"Abweichungen und Annahmen":** a list explaining the ⚠️ and ✖ rows.
6. From the second version on, **"Geändert seit dem letzten Stand"** (at most three lines).

The comment carries no paths, links to code or branch names. The branch therefore comes from the ticket's
development panel or from the tester. The default is `main` when the stage line says
`übernommen ✅ · auf Staging ✅`.

## Mapping rows to checks

Each check is one `check('<Prüfung>', …)` (a step) inside the persona's test, titled with the check's wording; that
title becomes the row of the result section.

| Row status                 | What the test does                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `✅ da`                    | One step for what the row promises, in the ticket's wording                        |
| `⚠️ abweichend`            | One step against the **described deviation**, not against the original ticket text |
| `✖ nicht in diesem Ticket` | No step. Listed before the run and in the section as "nicht in diesem Ticket"      |

The ticket's "Done when" / acceptance criteria add steps where the table does not cover them.

## The result section (written by `report`)

`report` turns `result.json` into `stand-abschnitt.md`. The tester pastes it into the status comment herself.

```markdown
**Gerätetest 12.11.2026 – app-example-shop--main, iPhone 16, Samsung Galaxy S23**

| Prüfung                           | iPhone             | Android          | Hinweis                                              |
| --------------------------------- | ------------------ | ---------------- | ---------------------------------------------------- |
| Wohnort-Schritt zeigt die Auswahl | bestanden          | bestanden        | —                                                    |
| Abstände wie im Entwurf           | zu prüfen (Bild)   | zu prüfen (Bild) | ABC-1_…_01-wohnort.png                               |
| Weiter-Knopf über der Tastatur    | nicht prüfbar hier | bestanden        | iPhone: Tastatur auf iOS — auf eigenem iPhone prüfen |

Bilder zum Anhängen:

- ABC-1_…_01-wohnort.png

Auf dem eigenen iPhone prüfen: Weiter-Knopf über der Tastatur
```

`report` builds **one row per check and device** from the JSON report and the planned checks `run` stored in
`run.json`. With several persona tests, a row names its persona test (`Konto A (frau): <Prüfung>`). The words, and
what produces each:

| Word                   | Comes from                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **bestanden**          | The check ran without a failed `expect.soft`. Only measured things count: presence, text, numbers, layout rules                                                                                                                                                                                                                                                                            |
| **nicht bestanden**    | The check has a failed assertion; or it was planned and **nicht gelaufen** (a hard failure earlier ended the test). A failure outside every check (for example the sign-in), or a note that matches no check, gets its own row `<Test>: Ablauf`. A whole test skipped without the "nicht prüfbar hier" annotation also counts as a failure ("übersprungen ohne Grund")                     |
| **zu prüfen (Bild)**   | `zuPruefen(<shot>)` in the check: the tester judges the named screenshot                                                                                                                                                                                                                                                                                                                   |
| **nicht prüfbar hier** | `check(…, { keyboard: true })` on the iPhone, or a persona the harness skipped as a whole (demo mailbox). Only that check's row; the persona's other checks still run                                                                                                                                                                                                                      |
| **abgebrochen**        | Only after a run stopped before its end (`run.json` `aborted`: "Strg+C", "Umgebung nicht gestartet", or "sofort beendet" after a hard stop; or "Test unterbrochen" when a test was interrupted): the check that was running and every planned check after it. A test that had already ended with a real failure keeps it. The first line then ends "– abgebrochen (<Grund>)". Never a pass |

Internal errors of the device service (its local socket or gRPC connection, for example `14 UNAVAILABLE … sdk-platform-….sock`) never appear in a row: the note says "interner Fehler des Gerätedienstes (Details im Log)", and `report` prints the original text to stderr.

`check()` writes its notes as test annotations whose description starts with the check's title (`<Prüfung>: <rest>`),
because the Playwright JSON report keeps no annotations per step.

- Screenshot names: `<TICKET>_<device>_<persona>_<NN>-<step>.png`, in the run folder's `screenshots/`.
- Session videos are signed links: they stay in `result.json` and never go into the section.
