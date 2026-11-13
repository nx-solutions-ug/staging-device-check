---
name: setup
description: Sets up staging-device-check once and changes single values later — the plugin's own Node and the test workspace, the settings file, the staging password in the keychain, the local gate session for the Playwright MCP, then the doctor check. Use when the tester runs /staging-device-check:setup or says something like "Gerätetest einrichten", "Gerätetests einrichten" or "Einstellungen für den Gerätetest ändern", or when doctor or a run reports something as "fehlt".
---

# Setup for device tests on staging

Talk to the tester in German, one question at a time. Nothing secret goes through the chat: not the staging
password, not the gate cookie, not the BrowserStack credentials. Never read, print or copy her `browserstack.yml`;
the CLI checks it in-process.

The CLI is `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" <command>`: it runs on the plugin's own Node (step 1). Run it with
the Bash tool. She never needs to install Node or open a terminal for the setup.

## 1. The plugin's own Node and the test workspace

1. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/install-node.sh"` installs the Node release the plugin pins into her data
   folder: checked against its pinned checksum, no administrator rights, no change to her shell. It needs the
   network once and prints the path of `node`; when that version is already there, it keeps it. A German error
   (no network, checksum, unsupported system) is read out as it is; nothing is half installed.
2. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" install-workspace` copies the Playwright workspace to her data folder and
   runs `npm ci` there with that Node (needs the network, takes a minute). It prints the folder.

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

Optional: `consentButtons`, host label → the exact text of the consent banner's most privacy-preserving button
(`{ "example-shop": "Nur notwendige" }`). Only when she wants it fixed for a project; otherwise each device test takes
the label from its local look. An entry here wins over that.

Write the file as JSON to the path this prints, then make it private:

```bash
f="${XDG_CONFIG_HOME:-$HOME/.config}/staging-device-check/config.json"; mkdir -p "$(dirname "$f")"; echo "$f"
```

After writing it: `chmod 600` on the file. `doctor` (step 5) validates it and names a wrong field in German.

## 3. Staging password — in a dialog, never in the chat

1. Tell her, in German, that a small window asks for the staging password, twice, and that the typing stays
   invisible. Then run, with a Bash timeout of 600000 ms (the dialog waits for her):

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/ask-password.sh"
   ```

   - On a Mac it is a system dialog; on a Linux desktop kdialog (KDE) or zenity (GNOME). The value goes straight
     into the keychain (Mac) or the desktop's password manager (KWallet, GNOME Keyring); it never appears in the
     chat or in the output.
   - It prints only `gespeichert (Schlüsselbund)` — or `gespeichert (Datei)` where no password manager answers —
     or a German message: "Abgebrochen. Nichts gespeichert." when she cancelled, "zu kurz" (at least 16
     characters) or "stimmten nicht überein", where the dialog simply asks again. A window nobody answers closes
     after 5 minutes and counts as cancelled: nothing stored; run the step again when she is ready.

2. **Only when it exits with code 3** (no dialog here: no screen, no dialog program, or on a Mac no GUI session):
   the terminal path. Tell
   her to open her own terminal window (not this chat), paste exactly this command with the path filled in, type
   the password twice and come back with "fertig":

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" set-secret
   ```

   Claude Code's `!` prefix does not give `set-secret` a terminal; it refuses there.

If she types or pastes the password into the chat anyway: do not repeat it, do not use it, and tell her that it is
now in the transcript and must be changed by whoever runs the staging system; then repeat the step above with the
new one.

## 4. Gate session for the local browser

`sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" local-state` logs in to the staging gate on this machine and writes the
session for the Playwright MCP (mode 600). It prints only how long it is valid. The Playwright MCP reads it when it
starts: if the MCP was already running, tell her to reconnect it with `/mcp` (or restart Claude Code). Run
`local-state` again when it has expired.

## 5. Check

1. **Jira lesbar:** with her Atlassian tools, read one issue on the `jiraSite` from the settings (for example the
   most recently updated issue she can see). Only read; never write. If that fails, the Jira connection is missing
   or points to another site: tell her to connect Atlassian in Claude Code (`/mcp`) and to check `jiraSite`. Report
   it as "fehlt Jira".
2. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/sdc" doctor` prints one line per check, `ok`, `fehlt` or `hinweis`.

- No `fehlt` (Jira included): say "Bereit". On the first setup, add that the local browser (the Playwright MCP)
  can only start now that the plugin has its own Node: she should restart Claude Code once (or reconnect the
  server via `/mcp`) before `/tests-e2e <TICKET>`.
- Otherwise: list each `fehlt` line with what to do, in plain German, and offer to go through that step again.
- `hinweis` lines (for example a `browserstack.yml` inside a git folder, or few minutes left) are worth reading
  out, but do not block.
