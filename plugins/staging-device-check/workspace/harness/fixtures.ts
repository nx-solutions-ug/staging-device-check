/**
 * Playwright fixtures for generated specs: `import { test, expect } from '../harness/fixtures.js'`.
 * Run context comes from the runner (env): SDC_HOST (app host), SDC_RUN_DIR (run folder), SDC_TICKET, and
 * SDC_MAILBOX = shared (default) | demo — with a live demo the login code lands in the demo's own mailbox.
 * Options set by the spec with `test.use(...)`: `persona`, and for sign-in `loginPath`, `signInSelectors`,
 * `codePattern` (all found on the first local look), and `consentButton`: the consent banner's most
 * privacy-preserving button as the local look showed it (a per-project `consentButtons` entry in the settings wins).
 * The device label is the project name.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  consentButtonFor,
  gateLogin,
  latestLoginCode,
  loadConfig,
  mailboxSnapshot,
  mintRunToken,
  readGatePassword,
} from './lib.js';
import { appCookieParam } from './app-cookie.js';
import { beginCheck, noteLayout, unmeasured } from './check-state.js';
import { consentBanner, consentShownInPage, type Consent } from './consent.js';
import {
  closeKeyboard,
  setNativeInPage,
  tapSafely,
  typeSafely,
  valueInPage,
  viewportInPage,
  type TapOptions,
  type TypeMethod,
} from './input.js';
import { probeInPage, settle, unsettled } from './settle.js';
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
  consentButton: string | undefined;
};

export type TypeIntoOptions = {
  /** the app noticed the value (e.g. its suggestions are visible); default: the field reads the value back */
  until?: () => Promise<boolean>;
  waitMs?: number;
};

type Fixtures = {
  staging: Staging;
  account: (label: string) => Promise<void>;
  shot: (step: string) => Promise<string>;
  layout: (opts: LayoutOpts & { keyboard?: boolean }) => Promise<RuleResult[]>;
  /** sets a preference cookie the app reads (its language) on the confirmed host — before the first navigation */
  appCookie: (name: string, value: string) => Promise<void>;
  /** taps after closing the keyboard and dismissing a late consent banner; the only way a spec taps */
  tap: (target: Locator, opts?: TapOptions) => Promise<void>;
  /** types into the field (CSS selector) with the iOS-safe order of methods; the only way a spec types */
  typeInto: (selector: string, value: string, opts?: TypeIntoOptions) => Promise<TypeMethod>;
  /** closes the on-screen keyboard without tapping anything (after a check that measured it open) */
  closeKeyboard: () => Promise<boolean>;
  consent: Consent;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clock = { sleep, now: () => Date.now() };

const keyboardOf = (page: Page) => ({
  viewport: () => page.evaluate(viewportInPage),
  blur: () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()),
});

async function atRest(page: Page, opts: LayoutOpts) {
  const s = await settle(() => evaluateWith(page, probeInPage, opts), clock);
  console.error(`layout(): Seite ${s.stable ? 'ruhig' : 'NICHT ruhig'} nach ${s.ms} ms`);
  return s;
}

