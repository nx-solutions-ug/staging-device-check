---
name: setup
description: Sets up staging-device-check once and changes single values later — Node and the test workspace, the settings file, the staging password in the keychain, the local gate session for the Playwright MCP, then the doctor check. Use when the tester runs /staging-device-check:setup, asks to set up or change the device tests, or when doctor or a run reports something as "fehlt".
---

# Setup for device tests on staging

Talk to the tester in German, one question at a time. Nothing secret goes through the chat: not the staging
password, not the gate cookie, not the BrowserStack credentials. Never read, print or copy her `browserstack.yml`;
the CLI checks it in-process.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <command>`. Run it with the Bash tool, except `set-secret`
(step 3).

## 1. Node and the test workspace

1. `node --version` must be 26 or newer. Otherwise tell her to install the current Node and come back.
2. `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" install-workspace` copies the Playwright workspace to her data folder and
   runs `npm ci` there (needs the network, takes a minute). It prints the folder.

## 2. Settings (no secrets)

Ask for each value; for a re-run, show the current value and change only what she names.

| Key                                                                | What she gives                                                                                    | Example (invented)                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apex`                                                             | the staging main address, `https://…`                                                             | `https://staging.example.test`                                                                                  |
| `hostPattern`                                                      | how app hosts are built, with `{project}`, `{branch}`, `{apexHost}`                               | `app-{project}--{branch}.{apexHost}`                                                                            |
| `projects`                                                         | project name → host label                                                                         | `{ "Example Shop": "example-shop" }`                                                                            |
| `browserstackYml`                                                  | absolute path to her `browserstack.yml`                                                           | `/Users/tester/browserstack/browserstack.yml`                                                                   |
| `accounts`                                                         | test accounts: `label`, `email`, `persona`, `project` (a host label), `login` (`quick` or `code`) | `{ "label": "A", "email": "qa+a@example.test", "persona": "frau", "project": "example-shop", "login": "code" }` |
| `jiraSite`                                                         | her Jira site                                                                                     | `example.atlassian.test`                                                                                        |
| `standMarker`                                                      | first word of the status comment (default `Stand`)                                                | `Stand`                                                                                                         |
| `perRunMinutes`, `warnBelowMinutes`, `planMinutes`, `tokenMinutes` | budget values; keep the defaults 6, 20, 100, 20 unless she wants others                           |                                                                                                                 |

`login: quick` means the account is on the host's quick-login list; `code` means sign-in by mail code.

Write the file as JSON to the path this prints, then make it private:

```bash
f="${XDG_CONFIG_HOME:-$HOME/.config}/staging-device-check/config.json"; mkdir -p "$(dirname "$f")"; echo "$f"
```

After writing it: `chmod 600` on the file. `doctor` (step 5) validates it and names a wrong field in German.

## 3. Staging password — in her own terminal, never in the chat

`set-secret` reads the password with hidden input and needs a real terminal. Claude Code's `!` prefix does not give
the command one: its output goes into the conversation, and the CLI refuses ("set-secret braucht ein Terminal").
So tell her, in German:

1. Open the Terminal app (a separate window, not this chat).
2. Paste exactly this command and press Enter (write it out with the path filled in):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" set-secret
   ```

3. Type the staging password twice; nothing appears while typing. It must be at least 16 characters.
4. Come back and say "fertig". The terminal shows only `gespeichert (Schlüsselbund)` or `gespeichert (Datei)`.

If she types or pastes the password into the chat anyway: do not repeat it, do not use it, and tell her that it is
now in the transcript and must be changed by whoever runs the staging system; then repeat the steps above with the
new one.

## 4. Gate session for the local browser

`node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" local-state` logs in to the staging gate on this machine and writes the
session for the Playwright MCP (mode 600). It prints only how long it is valid. The Playwright MCP reads it when it
starts: if the MCP was already running, tell her to reconnect it with `/mcp` (or restart Claude Code). Run
`local-state` again when it has expired.

## 5. Check

`node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" doctor` prints one line per check, `ok`, `fehlt` or `hinweis`.

- No `fehlt`: say "Bereit — du kannst jetzt `/tests-e2e <TICKET>` aufrufen."
- Otherwise: list each `fehlt` line with what to do, in plain German, and offer to go through that step again.
- `hinweis` lines (for example a `browserstack.yml` inside a git folder, or few minutes left) are worth reading
  out, but do not block.
