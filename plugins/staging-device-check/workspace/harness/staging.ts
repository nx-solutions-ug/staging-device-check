/**
 * Staging access for one test in a device-cloud session (pure logic; fixtures.ts wires it to Playwright).
 * Only the short-lived run token goes into the session: minted per test after the page exists, opened through the
 * ungated bootstrap URL, added host-only, removed in teardown. The 7-day `staging_gate` cookie is a hard error.
 */

export type RunTokenLike = {
  name: string;
  value: string;
  host: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expiry: number;
  bootstrapUrl: string;
};

export type Landing = { url: string; status: number | null; title: string; text: string };

type CookieParam = {
  name: string;
  value: string;
  url: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expires: number;
};

export type StagingDeps = {
  host: string;
  page: { goto(url: string): Promise<void>; landing(): Promise<Landing> };
  context: {
    cookies(): Promise<Array<{ name: string }>>;
    addCookies(cookies: CookieParam[]): Promise<void>;
    clearCookies(filter: { name: string }): Promise<void>;
  };
  mint(host: string): Promise<RunTokenLike>;
  /** Where teardown problems are reported (the fixture writes them to the test's annotations and stderr). */
  warn?: (message: string) => void;
};

export type Staging = { host: string; goto(path: string): Promise<void> };

/** The app host is not provisioned (or misspelled): the runner stops the remaining tests. */
export class UmgebungNichtGestartet extends Error {
  constructor(host: string, detail: string) {
    super(
      `Umgebung nicht gestartet: ${host} zeigt nicht die App (${detail}). Weitere Tests werden nicht gestartet.`,
    );
    this.name = 'UmgebungNichtGestartet';
  }
}

export class StagingZugangFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingZugangFehler';
  }
}

/** Where a gated page landed: the app, the gate login (token refused) or provisioning/404/another host. */
export function classifyLanding(l: Landing, host: string): 'ok' | 'gate' | 'provisioning' {
  let url: URL | null = null;
  try {
    url = new URL(l.url);
  } catch {
    return 'provisioning';
  }
  if (url.pathname.startsWith('/_gate')) return 'gate';
  if (url.host !== host) return 'provisioning';
  if (l.status === 404) return 'provisioning';
  if (/provision/i.test(`${url.pathname} ${l.title} ${l.text}`)) return 'provisioning';
  return 'ok';
}

export async function withStaging(
  d: StagingDeps,
  use: (s: Staging) => Promise<void>,
): Promise<void> {
  if ((await d.context.cookies()).some((c) => c.name === 'staging_gate')) {
    throw new StagingZugangFehler(
      'Im Browser-Kontext liegt ein staging_gate-Cookie — das 7-Tage-Cookie darf nie in eine BrowserStack-Session. Abbruch.',
    );
  }
  const token = await d.mint(d.host);
  let testError: unknown = null;
  try {
    await d.page.goto(token.bootstrapUrl);
    await d.context.addCookies([
      {
        name: token.name,
        value: token.value,
        url: `https://${token.host}`,
        secure: token.secure,
        httpOnly: token.httpOnly,
        sameSite: token.sameSite,
        expires: token.expiry,
      },
    ]);
    await d.page.goto(`https://${d.host}/`);
    const landing = await d.page.landing();
    const kind = classifyLanding(landing, d.host);
    if (kind === 'gate') {
      throw new StagingZugangFehler(
        `Der Run-Token wurde auf ${d.host} nicht angenommen (Gate-Login statt App).`,
      );
    }
    if (kind === 'provisioning') {
      throw new UmgebungNichtGestartet(
        d.host,
        landing.status === 404 ? 'HTTP 404' : `gelandet auf ${landing.url}`,
      );
    }
    await use({
      host: d.host,
      goto: (path: string) => {
        const url = new URL(path, `https://${d.host}/`);
        if (url.host !== d.host || url.protocol !== 'https:') {
          return Promise.reject(
            new StagingZugangFehler(
              `staging.goto: ${url.origin} ist ein anderer Host als ${d.host} — nur Pfade oder Adressen auf dem App-Host.`,
            ),
          );
        }
        return d.page.goto(url.toString());
      },
    });
  } catch (e) {
    testError = e;
  }
  // Teardown without `finally`, so neither error can silently replace the other.
  token.value = '';
  let removal: string | null = null;
  try {
    await d.context.clearCookies({ name: token.name });
  } catch (e) {
    removal = `Run-Token konnte nach dem Test nicht aus dem Browser entfernt werden (${(e as Error).message}). Er läuft spätestens nach seiner Laufzeit ab.`;
    d.warn?.(removal);
  }
  if (testError) throw testError; // a failing test keeps its own error
  if (removal) throw new StagingZugangFehler(removal); // a passing one must not hide the problem
}
