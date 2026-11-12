/**
 * `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <command>` — the plugin's CLI. All output for the tester is German.
 * Secrets never go to argv, stdout or files outside their mode-600 places.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkYml, usedMinutes } from './bsyml.js';
import { loadConfig, type Config } from './config.js';
import { GateError, gateLogin, mintRunToken } from './gate.js';
import { appHost } from './hosts.js';
import { stateDir } from './paths.js';
import { parseResult, renderStand } from './report.js';
import {
  prepare,
  readMeta,
  realListTests,
  realSpawn,
  runTests,
  workspaceDir,
  type Device,
  type Mailbox,
  type RunDeps,
  validateTicket,
} from './run.js';
import { readGatePassword, realSecretDeps, writeGatePassword } from './secret.js';

export const COMMANDS = [
  'set-secret',
  'doctor',
  'install-workspace',
  'local-state',
  'prepare',
  'run',
  'report',
] as const;

export type CliDeps = RunDeps & {
  /** hidden-input prompt in the tester's terminal */
  prompt: (question: string) => Promise<string>;
  /** the plugin's workspace template (next to dist/) */
  workspaceSource: string;
  nodeVersion: string;
  /** calls `stop` on Ctrl+C / SIGTERM while a run is going; returns the unregister function */
  interrupts?: (stop: () => void) => () => void;
};

const MIN_PASSWORD = 16;
const gateStatePath = (env: NodeJS.ProcessEnv) => join(stateDir(env), 'gate-state.json');

class UsageError extends Error {}

const USAGE = `Befehle:
  set-secret                         Staging-Passwort verdeckt eingeben und sicher speichern
  doctor [--json]                    Einrichtung prüfen (ok / fehlt)
  install-workspace                  Test-Arbeitsbereich installieren (npm ci)
  local-state                        Gate-Sitzung für den lokalen Browser (Playwright MCP) anlegen
  prepare <TICKET> --host <host>     Run-Ordner anlegen
  run <ordner> [--devices iphone,android] [--confirm-minutes N] [--mailbox shared|demo]
  report <ordner> <TICKET>           Stand-Abschnitt aus result.json erzeugen`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) throw new UsageError(`--${name} braucht einen Wert.`);
  return v;
}

// ---------- set-secret ----------

async function setSecret(d: CliDeps): Promise<number> {
  const first = await d.prompt('Staging-Passwort (Eingabe bleibt unsichtbar): ');
  if (first.length < MIN_PASSWORD) {
    d.err(
      `Das Passwort ist kürzer als ${MIN_PASSWORD} Zeichen — so kurz ist das Staging-Passwort nie. Nichts gespeichert.`,
    );
    return 1;
  }
  const second = await d.prompt('Noch einmal zur Bestätigung: ');
  if (first !== second) {
    d.err('Die beiden Eingaben stimmen nicht überein. Nichts gespeichert.');
    return 1;
  }
  try {
    const where = writeGatePassword(first, d.secret);
    d.out(where === 'keychain' ? 'gespeichert (Schlüsselbund)' : 'gespeichert (Datei)');
    return 0;
  } catch (e) {
    d.err(`Nicht gespeichert: ${(e as Error).message}`);
    return 1;
  }
}

// ---------- doctor ----------

type Check = { status: 'ok' | 'fehlt' | 'hinweis'; label: string; detail: string };

