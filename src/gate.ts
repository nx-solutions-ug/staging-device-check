/**
 * The staging gate, from the outside: a short-lived run token for one app host (for device-cloud sessions) and the
 * local 7-day gate cookie (for the Playwright MCP and Mailpit). Passwords travel only in a form-encoded body;
 * no message here ever contains a password, a token or a cookie value.
 */

export type GateErrorKind =
  | 'wrong-password'
  | 'bad-host'
  | 'not-deployed'
  | 'unreachable'
  | 'throttled'
  | 'unexpected';

export class GateError extends Error {
  constructor(
    readonly kind: GateErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

export type RunToken = {
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

export type GateCookie = { name: 'staging_gate'; value: string; domain: string; expires: number };

const base = (apex: string) => apex.replace(/\/+$/, '');

/** The apex must be an https URL; a German GateError instead of a raw TypeError from `new URL`. */
function checkApex(apex: string): void {
  let ok = false;
  try {
    ok = new URL(apex).protocol === 'https:';
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new GateError(
      'bad-host',
      `Die Staging-Adresse „${apex}“ ist keine https-Adresse (erwartet z. B. https://staging.example.test). Bitte im Setup korrigieren.`,
    );
  }
}
const apexHostOf = (apex: string) => new URL(apex).host;

async function post(
  url: string,
  form: Record<string, string>,
  fetchFn: typeof fetch,
  extra: RequestInit = {},
) {
  try {
    return await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      ...extra,
    });
  } catch (e) {
    throw new GateError(
      'unreachable',
      `Der Staging-Server ${apexHostOf(url)} ist nicht erreichbar (${(e as Error).message}). Netzwerk/VPN prüfen und noch einmal versuchen.`,
    );
  }
}

const serverReason = async (r: Response): Promise<string> => {
  try {
    const j = (await r.json()) as { error?: unknown };
    return typeof j.error === 'string' ? j.error : '';
  } catch {
    return '';
  }
};

function statusError(status: number, apex: string, host: string | null, reason: string): GateError {
  if (host === null && (status === 400 || status === 404)) {
    // the gate login (no app host involved)
    return status === 400
      ? new GateError(
          'unexpected',
          `Der Gate-Login am Staging-Server ${apexHostOf(apex)} wurde abgelehnt (HTTP 400). Staging-Adresse im Setup prüfen.`,
        )
      : new GateError(
          'not-deployed',
          `Der Gate-Login ist unter ${apexHostOf(apex)} nicht zu finden (HTTP 404). Die Staging-Adresse im Setup ist vermutlich nicht die Hauptadresse.`,
        );
  }
  switch (status) {
    case 401:
      return new GateError(
        'wrong-password',
        'Das gespeicherte Staging-Passwort wird nicht angenommen. Bitte das Passwort im Setup neu eingeben.',
      );
    case 429:
      return new GateError(
        'throttled',
        'Zu viele Anmeldeversuche am Staging-Server. Bitte ein paar Minuten warten und es dann noch einmal versuchen.',
      );
    case 400:
      return new GateError(
        'bad-host',
        `Der Staging-Server lehnt den App-Host „${host}“ ab${reason ? `: ${reason}` : ''}. Projekt, Branch und Host-Muster im Setup prüfen.`,
      );
    case 404:
      return new GateError(
        'not-deployed',
        `Der Staging-Server ${apexHostOf(apex)} kennt den Run-Token nicht (404). Entweder ist die Funktion dort noch nicht ausgerollt, oder die Staging-Adresse im Setup ist nicht die Hauptadresse.`,
      );
    default:
      return new GateError(
        'unexpected',
        `Unerwartete Antwort vom Staging-Server ${apexHostOf(apex)} (HTTP ${status}).`,
      );
  }
}

const SAME_SITE = new Set(['Lax', 'Strict', 'None']);

/** `POST {apex}/_gate/run-token` → a token that opens exactly `host` for `minutes` (1–120). */
export async function mintRunToken(
  apex: string,
  host: string,
  minutes: number,
  password: string,
  fetchFn: typeof fetch = fetch,
): Promise<RunToken> {
  checkApex(apex);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    throw new GateError('bad-host', `Ein Run-Token gilt 1 bis 120 Minuten, nicht ${minutes}.`);
  }
  const r = await post(
    `${base(apex)}/_gate/run-token`,
    { password, host, minutes: String(minutes) },
    fetchFn,
  );
  if (r.status !== 200) throw statusError(r.status, apex, host, await serverReason(r));
  const j = (await r.json()) as Record<string, unknown>;
  const ok =
    typeof j.name === 'string' &&
    typeof j.value === 'string' &&
    j.value !== '' &&
    typeof j.host === 'string' &&
    typeof j.path === 'string' &&
    typeof j.secure === 'boolean' &&
    typeof j.httpOnly === 'boolean' &&
    typeof j.sameSite === 'string' &&
    SAME_SITE.has(j.sameSite) &&
    typeof j.expiry === 'number';
  if (!ok)
    throw new GateError(
      'unexpected',
      'Der Staging-Server hat einen unvollständigen Run-Token geliefert.',
    );
  if (j.host !== host) {
    throw new GateError(
      'bad-host',
      `Der Run-Token gilt für „${j.host}“, nicht für den angefragten App-Host „${host}“.`,
    );
  }
  const bootstrapPath =
    typeof j.bootstrapPath === 'string' && j.bootstrapPath.startsWith('/')
      ? j.bootstrapPath
      : '/health';
  return {
    name: j.name as string,
    value: j.value as string,
    host,
    path: j.path as string,
    secure: j.secure as boolean,
    httpOnly: j.httpOnly as boolean,
    sameSite: j.sameSite as RunToken['sameSite'],
    expiry: j.expiry as number,
    bootstrapUrl: `https://${host}${bootstrapPath}`,
  };
}

/** Parses one `Set-Cookie` header value into the gate cookie, or null when it is another cookie. */
function parseGateCookie(header: string, fallbackDomain: string): GateCookie | null {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  if (eq < 0 || pair.slice(0, eq) !== 'staging_gate') return null;
  const value = pair.slice(eq + 1);
  const attr = new Map(
    attrs.map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.toLowerCase(), ''] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
    }),
  );
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number(attr.get('max-age'));
  const expiresAt = attr.has('expires')
    ? Math.floor(Date.parse(attr.get('expires') as string) / 1000)
    : NaN;
  const expires =
    Number.isFinite(maxAge) && attr.has('max-age')
      ? now + maxAge
      : Number.isFinite(expiresAt)
        ? expiresAt
        : -1;
  return { name: 'staging_gate', value, domain: attr.get('domain') || fallbackDomain, expires };
}

/** `POST {apex}/_gate/login` → the domain-wide 7-day `staging_gate` cookie (local use only). */
export async function gateLogin(
  apex: string,
  password: string,
  fetchFn: typeof fetch = fetch,
): Promise<GateCookie> {
  checkApex(apex);
  const r = await post(`${base(apex)}/_gate/login`, { password, return_to: '/' }, fetchFn, {
    redirect: 'manual',
  });
  if (r.status !== 302 && r.status !== 303 && r.status !== 200)
    throw statusError(r.status, apex, null, '');
  const headers =
    r.headers.getSetCookie?.() ??
    (r.headers.get('set-cookie') ? [r.headers.get('set-cookie') as string] : []);
  for (const h of headers) {
    const c = parseGateCookie(h, apexHostOf(apex));
    if (c && c.value) return c;
  }
  throw new GateError(
    'unexpected',
    'Der Staging-Server hat beim Gate-Login kein Gate-Cookie gesetzt.',
  );
}
