/**
 * Reads a login code from the staging Mailpit (`{apex}/mailpit/`, standard REST API v1) through the LOCAL gate
 * session — the run token never opens Mailpit. Freshness is decided by message IDs, not clocks: the caller takes a
 * snapshot of the recipient's message IDs before requesting the code, and only a message outside that set counts.
 * (The staging server's clock may differ from this machine's.) A demo host's own mailbox is out of scope for v1.
 */

export type LoginCodeOptions = {
  /** Code pattern seen in the mail on the first local look; default six digits. */
  pattern?: RegExp;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
};

type Summary = { ID: string; Created: string };

function client(apex: string, gateCookie: string, fetchFn: typeof fetch) {
  const base = `${apex.replace(/\/+$/, '')}/mailpit/api/v1`;
  const headers = { cookie: `staging_gate=${gateCookie}`, accept: 'application/json' };
  const get = async (url: string) => {
    const r = await fetchFn(url, { headers });
    if (r.status === 401 || r.status === 403 || r.redirected) {
      throw new Error('Mailpit ist ohne gültige Gate-Sitzung nicht lesbar.');
    }
    if (!r.ok) throw new Error(`Mailpit antwortet mit HTTP ${r.status}.`);
    return r.json();
  };
  return {
    search: async (email: string): Promise<Summary[]> =>
      (
        (await get(`${base}/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`)) as {
          messages?: Summary[];
        }
      ).messages ?? [],
    text: async (id: string): Promise<string> => {
      const msg = (await get(`${base}/message/${encodeURIComponent(id)}`)) as {
        Text?: string;
        HTML?: string;
      };
      return msg.Text || (msg.HTML ?? '').replace(/<[^>]+>/g, ' ');
    },
  };
}

/** The IDs of the messages to `email` right now — taken before the code is requested. */
export async function mailboxSnapshot(
  apex: string,
  gateCookie: string,
  email: string,
  fetchFn: typeof fetch = fetch,
): Promise<Set<string>> {
  return new Set((await client(apex, gateCookie, fetchFn).search(email)).map((m) => m.ID));
}

/** The code from the newest message to `email` that is not in `known`; polls up to 60 s. */
export async function latestLoginCode(
  apex: string,
  gateCookie: string,
  email: string,
  known: ReadonlySet<string>,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  opts: LoginCodeOptions = {},
): Promise<string> {
  const { pattern = /\b\d{6}\b/, timeoutMs = 60_000, intervalMs = 2_000, now = Date.now } = opts;
  const mp = client(apex, gateCookie, fetchFn);
  const deadline = now() + timeoutMs;
  for (;;) {
    // newest first among the new ones; the server's own timestamps are consistent with each other
    const fresh = (await mp.search(email))
      .filter((m) => !known.has(m.ID))
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
    for (const m of fresh) {
      const code = pattern.exec(await mp.text(m.ID))?.[0];
      if (code) return code;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(
    `Kein Login-Code für ${email} innerhalb von ${Math.round(timeoutMs / 1000)} s in Mailpit angekommen.`,
  );
}
