import type { Config } from './config.js';

/**
 * Branch ref → host label, as the staging dashboard shows it: lower case, `/` → `--`, anything outside
 * `[a-z0-9-]` → `-` (`feat/ABC-1-x` → `feat--abc-1-x`).
 */
export function branchLabel(branch: string): string {
  return branch
    .toLowerCase()
    .replaceAll('/', '--')
    .replace(/[^a-z0-9-]/g, '-');
}

const PLACEHOLDERS = new Set(['project', 'branch', 'apexHost']);

/** Fills `{project}`, `{branch}` (as its label) and `{apexHost}` in the configured host pattern. */
export function appHost(c: Config, project: string, branch: string): string {
  const apexHost = new URL(c.apex).host.toLowerCase();
  const unknown = [...c.hostPattern.matchAll(/\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter((p) => !PLACEHOLDERS.has(p));
  if (unknown.length) throw new Error(`hostPattern: unknown placeholder {${unknown.join('}, {')}}`);
  const host = c.hostPattern
    .replaceAll('{project}', project.toLowerCase())
    .replaceAll('{branch}', branchLabel(branch))
    .replaceAll('{apexHost}', apexHost);
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error(`hostPattern: "${host}" is not a host name`);
  return host;
}
