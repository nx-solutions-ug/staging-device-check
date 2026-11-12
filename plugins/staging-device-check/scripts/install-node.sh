#!/bin/sh
# Installs the Node release pinned in node.lock into the plugin's data folder — no admin rights, no PATH or
# shell-profile change. The archive is checked against the SHA-256 in node.lock before anything is extracted.
# Prints the path of the node binary. Runs without any Node.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
lock="$here/node.lock"
pin() { sed -n "s/^$1=//p" "$lock" | head -n 1; }

version=$(pin NODE_VERSION)
system=${SDC_NODE_PLATFORM:-$(uname -s)-$(uname -m)}
case "$system" in
  Darwin-arm64 | darwin-arm64) platform=darwin-arm64 ;;
  Darwin-x86_64 | darwin-x64) platform=darwin-x64 ;;
  Linux-x86_64 | linux-x64) platform=linux-x64 ;;
  *)
    echo "Dieses System ($system) wird nicht unterstützt: Node gibt es hier nur für Mac (Apple-Chip und Intel) und Linux x64." >&2
    exit 1
    ;;
esac
want=$(pin "NODE_SHA256_$(printf '%s' "$platform" | tr - _)")
if [ -z "$version" ] || [ -z "$want" ]; then
  echo "In node.lock fehlt die Version oder die Prüfsumme für $platform — Plugin neu installieren." >&2
  exit 1
fi

data=${XDG_DATA_HOME:-$HOME/.local/share}/staging-device-check
dest=$data/node
if [ -x "$dest/bin/node" ] && [ "$(cat "$dest/.sdc-version" 2>/dev/null)" = "$version" ]; then
  echo "$dest/bin/node"
  exit 0
fi

mkdir -p "$data"
tmp=$(mktemp -d "$data/.node-XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM HUP
file=node-v$version-$platform.tar.gz
if ! curl -fsSL --retry 2 -o "$tmp/$file" "${SDC_NODE_DIST:-https://nodejs.org/dist}/v$version/$file"; then
  echo "Node $version konnte nicht geladen werden — Internetverbindung prüfen und das Setup noch einmal starten." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp/$file" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  got=$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1)
else
  echo "Kein Programm zum Prüfen der Prüfsumme gefunden (sha256sum oder shasum) — nichts installiert." >&2
  exit 1
fi
if [ "$got" != "$want" ]; then
  echo "Die Prüfsumme von Node $version stimmt nicht — die Datei ist beschädigt oder nicht die erwartete. Nichts entpackt, nichts installiert." >&2
  exit 1
fi

mkdir "$tmp/x"
tar -xzf "$tmp/$file" -C "$tmp/x"
src=$tmp/x/node-v$version-$platform
if [ ! -x "$src/bin/node" ]; then
  echo "Das Node-Archiv enthält kein bin/node — nichts installiert." >&2
  exit 1
fi
rm -rf "$dest.old"
if [ -d "$dest" ]; then mv "$dest" "$dest.old"; fi
mv "$src" "$dest"
# written last: a copy without this marker (an interrupted install) never counts as installed
printf '%s\n' "$version" >"$dest/.sdc-version"
rm -rf "$dest.old"
echo "Node $version installiert." >&2
echo "$dest/bin/node"
