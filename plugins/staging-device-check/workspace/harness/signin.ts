/**
 * Sign-in for a test account, on the device:
 * - quick: the app's quick-login entry whose text contains the address (opened by the run token);
 * - code: address → send → code from the staging Mailpit (read locally) typed with `pressSequentially`
 *   (`keyboard.type` writes nothing on the iOS shim).
 * The app allows one code per address per 60 s and five per hour; a timestamp file per address in the run folder
 * makes a second request wait instead of failing, and stops a sixth one within the hour.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

export type SignInDeps = {
  goto(path: string): Promise<void>;
  loginPath: string;
  selectors: SignInSelectors;
  runDir: string;
  readCode(email: string, since: Date): Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const RESEND_MS = 60_000;
const HOUR_MS = 3_600_000;
const PER_HOUR = 5;

const need = (sel: string | undefined, name: string): string => {
  if (!sel) throw new Error(`Anmeldung: Selektor „${name}“ fehlt im Test.`);
  return sel;
};

/** Requests made for this address in this run folder (epoch ms), newest last. */
function ledger(runDir: string, email: string) {
  const file = join(
    runDir,
    `.login-code-${createHash('sha256').update(email).digest('hex').slice(0, 16)}.json`,
  );
  const read = (): number[] =>
    existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as number[]) : [];
  const write = (v: number[]) => writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return { read, write };
}

export async function signIn(page: SignInPage, account: Account, d: SignInDeps): Promise<void> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const s = d.selectors;
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

  const log = ledger(d.runDir, account.email);
  const recent = log.read().filter((t) => now() - t < HOUR_MS);
  if (recent.length >= PER_HOUR) {
    throw new Error(
      `Für ${account.email} wurden in der letzten Stunde schon ${PER_HOUR} Codes angefordert — die App schickt erst später wieder einen.`,
    );
  }
  const last = recent.at(-1);
  if (last !== undefined && now() - last < RESEND_MS) await sleep(RESEND_MS - (now() - last));

  await page.locator(need(s.email, 'email')).fill(account.email);
  const since = new Date(now());
  log.write([...recent, since.getTime()]);
  await page.locator(need(s.send, 'send')).tap();
  const code = await d.readCode(account.email, since);
  await page.locator(need(s.code, 'code')).pressSequentially(code);
}
