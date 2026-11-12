import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

export type MobilePlatform = { deviceName: string; osVersion: string; browserName: string };

export type YmlCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  mobilePlatforms: MobilePlatform[];
  /** The only place credentials appear. Callers hand this to `redactor` and nowhere else. */
  secretsForRedaction: string[];
};

type Scalar = string | undefined;
type Platform = Record<string, unknown>;

const str = (v: unknown): Scalar =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
const isFalse = (v: unknown) => str(v)?.toLowerCase() === 'false';
const isTrue = (v: unknown) => str(v)?.toLowerCase() === 'true';
const isIos = (p: MobilePlatform) => /^(iphone|ipad)/i.test(p.deviceName);
/** BrowserStack sample files ship `YOUR_USERNAME` / `YOUR_ACCESS_KEY`; those count as missing. */
const isPlaceholder = (v: string) => /^your_/i.test(v);

/** `${NAME}` is resolved from the environment, as the SDK does; anything else is the literal value. */
function credential(v: unknown, env: NodeJS.ProcessEnv, envName: string): Scalar {
  const raw = str(v);
  const ref = raw && /^\$\{(\w+)\}$/.exec(raw)?.[1];
  const value = ref ? str(env[ref]) : raw;
  if (value && !isPlaceholder(value)) return value;
  return str(env[envName]);
}

function insideGitWorkTree(file: string): boolean {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/**
 * Checks the tester's browserstack.yml before minutes are spent. Messages are German (they go to the tester) and
 * never contain a credential; credentials are returned only in `secretsForRedaction`.
 */
export function checkYml(path: string, env: NodeJS.ProcessEnv = process.env): YmlCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const done = (mobilePlatforms: MobilePlatform[] = [], secrets: string[] = []): YmlCheck => ({
    ok: errors.length === 0,
    errors,
    warnings,
    mobilePlatforms,
    secretsForRedaction: secrets,
  });

  if (!existsSync(path)) {
    errors.push(`browserstack.yml nicht gefunden: ${path}`);
    return done();
  }
  let doc: Record<string, unknown>;
  try {
    // failsafe: every scalar stays a string, so `osVersion: 13.0` stays "13.0".
    const parsed = parse(readFileSync(path, 'utf8'), { schema: 'failsafe' });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('kein YAML-Objekt');
    doc = parsed as Record<string, unknown>;
  } catch (e) {
    errors.push(
      `browserstack.yml lässt sich nicht lesen (${(e as Error).message.split('\n')[0]}).`,
    );
    return done();
  }

  const user = credential(doc.userName, env, 'BROWSERSTACK_USERNAME');
  const key = credential(doc.accessKey, env, 'BROWSERSTACK_ACCESS_KEY');
  if (!user)
    errors.push(
      'userName fehlt in der browserstack.yml (und BROWSERSTACK_USERNAME ist nicht gesetzt).',
    );
  if (!key)
    errors.push(
      'accessKey fehlt in der browserstack.yml (und BROWSERSTACK_ACCESS_KEY ist nicht gesetzt).',
    );
  const secrets =
    user && key ? [user, key, `${user}:${key}`] : [user, key].filter((s): s is string => !!s);

  const framework = str(doc.framework);
  if (framework?.toLowerCase() !== 'playwright') {
    errors.push(
      `framework muss "playwright" sein (gefunden: ${framework ? `"${framework}"` : 'nichts'}).`,
    );
  }
  if (isFalse(doc.browserstackAutomation)) {
    errors.push('browserstackAutomation ist false — damit liefe nichts auf BrowserStack.');
  }

  const platforms = Array.isArray(doc.platforms) ? (doc.platforms as Platform[]) : [];
  const mobilePlatforms: MobilePlatform[] = platforms
    .filter((p) => p && typeof p === 'object' && str(p.deviceName))
    .map((p) => ({
      deviceName: str(p.deviceName) as string,
      osVersion: str(p.osVersion) ?? '',
      browserName: (str(p.browserName) ?? '').toLowerCase(),
    }));
  if (mobilePlatforms.length === 0) {
    errors.push(
      'Keine Plattform mit deviceName — es braucht mindestens ein echtes Handy (z. B. iPhone oder Galaxy).',
    );
  }

  if (isTrue(doc.browserstackLocal)) {
    warnings.push(
      'browserstackLocal ist true — für Staging nicht nötig; es startet nur einen lokalen Tunnel.',
    );
  }
  const iosPlatforms = mobilePlatforms.filter(isIos);
  const logOn = (v: unknown) =>
    str(v) !== undefined && !isFalse(v) && str(v)?.toLowerCase() !== 'disable';
  for (const k of ['consoleLogs', 'playwrightLogs'] as const) {
    const onPlatform = platforms.some(
      (p) =>
        p &&
        isIos({ deviceName: str(p.deviceName) ?? '', osVersion: '', browserName: '' }) &&
        logOn(p[k]),
    );
    if (iosPlatforms.length && (logOn(doc[k]) || onPlatform)) {
      warnings.push(`${k} ist gesetzt — auf iOS-Geräten unterstützt BrowserStack das nicht.`);
    }
  }
  for (const p of mobilePlatforms) {
    if (isIos(p)) {
      const v = Number.parseFloat(p.osVersion);
      if (Number.isFinite(v) && v < 17)
        warnings.push(
          `${p.deviceName}: iOS ${p.osVersion} ist älter als 17 — Playwright auf iOS ist dort nicht zugesagt.`,
        );
      if (p.browserName !== 'safari')
        warnings.push(
          `${p.deviceName}: auf iOS sollte browserName "safari" sein (gefunden: "${p.browserName}").`,
        );
    } else if (p.browserName !== 'chrome') {
      warnings.push(
        `${p.deviceName}: auf Android sollte browserName "chrome" sein (gefunden: "${p.browserName}").`,
      );
    }
  }

  if ((statSync(path).mode & 0o077) !== 0) {
    warnings.push(
      'browserstack.yml ist für andere lesbar — bitte auf Modus 600 setzen (chmod 600).',
    );
  }
  if (insideGitWorkTree(path)) {
    warnings.push(
      'browserstack.yml liegt in einem Git-Arbeitsverzeichnis — die Zugangsdaten könnten versehentlich eingecheckt werden.',
    );
  }

  return done(mobilePlatforms, secrets);
}

/**
 * Remaining BrowserStack Automate minutes, when the API says so. The documented plan endpoint
 * (`GET https://api.browserstack.com/automate/plan.json`) returns only the plan name and parallel/queued session
 * counts — no minutes — so this returns null for that answer instead of guessing. Errors are null too.
 */
export async function remainingMinutes(
  user: string,
  key: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const r = await fetchFn('https://api.browserstack.com/automate/plan.json', {
      headers: {
        authorization: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`,
        accept: 'application/json',
      },
    });
    if (!r.ok) return null;
    await r.json();
    return null;
  } catch {
    return null;
  }
}