export const test = base.extend<Options & Fixtures>({
  persona: ['standard', { option: true }],
  loginPath: ['/login', { option: true }],
  signInSelectors: [{}, { option: true }],
  codePattern: [undefined, { option: true }],
  consentButton: [undefined, { option: true }],

  consent: async ({ page, consentButton }, use) => {
    const label = consentButtonFor(loadConfig(), need('SDC_HOST'), consentButton);
    const button = (l: string) => page.getByRole('button', { name: l, exact: true }).first();
    await use(
      consentBanner(label, {
        shown: (l) => evaluateWith(page, consentShownInPage, l),
        appears: (l, ms) =>
          button(l)
            .waitFor({ state: 'visible', timeout: ms })
            .then(() => true)
            .catch(() => false),
        dismiss: async (l) => {
          await button(l).tap();
          await button(l)
            .waitFor({ state: 'hidden', timeout: 10_000 })
            .catch(() => undefined);
        },
      }),
    );
  },

  staging: async ({ page, context, consent }, use, testInfo) => {
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
      (s) =>
        use({
          host: s.host,
          goto: async (path) => {
            await s.goto(path);
            await consent.afterGoto();
          },
        }),
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

  shot: async ({ page, persona, consent }, use, testInfo) => {
    const dir = join(need('SDC_RUN_DIR'), 'screenshots');
    mkdirSync(dir, { recursive: true });
    let n = 0;
    await use(async (step) => {
      const path = join(
        dir,
        shotName(need('SDC_TICKET'), testInfo.project.name, persona, ++n, step),
      );
      await consent.look();
      await page.screenshot({ path });
      return path;
    });
  },

  appCookie: async ({ context }, use) => {
    await use(async (name, value) => {
      await context.addCookies([appCookieParam(need('SDC_HOST'), name, value)]);
    });
  },

  closeKeyboard: async ({ page }, use) => {
    await use(() => closeKeyboard({ ...clock, ...keyboardOf(page) }));
  },

  tap: async ({ consent }, use) => {
    await use(async (target, opts) => {
      const page = target.page();
      await tapSafely(
        {
          ...clock,
          ...keyboardOf(page),
          ready: async () => {
            await expect(target).toBeVisible();
            await expect(target).toBeEnabled();
          },
          tap: () => target.tap(),
          consent: () => consent.look(),
        },
        opts,
      );
    });
  },

  typeInto: async ({ page, tap }, use) => {
    await use(async (selector, value, opts = {}) => {
      const field = page.locator(selector).first();
      const method = await typeSafely(
        {
          ...clock,
          tapField: () => tap(field, { keepKeyboard: true }),
          fill: (v) => field.fill(v),
          setNative: (v) => evaluateWith(page, setNativeInPage, { selector, value: v }),
          pressSequentially: (v) => field.pressSequentially(v),
          arrived:
            opts.until ?? (async () => (await evaluateWith(page, valueInPage, selector)) === value),
        },
        selector,
        value,
        { waitMs: opts.waitMs ?? (opts.until ? undefined : 1_500) },
      );
      console.error(`typeInto ${selector}: ${method}`);
      return method;
    });
  },

  layout: async ({ page, consent }, use) => {
    await use(async ({ keyboard, ...opts }) => {
      await consent.look();
      const ua = await page.evaluate(() => navigator.userAgent);
      const platform = /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'android';
      // the iOS keyboard phase is never measured (no keyboard through Playwright): nothing to wait for
      if (keyboard && platform === 'ios')
        return noteLayout(evaluateRules(await measure(page, opts), 'keyboard', platform));
      const first = await atRest(page, opts);
      const settled = await measure(page, opts);
      if (keyboard)
        return noteLayout(unsettled(evaluateRules(settled, 'keyboard', platform), first));
      const results = unsettled(evaluateRules(settled, 'settled', platform), first);
      if (opts.actionBar) {
        const y = settled.scrollY;
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const end = await atRest(page, opts);
        results.push(
          ...unsettled(
            evaluateRules(await measure(page, opts), 'pageend', platform).filter(
              (r) => r.rule === 'R3',
            ),
            end,
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

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** A failed `toBe('bestanden')` on a rule that came back "nicht prüfbar hier" or was not measured at all. */
const aboutUnmeasuredRule = (message: string): boolean => {
  const m = message.replace(ANSI, '');
  return /Expected: "bestanden"/.test(m) && /Received: (undefined|"nicht prüfbar hier")/.test(m);
};

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
    const errorsBefore = info.errors.length;
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
    // fail closed: what layout() could not measure on iOS is never a pass, whatever the spec asserted. A real
    // failure wins, though: only a check whose every failed assertion is about an unmeasured rule is not checkable.
    const reason = unmeasured(end());
    const failed = [
      ...info.errors.slice(errorsBefore).map((e) => e.message ?? ''),
      ...(failure ? [failure instanceof Error ? failure.message : String(failure)] : []),
    ];
    if (ios && reason && failed.every(aboutUnmeasuredRule)) notHere(reason);
    if (failure) throw failure;
  });
}

export { expect };
