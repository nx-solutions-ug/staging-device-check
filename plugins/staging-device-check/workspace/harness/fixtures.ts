/**
 * Playwright fixtures for generated specs: `import { test, expect } from '../harness/fixtures.js'`.
 * Run context comes from the runner (env): SDC_HOST (app host), SDC_RUN_DIR (run folder), SDC_TICKET.
 * Options set by the spec with `test.use(...)`: `persona`, and for sign-in `loginPath`, `signInSelectors`,
 * `codePattern` (all found on the first local look). The device label is the project name.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import { gateLogin, latestLoginCode, loadConfig, mintRunToken, readGatePassword } from './lib.js';
import { measure, type LayoutOpts } from './measure.js';
import { shotName } from './names.js';
import { evaluateRules, type RuleResult } from './rules.js';
import { signIn, type SignInSelectors } from './signin.js';
import { withStaging, type Staging } from './staging.js';

export { shotName, slug } from './names.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v)
    throw new Error(`${name} fehlt — die Tests werden vom Plugin-Runner gestartet, nicht direkt.`);
  return v;
};

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
        mint: (host) => mintRunToken(config.apex, host, config.tokenMinutes, password),
        warn: (message) => {
          testInfo.annotations.push({ type: 'warnung', description: message });
          console.error(message);
        },
      },
      use,
    );
  },

  account: async ({ page, staging, loginPath, signInSelectors, codePattern }, use) => {
    const { config, password } = settings();
    await use(async (label) => {
      const account = config.accounts.find((a) => a.label === label);
      if (!account) throw new Error(`Testkonto „${label}“ ist im Setup nicht hinterlegt.`);
      await signIn(page, account, {
        goto: (path) => staging.goto(path),
        loginPath,
        selectors: signInSelectors,
        runDir: need('SDC_RUN_DIR'),
        readCode: async (email, since) => {
          // local gate session (this machine), never the device session
          const gate = await gateLogin(config.apex, password);
          return latestLoginCode(config.apex, gate.value, email, since, fetch, undefined, {
            pattern: codePattern,
          });
        },
      });
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
      if (keyboard) return evaluateRules(settled, 'keyboard', platform);
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
        await page.evaluate((top) => window.scrollTo(0, top), y);
      }
      return results;
    });
  },
});

export { expect };
