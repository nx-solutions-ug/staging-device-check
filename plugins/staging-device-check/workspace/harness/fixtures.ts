/**
 * Playwright fixtures for generated specs: `import { test, expect } from '../harness/fixtures.js'`.
 * Run context comes from the runner (env): SDC_HOST (app host), SDC_RUN_DIR (run folder), SDC_TICKET, and
 * SDC_MAILBOX = shared (default) | demo — with a live demo the login code lands in the demo's own mailbox.
 * Options set by the spec with `test.use(...)`: `persona`, and for sign-in `loginPath`, `signInSelectors`,
 * `codePattern` (all found on the first local look). The device label is the project name.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import {
  gateLogin,
  latestLoginCode,
  loadConfig,
  mailboxSnapshot,
  mintRunToken,
  readGatePassword,
} from './lib.js';
import { beginCheck, noteLayout, unmeasured } from './check-state.js';
import { evaluateWith } from './evaluate.js';
import { measure, type LayoutOpts } from './measure.js';
import { shotName, stepNote } from './names.js';
import { evaluateRules, type RuleResult } from './rules.js';
import { NichtPruefbarHier, signIn, type Mailbox, type SignInSelectors } from './signin.js';
import { withStaging, type Staging } from './staging.js';

export { evaluateWith } from './evaluate.js';
export { shotName, slug, stepNote } from './names.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v)
    throw new Error(`${name} fehlt — die Tests werden vom Plugin-Runner gestartet, nicht direkt.`);
  return v;
};

function mailbox(): Mailbox {
  const v = process.env.SDC_MAILBOX || 'shared';
  if (v !== 'shared' && v !== 'demo')
    throw new Error(`SDC_MAILBOX muss shared oder demo sein, nicht „${v}“.`);
  return v;
}

function settings() {
  const config = loadConfig();
  if (!config) throw new Error('Keine Einstellungen gefunden — bitte zuerst das Setup ausführen.');
  const password = readGatePassword();
  if (!password) throw new Error('Kein Staging-Passwort gespeichert — bitte im Setup eingeben.');
  return { config, password };
}

type Options = {
  persona: string;
  loginPath: string;
  signInSelectors: SignInSelectors;
  codePattern: RegExp | undefined;
};

type Fixtures = {
  staging: Staging;
  account: (label: string) => Promise<void>;
  shot: (step: string) => Promise<string>;
  layout: (opts: LayoutOpts & { keyboard?: boolean }) => Promise<RuleResult[]>;
};

export const test = base.extend<Options & Fixtures>({
  persona: ['standard', { option: true }],
  loginPath: ['/login', { option: true }],
  signInSelectors: [{}, { option: true }],
  codePattern: [undefined, { option: true }],

  staging: async ({ page, context }, use, testInfo) => {
    const { config, password } = settings();
    let lastStatus: number | null = null;
    await withStaging(
      {
        host: need('SDC_HOST'),
        page: {
          goto: async (url) => {
            const r = await page.goto(url, { waitUntil: 'domcontentloaded' });
            lastStatus = r ? r.status() : null;
          },
          landing: async () => ({
            url: page.url(),
            status: lastStatus,
            title: await page.title().catch(() => ''),
            text: await page
              .evaluate(() => (document.body ? document.body.innerText.slice(0, 2000) : ''))
              .catch(() => ''),
          }),
        },
        context,
        mint: async (host) => {
          const token = await mintRunToken(config.apex, host, config.tokenMinutes, password);
          // hand the value to the runner, which masks it in every file of the run folder afterwards
          appendFileSync(join(need('SDC_RUN_DIR'), '.run-tokens'), `${token.value}\n`, {
            mode: 0o600,
          });
          return token;
        },
        warn: (message) => {
          testInfo.annotations.push({ type: 'warnung', description: message });
          console.error(message);
        },
      },
      use,
    );
  },

  account: async ({ page, staging, loginPath, signInSelectors, codePattern }, use, testInfo) => {
    const { config, password } = settings();
    // one local gate session per account() use (this machine only, never the device session)
    let gate: string | null = null;
    const gateCookie = async () => (gate ??= (await gateLogin(config.apex, password)).value);
    await use(async (label) => {
      const account = config.accounts.find((a) => a.label === label);
      if (!account) throw new Error(`Testkonto „${label}“ ist im Setup nicht hinterlegt.`);
      try {
        await signIn(page, account, {
          goto: (path) => staging.goto(path),
          loginPath,
          selectors: signInSelectors,
          runDir: need('SDC_RUN_DIR'),
          mailbox: mailbox(),
          codes: {
            snapshot: async (email) => mailboxSnapshot(config.apex, await gateCookie(), email),
            read: async (email, known) =>
              latestLoginCode(config.apex, await gateCookie(), email, known, fetch, undefined, {
                pattern: codePattern,
              }),
          },
        });
      } catch (e) {
        if (e instanceof NichtPruefbarHier) {
          testInfo.annotations.push({ type: 'nicht prüfbar hier', description: e.message });
          testInfo.skip(true, e.message);
        }
        throw e;
      }
    });
  },

  shot: async ({ page, persona }, use, testInfo) => {
    const dir = join(need('SDC_RUN_DIR'), 'screenshots');
    mkdirSync(dir, { recursive: true });
    let n = 0;
    await use(async (step) => {
      const path = join(
        dir,
        shotName(need('SDC_TICKET'), testInfo.project.name, persona, ++n, step),
      );
      await page.screenshot({ path });
      return path;
    });
  },

  layout: async ({ page }, use) => {
    await use(async ({ keyboard, ...opts }) => {
      const settled = await measure(page, opts);
      const ua = await page.evaluate(() => navigator.userAgent);
      const platform = /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'android';
      if (keyboard) return noteLayout(evaluateRules(settled, 'keyboard', platform));
      const results = evaluateRules(settled, 'settled', platform);
      if (opts.actionBar) {
        const y = settled.scrollY;
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        results.push(
          ...evaluateRules(await measure(page, opts), 'pageend', platform).filter(
            (r) => r.rule === 'R3',
          ),
        );
        await evaluateWith(page, (top: number) => window.scrollTo(0, top), y);
      }
      return noteLayout(results);
    });
  },
});

/** What `check()` hands the check's body. */
export type CheckTools = {
  /** shows the check as "zu prüfen (Bild)" with this screenshot's name (call it after `shot()`) */
  zuPruefen: (shotPath: string, hint?: string) => void;
};

