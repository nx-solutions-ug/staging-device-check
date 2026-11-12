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

| Row status                 | What the test does                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `✅ da`                    | One check for what the row promises, in the ticket's wording                        |
| `⚠️ abweichend`            | One check against the **described deviation**, not against the original ticket text |
| `✖ nicht in diesem Ticket` | No check. Listed before the run and in the section as "nicht in diesem Ticket"      |

The ticket's "Done when" / acceptance criteria add checks where the table does not cover them.

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

The result words, and what produces each:

| Word                   | Comes from                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **bestanden**          | The test passed. Only measured things count: presence, text, numbers, layout rules                                                    |
| **nicht bestanden**    | The test failed. A skip without the "nicht prüfbar hier" annotation also counts as a failure, with the note "übersprungen ohne Grund" |
| **zu prüfen (Bild)**   | The test passed and carries a `'zu prüfen'` annotation: the tester judges the screenshot                                              |
| **nicht prüfbar hier** | The test was skipped with a `'nicht prüfbar hier'` annotation, for example anything that needs the iOS keyboard                       |

- Screenshot names: `<TICKET>_<device>_<persona>_<NN>-<step>.png`, in the run folder's `screenshots/`.
- Session videos are signed links: they stay in `result.json` and never go into the section.
