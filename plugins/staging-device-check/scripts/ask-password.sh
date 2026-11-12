#!/bin/sh
# Asks for the staging password in a native dialog — macOS: osascript, Linux: kdialog, else zenity — and pipes it
# straight into `set-secret --stdin`, which stores it in the keychain (macOS) or the Secret Service (KWallet,
# GNOME Keyring). The value is never on argv, in a file, on stdout or stderr: it lives only in this shell's memory
# and goes through printf (a shell builtin) into the pipe. Prints only set-secret's "gespeichert (…)" line.
# Exit 3: no dialog here (no display, or no dialog program) — use the terminal path, `set-secret`.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
title='Staging Device Check'

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

# One hidden entry; prints it, or fails when the dialog was cancelled (or gave up after 5 minutes).
ask() {
  case "$kind" in
    osascript)
      osascript - "$1" "$title" <<'APPLESCRIPT'
on run argv
  set r to display dialog (item 1 of argv) with title (item 2 of argv) default answer "" with hidden answer buttons {"Abbrechen", "Speichern"} default button "Speichern" cancel button "Abbrechen" giving up after 300
  if gave up of r then error number -128
  return text returned of r
end run
APPLESCRIPT
      ;;
    kdialog) kdialog --title "$title" --password "$1" ;;
    zenity) zenity --password --title "$title — $1" --timeout=300 ;;
  esac
}

prompt='Staging-Passwort (mindestens 16 Zeichen):'
tries=0
while :; do
  tries=$((tries + 1))
  if [ "$tries" -gt 3 ]; then
    echo "Dreimal keine passende Eingabe. Nichts gespeichert." >&2
    exit 1
  fi
  if ! first=$(ask "$prompt"); then
    echo "Abgebrochen. Nichts gespeichert." >&2
    exit 1
  fi
  if [ "${#first}" -lt 16 ]; then
    first=
    prompt='Das war kürzer als 16 Zeichen — bitte das Staging-Passwort eingeben:'
    continue
  fi
  if ! second=$(ask 'Bitte zur Bestätigung noch einmal eingeben:'); then
    first=
    echo "Abgebrochen. Nichts gespeichert." >&2
    exit 1
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