async function doctor(d: CliDeps, json: boolean): Promise<number> {
  const checks: Check[] = [];
  const add = (status: Check['status'], label: string, detail = '') =>
    checks.push({ status, label, detail });

  const major = Number(d.nodeVersion.split('.')[0]);
  if (major >= 26) add('ok', `Node ${d.nodeVersion}`);
  else add('fehlt', `Node ${d.nodeVersion}`, 'Node 26 oder neuer wird gebraucht.');

  let config: Config | null = null;
  try {
    config = loadConfig(d.env);
    if (config) add('ok', 'Einstellungen');
    else add('fehlt', 'Einstellungen', 'Noch keine Einstellungen — bitte das Setup ausführen.');
  } catch (e) {
    add('fehlt', 'Einstellungen', (e as Error).message);
  }

  const password = readGatePassword(d.secret);
  if (password) add('ok', 'Staging-Passwort gespeichert');
  else add('fehlt', 'Staging-Passwort', 'Bitte mit „set-secret“ im eigenen Terminal eingeben.');

  if (config && password) {
    const label = Object.values(config.projects)[0];
    if (!label) add('fehlt', 'Staging-Zugang', 'Im Setup ist noch kein Projekt hinterlegt.');
    else {
      try {
        const host = appHost(config, label, 'main');
        await mintRunToken(config.apex, host, 1, password, d.fetchFn);
        add('ok', 'Staging erreichbar, Passwort angenommen', `Test-Token für ${host}`);
      } catch (e) {
        add('fehlt', 'Staging-Zugang', e instanceof GateError ? e.message : (e as Error).message);
      }
    }
  }

  if (config) {
    const yml = checkYml(config.browserstackYml, d.env);
    if (yml.ok)
      add(
        'ok',
        'browserstack.yml',
        yml.mobilePlatforms.map((p) => `${p.deviceName} ${p.osVersion}`).join(', '),
      );
    for (const e of yml.errors) add('fehlt', 'browserstack.yml', e);
    for (const w of yml.warnings) add('hinweis', 'browserstack.yml', w);
    if (yml.ok) {
      const [user, key] = yml.secretsForRedaction;
      const used = await usedMinutes(user, key, d.fetchFn);
      if (used === null) add('hinweis', 'BrowserStack-Minuten', 'nicht abrufbar');
      else {
        const left = Math.round((config.planMinutes - used) * 10) / 10;
        add(
          left < config.warnBelowMinutes ? 'hinweis' : 'ok',
          'BrowserStack-Minuten',
          `≈ ${left} von ${config.planMinutes} übrig (geschätzt)`,
        );
      }
    }
  }

  if (existsSync(join(workspaceDir(d.env), 'node_modules', '.bin', 'browserstack-node-sdk')))
    add('ok', 'Test-Arbeitsbereich');
  else add('fehlt', 'Test-Arbeitsbereich', 'Bitte „install-workspace“ ausführen.');

  const mcp = mcpCheck(join(d.workspaceSource, '..', '.mcp.json'));
  add(mcp.ok ? 'ok' : 'fehlt', 'Playwright-MCP', mcp.detail);

  const state = gateStatePath(d.env);
  let gateUntil: number | null = null;
  try {
    const s = JSON.parse(readFileSync(state, 'utf8')) as {
      cookies?: Array<{ name: string; expires: number }>;
    };
    gateUntil = s.cookies?.find((c) => c.name === 'staging_gate')?.expires ?? null;
  } catch {
    gateUntil = null;
  }
  if (gateUntil && gateUntil * 1000 > d.now().getTime())
    add(
      'ok',
      'Gate-Sitzung für den lokalen Browser',
      `gültig bis ${new Date(gateUntil * 1000).toLocaleString('de-DE')}`,
    );
  else add('fehlt', 'Gate-Sitzung für den lokalen Browser', 'Bitte „local-state“ ausführen.');

  if (json) d.out(JSON.stringify(checks, null, 2));
  else for (const c of checks) d.out(`${c.status} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  return checks.some((c) => c.status === 'fehlt') ? 1 : 0;
}

/** The plugin's Playwright MCP server: pinned, isolated, started with the local gate session (storage state). */
function mcpCheck(file: string): { ok: boolean; detail: string } {
  let server: { command?: string; args?: string[] } | undefined;
  try {
    server = (
      JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, typeof server> }
    ).mcpServers?.playwright;
  } catch {
    return {
      ok: false,
      detail: 'Die .mcp.json des Plugins fehlt oder ist kein JSON — Plugin neu installieren.',
    };
  }
  if (!server) return { ok: false, detail: 'In der .mcp.json fehlt der Server „playwright“.' };
  const all = [server.command ?? '', ...(server.args ?? [])].join(' ');
  const version = /@playwright\/mcp@(\d+\.\d+\.\d+)(?=["'\s]|$)/.exec(all)?.[1];
  if (!version) return { ok: false, detail: '@playwright/mcp hat keine feste Version.' };
  if (!all.includes('--storage-state') || !all.includes('staging-device-check/gate-state.json'))
    return {
      ok: false,
      detail: 'Der Server startet nicht mit der Gate-Sitzung (--storage-state …/gate-state.json).',
    };
  return { ok: true, detail: `@playwright/mcp ${version}, mit der Gate-Sitzung` };
}

// ---------- install-workspace ----------

async function installWorkspace(d: CliDeps): Promise<number> {
  const dest = workspaceDir(d.env);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(d.workspaceSource, dest, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('node_modules'),
  });
  const code = await d.spawn(
    'npm',
    ['ci', '--no-audit', '--no-fund'],
    { cwd: dest, env: d.env },
    (c) => process.stderr.write(c),
    (c) => process.stderr.write(c),
  );
  if (code !== 0) {
    d.err(
      'npm ci ist fehlgeschlagen — Netzwerk prüfen und „install-workspace“ noch einmal ausführen.',
    );
    return 1;
  }
  d.out(dest);
  return 0;
}

// ---------- local-state ----------

async function localState(d: CliDeps): Promise<number> {
  const config = loadConfig(d.env);
  if (!config) throw new Error('Noch keine Einstellungen — bitte das Setup ausführen.');
  const password = readGatePassword(d.secret);
  if (!password)
    throw new Error('Kein Staging-Passwort gespeichert — bitte „set-secret“ ausführen.');
  const c = await gateLogin(config.apex, password, d.fetchFn);
  const file = gateStatePath(d.env);
  mkdirSync(stateDir(d.env), { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    `${JSON.stringify({ cookies: [{ name: c.name, value: c.value, domain: c.domain, path: '/', expires: c.expires, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  d.out(
    c.expires > 0
      ? `Gate-Sitzung für den lokalen Browser gültig bis ${new Date(c.expires * 1000).toLocaleString('de-DE')}`
      : 'Gate-Sitzung angelegt (ohne Ablaufdatum).',
  );
  return 0;
}

// ---------- report ----------

function report(dir: string, ticket: string, d: CliDeps): number {
  validateTicket(ticket);
  const meta = readMeta(dir);
  const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  const shotsDir = join(dir, 'screenshots');
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => f.endsWith('.png')) : [];
  const md = renderStand(
    parseResult(result, shots),
    ticket,
    meta.host,
    meta.devices ?? [],
    new Date(meta.createdAt),
  );
  writeFileSync(join(dir, 'stand-abschnitt.md'), md);
  d.out(md.trimEnd());
  return 0;
}

// ---------- main ----------

export async function main(argv: string[], d: CliDeps): Promise<number> {
  const [cmd, ...args] = argv;
  try {
    switch (cmd) {
      case 'set-secret':
        return await setSecret(d);
      case 'doctor':
        return await doctor(d, args.includes('--json'));
      case 'install-workspace':
        return await installWorkspace(d);
      case 'local-state':
        return await localState(d);
      case 'prepare': {
        const [ticket] = args;
        const host = flag(args, 'host');
        if (!ticket || !host) throw new UsageError('prepare braucht <TICKET> und --host <host>.');
        prepare(ticket, host, d);
        return 0;
      }
      case 'run': {
        const [dir] = args;
        if (!dir) throw new UsageError('run braucht den Run-Ordner.');
        const devicesArg = flag(args, 'devices');
        const devices = devicesArg?.split(',').map((s) => s.trim());
        if (devices?.some((x) => x !== 'iphone' && x !== 'android'))
          throw new UsageError('--devices kennt nur iphone und android.');
        const mailbox = flag(args, 'mailbox') ?? 'shared';
        if (mailbox !== 'shared' && mailbox !== 'demo')
          throw new UsageError('--mailbox ist shared oder demo.');
        const confirm = flag(args, 'confirm-minutes');
        const confirmMinutes = confirm === undefined ? undefined : Number(confirm);
        if (confirmMinutes !== undefined && !Number.isFinite(confirmMinutes))
          throw new UsageError('--confirm-minutes braucht eine Zahl.');
        const abort = new AbortController();
        const release = d.interrupts?.(() => abort.abort()) ?? (() => {});
        try {
          return await runTests(
            dir,
            {
              devices: devices as Device[] | undefined,
              mailbox: mailbox as Mailbox,
              confirmMinutes,
              signal: abort.signal,
            },
            d,
          );
        } finally {
          release();
        }
      }
      case 'report': {
        const [dir, ticket] = args;
        if (!dir || !ticket) throw new UsageError('report braucht <ordner> und <TICKET>.');
        return report(dir, ticket, d);
      }
      default:
        d.err(cmd ? `Unbekannter Befehl „${cmd}“.\n${USAGE}` : USAGE);
        return 64;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      d.err(`${e.message}\n${USAGE}`);
      return 64;
    }
    d.err((e as Error).message);
    return 1;
  }
}

/** Hidden input from the terminal (raw mode); reads one line from a pipe when there is no terminal. */
function hiddenPrompt(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  if (!stdin.isTTY) {
    // A pipe would show the password to whatever wrote it, and could not hide the typing.
    process.stderr.write('\n');
    return Promise.reject(
      new Error(
        'set-secret braucht ein Terminal: bitte im eigenen Terminal-Fenster ausführen. Nichts gespeichert.',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      process.stderr.write('\n');
    };
    const onEnd = () => {
      done();
      reject(new Error('Eingabe beendet. Nichts gespeichert.'));
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Error('Abgebrochen.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8').on('data', onData).on('end', onEnd).resume();
  });
}

export function realDeps(): CliDeps {
  const env = process.env;
  return {
    env,
    secret: realSecretDeps(),
    fetchFn: fetch,
    now: () => new Date(),
    spawn: realSpawn,
    listTests: realListTests(realSpawn, env),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    prompt: hiddenPrompt,
    workspaceSource: fileURLToPath(new URL('../workspace/', import.meta.url)),
    nodeVersion: process.versions.node,
    interrupts: (stop) => {
      // the first signal stops the SDK and lets the run folder be cleaned; Node's default exit would skip that
      const on = () => stop();
      process.on('SIGINT', on);
      process.on('SIGTERM', on);
      return () => {
        process.off('SIGINT', on);
        process.off('SIGTERM', on);
      };
    },
  };
}

/** True when this file is the started script, also through a symlink (argv[1] is the path as typed). */
function startedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  main(process.argv.slice(2), realDeps()).then((code) => {
    process.exitCode = code;
  });
}
