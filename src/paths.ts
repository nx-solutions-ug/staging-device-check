import { homedir } from 'node:os';
import { join } from 'node:path';

export const PLUGIN = 'staging-device-check';

/**
 * Where settings and the fallback secret live: Claude Code's plugin data dir when it is set, otherwise
 * `$XDG_CONFIG_HOME/staging-device-check` or `~/.config/staging-device-check`. Commands run through the Bash tool
 * do not inherit CLAUDE_PLUGIN_DATA, so every caller must hand it over the same way, or two directories appear.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, PLUGIN);
}
