/**
 * Reads a login code from the staging Mailpit (`{apex}/mailpit/`, standard REST API v1) through the LOCAL gate
 * session — the run token never opens Mailpit. Only mail created after the request counts, so an older code to the
 * same address is never used. A demo host's own mailbox is out of scope for v1.
 */

export type LoginCodeOptions = {
  /** Code pattern seen in the mail on the first local look; default six digits. */
  pattern?: RegExp;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
};

type Summary = { ID: string; Created: string };

export async function latestLoginCode(
  apex: string,
  gateCookie: string,
  email: string,
  since: Date,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  opts: LoginCodeOptions = {},
): Promise<string> {
  const { pattern = /\b\d{6}\b/, timeoutMs = 60_000, intervalMs = 2_000, now = Date.now } = opts;
  const base = `${apex.replace(/\/+$/, '')}/mailpit/api/v1`;
  const headers = { cookie: `staging_gate=${gateCookie}`, accept: 'application/json' };
  const get = async (url: string) => {
    const r = await fetchFn(url, { headers });
    if (r.status === 401 || r.status === 403 || r.redirected)
      throw new Error('Mailpit ist ohne gültige Gate-Sitzung nicht lesbar.');
    if (!r.ok) throw new Error(`Mailpit antwortet mit HTTP ${r.status}.`);
    return r.json();
  };
  const deadline = now() + timeoutMs;
  for (;;) {
    const search = (await get(
      `${base}/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
    )) as { messages?: Summary[] };
    const fresh = (search.messages ?? [])
      .filter((m) => Date.parse(m.Created) > since.getTime())
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
    for (const m of fresh) {
      const msg = (await get(`${base}/message/${encodeURIComponent(m.ID)}`)) as {
        Text?: string;
        HTML?: string;
      };
      const text = msg.Text || (msg.HTML ?? '').replace(/<[^>]+>/g, ' ');
      const code = pattern.exec(text)?.[0];
      if (code) return code;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(
    `Kein Login-Code für ${email} innerhalb von ${Math.round(timeoutMs / 1000)} s in Mailpit angekommen.`,
  );
}
