#!/bin/sh
# Asks for the staging password in a native dialog — macOS: osascript, Linux: kdialog, else zenity — and pipes it
# straight into `set-secret --stdin`, which stores it in the keychain (macOS) or the Secret Service (KWallet,
# GNOME Keyring). The value is never on argv, in a file, on stdout or stderr: it lives only in this shell's memory
# and goes through printf (a shell builtin) into the pipe. Prints only set-secret's "gespeichert (…)" line.
# Exit 3: no dialog here (no display, or no dialog program) — use the terminal path, `set-secret`.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
title='Staging Device Check'
# a dialog nobody answers counts as cancelled after this many seconds
limit=${SDC_DIALOG_TIMEOUT:-300}

case "${SDC_DIALOG_SYSTEM:-$(uname -s)}" in
  Darwin) kind=osascript ;;
  *)
    kind=
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
      if command -v kdialog >/dev/null 2>&1; then
        kind=kdialog
      elif command -v zenity >/dev/null 2>&1; then
        kind=zenity
      fi
    fi
    ;;
esac
if [ -z "$kind" ]; then
  echo "Hier gibt es keinen Passwort-Dialog (kein Bildschirm oder weder kdialog noch zenity). Bitte im eigenen Terminal: sh \"$here/sdc\" set-secret" >&2
  exit 3
fi

# Runs a dialog program, ended after `$1` seconds where `timeout` exists (exit 124).
limited() {
  seconds=$1
  shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"; else "$@"; fi
}

# One hidden entry; prints it, or fails when the dialog was cancelled, timed out or could not open.
ask() {
  case "$kind" in
    osascript)
      # osascript gives up by itself after `limit`; the outer limit only catches a hung osascript
      limited "$((limit + 10))" osascript - "$1" "$title" "$limit" <<'APPLESCRIPT'
on run argv
  set r to display dialog (item 1 of argv) with title (item 2 of argv) default answer "" with hidden answer buttons {"Abbrechen", "Speichern"} default button "Speichern" cancel button "Abbrechen" giving up after ((item 3 of argv) as integer)
  if gave up of r then error number -128
  return text returned of r
end run
APPLESCRIPT
      ;;
    kdialog) limited "$limit" kdialog --title "$title" --password "$1" ;;
    zenity) limited "$((limit + 10))" zenity --password --title "$title — $1" --timeout="$limit" ;;
  esac
}

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
trap 'exit 130' INT TERM HUP

# A dialog that did not return a value: osascript failing for another reason than its cancel (-128) means there is
# no GUI session (for example over SSH): the terminal path. Everything else, timeouts included, is a cancel.
failed() {
  if [ "$kind" = osascript ] && [ "$1" -ne 124 ] && ! grep -q -- '(-128)' "$errors"; then
    echo "Der Passwort-Dialog lässt sich hier nicht öffnen (keine Bildschirm-Sitzung). Bitte im eigenen Terminal: sh \"$here/sdc\" set-secret" >&2
    exit 3
  fi
  if [ "$1" -eq 124 ] || [ "$1" -eq 5 ]; then
    echo "Keine Eingabe innerhalb von $limit Sekunden — abgebrochen. Nichts gespeichert." >&2
  else
    echo "Abgebrochen. Nichts gespeichert." >&2
  fi
  exit 1
}

prompt='Staging-Passwort (mindestens 16 Zeichen):'
tries=0
while :; do
  tries=$((tries + 1))
  if [ "$tries" -gt 3 ]; then
    echo "Dreimal keine passende Eingabe. Nichts gespeichert." >&2
    exit 1
  fi
  first=$(ask "$prompt" 2>"$errors") && status=0 || status=$?
  if [ "$status" -ne 0 ]; then
    first=
    failed "$status"
  fi
  if [ "${#first}" -lt 16 ]; then
    first=
    prompt='Das war kürzer als 16 Zeichen — bitte das Staging-Passwort eingeben:'
    continue
  fi
  second=$(ask 'Bitte zur Bestätigung noch einmal eingeben:' 2>"$errors") && status=0 || status=$?
  if [ "$status" -ne 0 ]; then
    first=
    second=
    failed "$status"
  fi
  if [ "$first" = "$second" ]; then
    break
  fi
  first=
  second=
  prompt='Die beiden Eingaben stimmten nicht überein — bitte noch einmal:'
done
second=
printf '%s\n' "$first" | sh "$here/sdc" set-secret --stdin
