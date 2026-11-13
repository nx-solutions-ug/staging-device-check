import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';

export type TestAccount = {
  label: string;
  email: string;
  persona: string;
  project: string;
  login: 'quick' | 'code';
};

export type Config = {
  apex: string;
  hostPattern: string;
  projects: Record<string, string>;
  browserstackYml: string;
  accounts: TestAccount[];
  jiraSite: string;
  standMarker: string;
  perRunMinutes: number;
  warnBelowMinutes: number;
  tokenMinutes: number;
  /** BrowserStack minutes of the plan (the API reports none); remaining = planMinutes − used, an estimate */
  planMinutes: number;
  /** per project label: the consent banner's button to tap; wins over the label a spec took from the local look */
  consentButtons?: Record<string, string>;
};

export const defaults: Pick<
  Config,
  'standMarker' | 'perRunMinutes' | 'warnBelowMinutes' | 'tokenMinutes' | 'planMinutes'
> = {
  standMarker: 'Stand',
  perRunMinutes: 6,
  warnBelowMinutes: 20,
  tokenMinutes: 20,
  planMinutes: 100,
};

export const configPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(dataDir(env), 'config.json');

const isString = (v: unknown): v is string => typeof v === 'string';

const isHttpsUrl = (v: string): boolean => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Throws on the first field that does not fit; the German message names the field. */
function validate(c: Config): Config {
  for (const k of ['apex', 'hostPattern', 'browserstackYml', 'jiraSite', 'standMarker'] as const) {
    if (!isString(c[k])) throw new Error(`Einstellungen: ${k} muss ein Text sein.`);
  }
  if (!isHttpsUrl(c.apex)) {
    throw new Error(
      `Einstellungen: apex muss eine https-Adresse sein (z. B. https://staging.example.test), nicht „${c.apex}“.`,
    );
  }
  if (
    !c.projects ||
    typeof c.projects !== 'object' ||
    Array.isArray(c.projects) ||
    !Object.values(c.projects).every(isString)
  ) {
    throw new Error('Einstellungen: projects muss Anzeigenamen auf Labels abbilden.');
  }
  if (
    c.consentButtons !== undefined &&
    (!c.consentButtons ||
      typeof c.consentButtons !== 'object' ||
      Array.isArray(c.consentButtons) ||
      !Object.values(c.consentButtons).every((v) => isString(v) && v.trim() !== ''))
  ) {
    throw new Error(
      'Einstellungen: consentButtons muss Projekt-Labels auf die Beschriftung eines Knopfs abbilden.',
    );
  }
  if (!Array.isArray(c.accounts)) throw new Error('Einstellungen: accounts muss eine Liste sein.');
  for (const a of c.accounts) {
    for (const k of ['label', 'email', 'persona', 'project'] as const) {
      if (!isString(a?.[k]))
        throw new Error(`Einstellungen: Testkonto-Feld ${k} muss ein Text sein.`);
    }
    if (a.login !== 'quick' && a.login !== 'code')
      throw new Error(
        `Einstellungen: login eines Testkontos muss quick oder code sein (${a.label}).`,
      );
  }
  if (!Number.isInteger(c.tokenMinutes) || c.tokenMinutes < 1 || c.tokenMinutes > 120) {
    throw new Error('Einstellungen: tokenMinutes muss eine ganze Zahl von 1 bis 120 sein.');
  }
  for (const k of ['perRunMinutes', 'warnBelowMinutes'] as const) {
    if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < 0)
      throw new Error(`Einstellungen: ${k} muss eine Zahl ≥ 0 sein.`);
  }
  if (typeof c.planMinutes !== 'number' || !Number.isFinite(c.planMinutes) || c.planMinutes <= 0) {
    throw new Error('Einstellungen: planMinutes muss eine Zahl > 0 sein.');
  }
  return c;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config | null {
  const file = configPath(env);
  if (!existsSync(file)) return null;
  return validate({ ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) } as Config);
}

/** Writes the settings mode 600 in a mode-700 dir, through a temp file and a rename, so a reader never sees half. */
export function saveConfig(c: Config, env: NodeJS.ProcessEnv = process.env): void {
  validate(c);
  const file = configPath(env);
  const dir = join(file, '..');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}
