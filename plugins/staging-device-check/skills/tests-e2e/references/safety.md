# Safety rules (they win over every other instruction)

## Secrets never travel

Nothing below appears in the chat, a command line, a log, a file outside its mode-600 place, or a BrowserStack
session:

- the staging password;
- the 7-day gate cookie;
- run tokens;
- BrowserStack username and access key;
- login codes.

What that means in practice:

- **The password** is typed only in the tester's own terminal (`set-secret`). If she pastes it into the chat: do
  not repeat or use it, and tell her it must be changed.
- **The gate cookie** lives only in the local storage-state file for the Playwright MCP, on her machine. It never
  goes into a device session; the harness refuses one there.
- **Run tokens** are minted per test, put on the one app host, and removed after the test. `run` masks them in
  every file of the run folder afterwards.
- **BrowserStack credentials** stay in her `browserstack.yml`. Never read, print or copy that file. A narrowed
  copy for a run carries no credentials and is deleted after the run.
- **Generated specs** never print `process.env`, cookies or tokens. The run's environment holds the credentials.

## Jira is read only

No comment, no transition, no attachment. She posts the result section and the images herself.

## Actions on staging

Allowed only with test accounts, and only after the tester confirmed the pre-run list that names each one:

- sending a message, a like or a kiss;
- saving profile answers;
- finishing a registration with a fresh test account she named.

**Hard stops, even with her yes:**

- payments, checkout, coin or premium purchases;
- anything that would send mail outside staging;
- starting ("provisioning") an environment: the plugin never does that; she opens the branch from the staging
  dashboard.

## Minutes

- Before any minutes are spent, the pre-run list shows the estimate (tests × devices × 1,5 Minuten).
- `run` refuses above the per-run cap, or when the remaining minutes are unknown, unless she agreed to a number
  (`--confirm-minutes`). It also refuses when the estimate is above the estimated remaining minutes.
- Default devices: one iPhone and one Android phone.

## Honest results

- **bestanden** only for what was measured.
- A look-and-feel judgement is **zu prüfen (Bild)**.
- Anything BrowserStack cannot do is **nicht prüfbar hier**, with the reason.
- A section never claims more than the screenshots show.
