/**
 * Playwright fixtures for generated specs: `import { test, expect } from '../harness/fixtures.js'`.
 * Run context comes from the runner (env): SDC_HOST (app host), SDC_RUN_DIR (run folder), SDC_TICKET.
 * Persona is a fixture option (`test.use({ persona: '…' })`); the device label is the project name.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import { loadConfig, mintRunToken, readGatePassword } from './lib.js';
import { measure, type LayoutOpts } from './measure.js';
import { evaluateRules, type RuleResult } from './rules.js';
import { withStaging, type Staging } from './staging.js';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

/** `<TICKET>_<device>_<persona>_<NN>-<step-slug>.png` (Global Constraints). */
export function shotName(
  ticket: string,
  device: string,
  persona: string,
  n: number,
  step: string,
): string {
  return `${ticket}_${slug(device)}_${slug(persona)}_${String(n).padStart(2, '0')}-${slug(step)}.png`;
}

const need = (name: string): string => {
  const v = process.env[name];
  if (!v)
    throw new Error(`${name} fehlt — die Tests werden vom Plugin-Runner gestartet, nicht direkt.`);
  return v;
};

type Fixtures = {
  persona: string;
  staging: Staging;
  shot: (step: string) => Promise<string>;
  layout: (opts: LayoutOpts & { keyboard?: boolean }) => Promise<RuleResult[]>;
};

export const test = base.extend<Fixtures>({
  persona: ['standard', { option: true }],

  staging: async ({ page, context }, use) => {
    const config = loadConfig();
    if (!config)
      throw new Error('Keine Einstellungen gefunden — bitte zuerst das Setup ausführen.');
    const password = readGatePassword();
    if (!password) throw new Error('Kein Staging-Passwort gespeichert — bitte im Setup eingeben.');
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
      },
      use,
    );
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
