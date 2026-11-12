// src/config.ts
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "fs";
import { join as join2 } from "path";

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
var PLUGIN = "staging-device-check";
function dataDir(env = process.env) {
  const base2 = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base2, PLUGIN);
}

// src/config.ts
var defaults = {
  standMarker: "Stand",
  perRunMinutes: 6,
  warnBelowMinutes: 20,
  tokenMinutes: 20
};
var configPath = (env = process.env) => join2(dataDir(env), "config.json");
var isString = (v) => typeof v === "string";
function validate(c) {
  for (const k of ["apex", "hostPattern", "browserstackYml", "jiraSite", "standMarker"]) {
    if (!isString(c[k])) throw new Error(`config: ${k} must be a string`);
  }
  if (!c.projects || typeof c.projects !== "object" || Array.isArray(c.projects) || !Object.values(c.projects).every(isString)) {
    throw new Error("config: projects must map display names to labels");
  }
  if (!Array.isArray(c.accounts)) throw new Error("config: accounts must be a list");
  for (const a of c.accounts) {
    for (const k of ["label", "email", "persona", "project"]) {
      if (!isString(a?.[k])) throw new Error(`config: account ${k} must be a string`);
    }
    if (a.login !== "quick" && a.login !== "code")
      throw new Error(`config: account login must be quick or code (${a.label})`);
  }
  if (!Number.isInteger(c.tokenMinutes) || c.tokenMinutes < 1 || c.tokenMinutes > 120) {
    throw new Error("config: tokenMinutes must be a whole number from 1 to 120");
  }
  for (const k of ["perRunMinutes", "warnBelowMinutes"]) {
    if (typeof c[k] !== "number" || !Number.isFinite(c[k]) || c[k] < 0)
      throw new Error(`config: ${k} must be a number >= 0`);
  }
  return c;
}
function loadConfig(env = process.env) {
  const file = configPath(env);
  if (!existsSync(file)) return null;
  return validate({ ...defaults, ...JSON.parse(readFileSync(file, "utf8")) });
}

// src/secret.ts
import { spawnSync } from "child_process";
import { chmodSync as chmodSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join3 } from "path";
var SERVICE = PLUGIN;
var ACCOUNT = "staging-gate";
var realSecretDeps = () => ({
  env: process.env,
  platform: process.platform,
  run: (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, encoding: "utf8", timeout: 1e4 });
    return { status: r.error ? 127 : r.status ?? 1, stdout: r.stdout ?? "" };
  }
});
var secretFilePath = (env = process.env) => join3(dataDir(env), "gate-password");
var stripNewline = (s) => s.replace(/\r?\n$/, "");
function keychainRead(d) {
  const r = d.platform === "darwin" ? d.run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]) : d.run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
  const v = stripNewline(r.stdout);
  return r.status === 0 && v ? v : null;
}
function readGatePassword(d = realSecretDeps()) {
  const fromKeychain = keychainRead(d);
  if (fromKeychain) return fromKeychain;
  const file = secretFilePath(d.env);
  if (!existsSync2(file)) return null;
  return stripNewline(readFileSync2(file, "utf8")) || null;
}

