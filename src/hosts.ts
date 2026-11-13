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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The project label whose hosts this is (the longest label that fits `hostPattern`), or null. */
export function projectOfHost(c: Config, host: string): string | null {
  const apexHost = new URL(c.apex).host.toLowerCase();
  const labels = Object.values(c.projects).sort((a, b) => b.length - a.length);
  for (const label of labels) {
    const source = c.hostPattern
      .split(/(\{[^}]*\})/)
      .map((part) =>
        part === '{project}'
          ? escape(label.toLowerCase())
          : part === '{branch}'
            ? '[a-z0-9-]+'
            : part === '{apexHost}'
              ? escape(apexHost)
              : escape(part),
      )
      .join('');
    if (new RegExp(`^${source}$`).test(host.toLowerCase())) return label;
  }
  return null;
}

/** The consent button for this host: the settings' entry for its project wins over the spec's own label. */
export function consentButtonFor(
  c: Config | null,
  host: string,
  fromSpec?: string,
): string | undefined {
  const label = c && projectOfHost(c, host);
  return label && c.consentButtons && Object.hasOwn(c.consentButtons, label)
    ? c.consentButtons[label]
    : fromSpec || undefined;
}
