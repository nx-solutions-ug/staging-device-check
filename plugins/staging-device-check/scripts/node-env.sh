# Sourced by sdc and playwright-mcp: finds the Node to use. The plugin's own copy (install-node.sh) first; a
# system Node 26 or newer only when the copy is missing. Sets SDC_NODE_BIN and SDC_NODE_FROM, or fails in German.
sdc_find_node() {
  copy=${XDG_DATA_HOME:-$HOME/.local/share}/staging-device-check/node
  if [ -x "$copy/bin/node" ] && [ -f "$copy/.sdc-version" ]; then
    SDC_NODE_BIN=$copy/bin
    SDC_NODE_FROM='eigene Kopie'
    return 0
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
  echo "Node fehlt: Bitte zuerst das Setup ausführen (/staging-device-check:setup). Es installiert Node selbst, ohne Administrator-Rechte." >&2
  return 127
}
