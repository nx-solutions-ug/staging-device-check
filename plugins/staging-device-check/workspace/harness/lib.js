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
  loadConfig,
  mintRunToken,
  readGatePassword,
  redactor
};
