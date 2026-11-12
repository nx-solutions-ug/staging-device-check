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
};

export const defaults: Pick<
  Config,
  'standMarker' | 'perRunMinutes' | 'warnBelowMinutes' | 'tokenMinutes'
> = {
  standMarker: 'Stand',
  perRunMinutes: 6,
  warnBelowMinutes: 20,
  tokenMinutes: 20,
};

export const configPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(dataDir(env), 'config.json');

const isString = (v: unknown): v is string => typeof v === 'string';

/** Throws on the first field that does not fit; the message names the field. */
function validate(c: Config): Config {
  for (const k of ['apex', 'hostPattern', 'browserstackYml', 'jiraSite', 'standMarker'] as const) {
    if (!isString(c[k])) throw new Error(`config: ${k} must be a string`);
  }
  if (
    !c.projects ||
    typeof c.projects !== 'object' ||
    Array.isArray(c.projects) ||
    !Object.values(c.projects).every(isString)
  ) {
    throw new Error('config: projects must map display names to labels');
  }
  if (!Array.isArray(c.accounts)) throw new Error('config: accounts must be a list');
  for (const a of c.accounts) {
    for (const k of ['label', 'email', 'persona', 'project'] as const) {
      if (!isString(a?.[k])) throw new Error(`config: account ${k} must be a string`);
    }
    if (a.login !== 'quick' && a.login !== 'code')
      throw new Error(`config: account login must be quick or code (${a.label})`);
  }
  if (!Number.isInteger(c.tokenMinutes) || c.tokenMinutes < 1 || c.tokenMinutes > 120) {
    throw new Error('config: tokenMinutes must be a whole number from 1 to 120');
  }
  for (const k of ['perRunMinutes', 'warnBelowMinutes'] as const) {
    if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < 0)
      throw new Error(`config: ${k} must be a number >= 0`);
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
