# Sourced by sdc and playwright-mcp (which set `here`): finds the Node to use. The plugin's own copy (install-node.sh)
# in the version node.lock pins; a copy of another version is updated first. A system Node 26 or newer only when
# there is no usable copy; an outdated copy whose update failed still beats nothing. Sets SDC_NODE_BIN and
# SDC_NODE_FROM, or fails in German.
sdc_find_node() {
  copy=${XDG_DATA_HOME:-$HOME/.local/share}/staging-device-check/node
  pinned=$(sed -n 's/^NODE_VERSION=//p' "$here/node.lock" | head -n 1)
  stale=
  if [ -x "$copy/bin/node" ] && [ -f "$copy/.sdc-version" ]; then
    if [ "$(cat "$copy/.sdc-version")" = "$pinned" ]; then
      SDC_NODE_BIN=$copy/bin
      SDC_NODE_FROM='eigene Kopie'
      return 0
    fi
    echo "Die Node-Kopie des Plugins ist nicht die Version $pinned — sie wird jetzt aktualisiert …" >&2
    if sh "$here/install-node.sh" >/dev/null; then
      SDC_NODE_BIN=$copy/bin
      SDC_NODE_FROM='eigene Kopie'
      return 0
    fi
    stale=1
  fi
  system=$(command -v node 2>/dev/null) || system=
  if [ -n "$system" ]; then
    major=$("$system" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || major=0
    if [ "$major" -ge 26 ] 2>/dev/null; then
      SDC_NODE_BIN=$(dirname -- "$system")
      SDC_NODE_FROM='System-Node'
      return 0
    fi
  fi
  if [ -n "$stale" ]; then
    echo "Die Aktualisierung hat nicht geklappt — es läuft die alte Node-Kopie. Bitte das Setup noch einmal ausführen." >&2
    SDC_NODE_BIN=$copy/bin
    SDC_NODE_FROM='eigene Kopie (veraltet)'
    return 0
  fi
  echo "Node fehlt: Bitte zuerst das Setup ausführen (/staging-device-check:setup). Es installiert Node selbst, ohne Administrator-Rechte." >&2
  return 127
}
