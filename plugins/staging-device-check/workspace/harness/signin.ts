/**
 * Sign-in for a test account, on the device:
 * - quick: the app's quick-login entry whose text contains the address (opened by the run token);
 * - code: address → send → code from the staging Mailpit (read locally) typed with `pressSequentially`
 *   (`keyboard.type` writes nothing on the iOS shim).
 * The app allows one code per address per 60 s and five per hour. Each request reserves its send slot in a
 * per-address ledger in the run folder under an exclusive lock file, so parallel workers with the same address
 * never request inside each other's 60 s window. With a demo mailbox (SDC_MAILBOX=demo) the code never reaches the
 * shared Mailpit: a code login is skipped as „nicht prüfbar hier“ before anything is requested.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

type Account = { email: string; login: 'quick' | 'code' };

type Loc = {
  filter(o: { hasText: string }): Loc;
  first(): Loc;
  tap(): Promise<void>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  pressSequentially(text: string): Promise<void>;
};

export type SignInPage = { locator(selector: string): Loc };

export type SignInSelectors = {
  /** collapsed quick-login section, opened first when given */
  quickToggle?: string;
  /** one quick-login entry; the one containing the address is tapped */
  quickEntry?: string;
  email?: string;
  send?: string;
  code?: string;
};

export type Mailbox = 'shared' | 'demo';

export type SignInDeps = {
  goto(path: string): Promise<void>;
  loginPath: string;
  selectors: SignInSelectors;
  runDir: string;
  mailbox: Mailbox;
  codes: {
    /** message IDs to the address before the request */
    snapshot(email: string): Promise<ReadonlySet<string>>;
    /** the code from the newest message outside `known` */
    read(email: string, known: ReadonlySet<string>): Promise<string>;
  };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** A check that cannot be done in this setup; the runner reports it as „nicht prüfbar hier“. */
export class NichtPruefbarHier extends Error {
  constructor(message: string) {
    super(`nicht prüfbar hier: ${message}`);
    this.name = 'NichtPruefbarHier';
  }
}

const RESEND_MS = 60_000;
const MARGIN_MS = 1_000;
const HOUR_MS = 3_600_000;
const PER_HOUR = 5;
const LOCK_STALE_MS = 15_000;

const need = (sel: string | undefined, name: string): string => {
  if (!sel) throw new Error(`Anmeldung: Selektor „${name}“ fehlt im Test.`);
  return sel;
};

/**
 * Reserves the next send slot for `email` (epoch ms) under an exclusive lock: re-reads the ledger, refuses a sixth
 * request within the hour, appends `max(now, last + 60 s + margin)`. The lock is held only for the read-modify-write,
 * never while waiting for the slot; a lock older than 15 s (crashed worker) is broken.
 */
async function reserveSlot(
  runDir: string,
  email: string,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
) {
  const file = join(
    runDir,
    `.login-code-${createHash('sha256').update(email).digest('hex').slice(0, 16)}.json`,
  );
  const lock = `${file}.lock`;
  const start = now();
  let backoff = 50;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeSync(fd, String(now()));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let heldSince = Number.NaN;
      try {
        heldSince = Number(readFileSync(lock, 'utf8'));
      } catch {
        continue; // released between open and read
      }
      const stale =
        Number.isFinite(heldSince) && heldSince > 0
          ? now() - heldSince > LOCK_STALE_MS
          : now() - start > 2 * LOCK_STALE_MS;
      if (stale) {
        rmSync(lock, { force: true });
        continue;
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 1_000);
    }
  }
  try {
    const recent = (
      existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as number[]) : []
    ).filter((t) => now() - t < HOUR_MS);
    if (recent.length >= PER_HOUR) {
      throw new Error(
        `Für ${email} wurden in der letzten Stunde schon ${PER_HOUR} Codes angefordert — die App schickt erst später wieder einen.`,
      );
    }
    const last = recent.length ? Math.max(...recent) : undefined;
    const slot = last === undefined ? now() : Math.max(now(), last + RESEND_MS + MARGIN_MS);
    writeFileSync(file, JSON.stringify([...recent, slot]), { mode: 0o600 });
    return slot;
  } finally {
    rmSync(lock, { force: true });
  }
}

export async function signIn(page: SignInPage, account: Account, d: SignInDeps): Promise<void> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const s = d.selectors;

  if (account.login === 'code' && d.mailbox === 'demo') {
    throw new NichtPruefbarHier(
      `Der Login-Code für ${account.email} landet im eigenen Postfach der Demo, nicht im gemeinsamen Mailpit — Anmeldung per Code wird übersprungen.`,
    );
  }

  await d.goto(d.loginPath);

  if (account.login === 'quick') {
    if (s.quickToggle) await page.locator(s.quickToggle).tap();
    await page
      .locator(need(s.quickEntry, 'quickEntry'))
      .filter({ hasText: account.email })
      .first()
      .tap();
    return;
  }

  const slot = await reserveSlot(d.runDir, account.email, now, sleep);
  if (slot > now()) await sleep(slot - now());
  await page.locator(need(s.email, 'email')).fill(account.email);
  const known = await d.codes.snapshot(account.email);
  await page.locator(need(s.send, 'send')).tap();
  const code = await d.codes.read(account.email, known);
  await page.locator(need(s.code, 'code')).pressSequentially(code);
}