export type CheckOptions = {
  /** needs the on-screen keyboard: on iOS (no keyboard through Playwright) "nicht prüfbar hier", body skipped */
  keyboard?: boolean;
};

const IOS = /iphone|ipad|ios/i; // the same device rule as the report's iPhone column

/**
 * One check of the ticket = one `test.step` with this title, which becomes the row of the result section. The title
 * and every annotation about it live here, so they cannot diverge. Assert with `expect.soft` inside, so a failing
 * check does not stop the next one.
 */
export async function check(
  title: string,
  body: (tools: CheckTools) => Promise<void> | void,
  opts: CheckOptions = {},
): Promise<void> {
  await base.step(title, async (step) => {
    const info = base.info();
    const ios = IOS.test(info.project.name);
    const notHere = (reason: string) =>
      info.annotations.push({ type: 'nicht prüfbar hier', description: stepNote(title, reason) });
    if (opts.keyboard && ios) {
      notHere('Tastatur auf iOS — auf eigenem iPhone prüfen');
      step.skip(); // ends only this check's body; the persona's other checks still run
    }
    const end = beginCheck();
    let failure: unknown = null;
    try {
      await body({
        zuPruefen: (shotPath, hint) =>
          info.annotations.push({
            type: 'zu prüfen',
            description: stepNote(
              title,
              hint ? `${hint} — ${basename(shotPath)}` : basename(shotPath),
            ),
          }),
      });
    } catch (e) {
      failure = e;
    }
    // fail closed: what layout() could not measure on iOS is never a pass, whatever the spec asserted
    const reason = unmeasured(end());
    if (ios && reason) notHere(reason);
    if (failure) throw failure;
  });
}

export { expect };
