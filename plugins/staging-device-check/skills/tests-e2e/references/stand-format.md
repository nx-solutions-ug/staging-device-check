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

Each check is one `test.step` inside the persona's test, titled with the check's wording; the step title becomes the
row of the result section.

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

`report` builds **one row per `test.step` and device** from the JSON report. With several persona tests, a row names
its persona test (`Konto A (frau): <Prüfung>`). The words, and what produces each:

| Word                   | Comes from                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bestanden**          | The step ran without a failed `expect.soft`. Only measured things count: presence, text, numbers, layout rules                                                                                                                                                       |
| **nicht bestanden**    | The step has a failed assertion. A failure outside every step (for example the sign-in) gets its own row `<Test>: Ablauf`. A whole test skipped without the "nicht prüfbar hier" annotation also counts as a failure ("übersprungen ohne Grund")                     |
| **zu prüfen (Bild)**   | `zuPruefen(<step>, <shot>)` in the step: the tester judges the named screenshot                                                                                                                                                                                      |
| **nicht prüfbar hier** | `nichtPruefbarHier(<step>, <reason>)` and `step.skip()` in the step, for example anything that needs the iOS keyboard. Only that step's row; the persona's other steps still run. A whole test is "nicht prüfbar hier" only when the harness skips it (demo mailbox) |

The Playwright JSON report keeps no annotations per step, so both helpers write a test annotation whose description
starts with the step title (`<step>: <rest>`). The title given to the helper must be exactly the step's title.

- Screenshot names: `<TICKET>_<device>_<persona>_<NN>-<step>.png`, in the run folder's `screenshots/`.
- Session videos are signed links: they stay in `result.json` and never go into the section.
