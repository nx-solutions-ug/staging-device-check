import { homedir } from 'node:os';
import { join } from 'node:path';

export const PLUGIN = 'staging-device-check';

/**
 * Settings and the fallback secret live in one fixed place: `${XDG_CONFIG_HOME:-~/.config}/staging-device-check`.
 * Deliberately no CLAUDE_PLUGIN_DATA branch — commands run through the Bash tool do not see that variable while
 * hooks and MCP servers do, which would split the settings into two places.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, PLUGIN);
}

/**
 * Workspace, gate storage state and other run state: `${XDG_DATA_HOME:-~/.local/share}/staging-device-check`.
 * Same rule as dataDir: fixed, never CLAUDE_PLUGIN_DATA.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share');
  return join(base, PLUGIN);
}