// src/gate.ts
var GateError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "GateError";
  }
  kind;
};
var base = (apex) => apex.replace(/\/+$/, "");
var apexHostOf = (apex) => new URL(apex).host;
async function post(url, form, fetchFn, extra = {}) {
  try {
    return await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      ...extra
    });
  } catch (e) {
    throw new GateError(
      "unreachable",
      `Der Staging-Server ${apexHostOf(url)} ist nicht erreichbar (${e.message}). Netzwerk/VPN pr\xFCfen und noch einmal versuchen.`
    );
  }
}
var serverReason = async (r) => {
  try {
    const j = await r.json();
    return typeof j.error === "string" ? j.error : "";
  } catch {
    return "";
  }
};
function statusError(status, apex, host, reason) {
  switch (status) {
    case 401:
      return new GateError(
        "wrong-password",
        "Das gespeicherte Staging-Passwort wird nicht angenommen. Bitte das Passwort im Setup neu eingeben."
      );
    case 429:
      return new GateError(
        "throttled",
        "Zu viele Anmeldeversuche am Staging-Server. Bitte ein paar Minuten warten und es dann noch einmal versuchen."
      );
    case 400:
      return new GateError(
        "bad-host",
        `Der Staging-Server lehnt den App-Host \u201E${host}\u201C ab${reason ? `: ${reason}` : ""}. Projekt, Branch und Host-Muster im Setup pr\xFCfen.`
      );
    case 404:
      return new GateError(
        "not-deployed",
        `Der Staging-Server ${apexHostOf(apex)} kennt den Run-Token nicht (404). Entweder ist die Funktion dort noch nicht ausgerollt, oder die Staging-Adresse im Setup ist nicht die Hauptadresse.`
      );
    default:
      return new GateError(
        "unexpected",
        `Unerwartete Antwort vom Staging-Server ${apexHostOf(apex)} (HTTP ${status}).`
      );
  }
}
var SAME_SITE = /* @__PURE__ */ new Set(["Lax", "Strict", "None"]);
async function mintRunToken(apex, host, minutes, password, fetchFn = fetch) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    throw new GateError("bad-host", `Ein Run-Token gilt 1 bis 120 Minuten, nicht ${minutes}.`);
  }
  const r = await post(
    `${base(apex)}/_gate/run-token`,
    { password, host, minutes: String(minutes) },
    fetchFn
  );
  if (r.status !== 200) throw statusError(r.status, apex, host, await serverReason(r));
  const j = await r.json();
  const ok = typeof j.name === "string" && typeof j.value === "string" && j.value !== "" && typeof j.host === "string" && typeof j.path === "string" && typeof j.secure === "boolean" && typeof j.httpOnly === "boolean" && typeof j.sameSite === "string" && SAME_SITE.has(j.sameSite) && typeof j.expiry === "number";
  if (!ok)
    throw new GateError(
      "unexpected",
      "Der Staging-Server hat einen unvollst\xE4ndigen Run-Token geliefert."
    );
  if (j.host !== host) {
    throw new GateError(
      "bad-host",
      `Der Run-Token gilt f\xFCr \u201E${j.host}\u201C, nicht f\xFCr den angefragten App-Host \u201E${host}\u201C.`
    );
  }
  const bootstrapPath = typeof j.bootstrapPath === "string" && j.bootstrapPath.startsWith("/") ? j.bootstrapPath : "/health";
  return {
    name: j.name,
    value: j.value,
    host,
    path: j.path,
    secure: j.secure,
    httpOnly: j.httpOnly,
    sameSite: j.sameSite,
    expiry: j.expiry,
    bootstrapUrl: `https://${host}${bootstrapPath}`
  };
}
function parseGateCookie(header, fallbackDomain) {
  const [pair, ...attrs] = header.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  if (eq < 0 || pair.slice(0, eq) !== "staging_gate") return null;
  const value = pair.slice(eq + 1);
  const attr = new Map(
    attrs.map((a) => {
      const i = a.indexOf("=");
      return i < 0 ? [a.toLowerCase(), ""] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
    })
  );
  const now = Math.floor(Date.now() / 1e3);
  const maxAge = Number(attr.get("max-age"));
  const expiresAt = attr.has("expires") ? Math.floor(Date.parse(attr.get("expires")) / 1e3) : NaN;
  const expires = Number.isFinite(maxAge) && attr.has("max-age") ? now + maxAge : Number.isFinite(expiresAt) ? expiresAt : -1;
  return { name: "staging_gate", value, domain: attr.get("domain") || fallbackDomain, expires };
}
async function gateLogin(apex, password, fetchFn = fetch) {
  const r = await post(`${base(apex)}/_gate/login`, { password, return_to: "/" }, fetchFn, {
    redirect: "manual"
  });
  if (r.status !== 302 && r.status !== 303 && r.status !== 200)
    throw statusError(r.status, apex, null, "");
  const headers = r.headers.getSetCookie?.() ?? (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")] : []);
  for (const h of headers) {
    const c = parseGateCookie(h, apexHostOf(apex));
    if (c && c.value) return c;
  }
  throw new GateError(
    "unexpected",
    "Der Staging-Server hat beim Gate-Login kein Gate-Cookie gesetzt."
  );
}

// src/mailpit.ts
function client(apex, gateCookie, fetchFn) {
  const base2 = `${apex.replace(/\/+$/, "")}/mailpit/api/v1`;
  const headers = { cookie: `staging_gate=${gateCookie}`, accept: "application/json" };
  const get = async (url) => {
    const r = await fetchFn(url, { headers });
    if (r.status === 401 || r.status === 403 || r.redirected) {
      throw new Error("Mailpit ist ohne g\xFCltige Gate-Sitzung nicht lesbar.");
    }
    if (!r.ok) throw new Error(`Mailpit antwortet mit HTTP ${r.status}.`);
    return r.json();
  };
  return {
    search: async (email) => (await get(`${base2}/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`)).messages ?? [],
    text: async (id) => {
      const msg = await get(`${base2}/message/${encodeURIComponent(id)}`);
      return msg.Text || (msg.HTML ?? "").replace(/<[^>]+>/g, " ");
    }
  };
}
async function mailboxSnapshot(apex, gateCookie, email, fetchFn = fetch) {
  return new Set((await client(apex, gateCookie, fetchFn).search(email)).map((m) => m.ID));
}
async function latestLoginCode(apex, gateCookie, email, known, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), opts = {}) {
  const { pattern = /\b\d{6}\b/, timeoutMs = 6e4, intervalMs = 2e3, now = Date.now } = opts;
  const mp = client(apex, gateCookie, fetchFn);
  const deadline = now() + timeoutMs;
  for (; ; ) {
    const fresh = (await mp.search(email)).filter((m) => !known.has(m.ID)).sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
    for (const m of fresh) {
      const code = pattern.exec(await mp.text(m.ID))?.[0];
      if (code) return code;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(
    `Kein Login-Code f\xFCr ${email} innerhalb von ${Math.round(timeoutMs / 1e3)} s in Mailpit angekommen.`
  );
}

// src/redact.ts
var MASK = "\xABgeheim\xBB";
var MIN_LENGTH = 4;
function redactor(secrets) {
  const forms = /* @__PURE__ */ new Set();
  for (const s of secrets) {
    if (!s || s.length < MIN_LENGTH) continue;
    const b64 = Buffer.from(s).toString("base64");
    for (const f of [
      s,
      encodeURIComponent(s),
      new URLSearchParams({ v: s }).toString().slice(2),
      b64,
      b64.replace(/=+$/, ""),
      Buffer.from(s).toString("base64url")
    ]) {
      if (f.length >= MIN_LENGTH) forms.add(f);
    }
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  return (text) => ordered.reduce((t, f) => t.split(f).join(MASK), String(text));
}
export {
  GateError,
  gateLogin,
  latestLoginCode,
  loadConfig,
  mailboxSnapshot,
  mintRunToken,
  readGatePassword,
  redactor
};
