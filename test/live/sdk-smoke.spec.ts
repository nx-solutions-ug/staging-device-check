/**
 * Live SDK smoke on BrowserStack (opt-in; `bun test` ignores test/live). Copy it into a run folder made by
 * `cli.js prepare` and start it with `cli.js run`. It needs no staging: the page is synthetic, on a reserved
 * example domain. Results go into docs/live-checks.md.
 */
import { existsSync } from 'node:fs';
import { check, expect, test } from './harness/fixtures.js';

const ORIGIN = 'https://example.com';

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; font: 16px sans-serif; }
  #head { position: sticky; top: 0; height: 56px; background: #eee; }
  /* fixed, so the probe never adds to the scroll height (absolute made iOS scroll 741 − 659 = 82 px) */
  #lvh { position: fixed; top: 0; left: 0; width: 1px; height: 100lvh; visibility: hidden; }
  main { padding: 16px 16px 96px; }
  #name { display: block; width: 100%; height: 48px; font-size: 16px; box-sizing: border-box; }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; height: 80px; background: #ddd; display: flex; align-items: center; justify-content: center; }
  #bar button { min-width: 120px; height: 48px; font-size: 16px; }
</style></head><body>
  <div id="lvh"></div>
  <header id="head">Kopf</header>
  <main><p id="first">Inhalt</p><label for="name">Name</label><input id="name" autocomplete="off"></main>
  <div id="bar"><button type="submit">Weiter</button></div>
</body></html>`;

test('sdk smoke', async ({ page, context, shot, layout }, testInfo) => {
  const note = (type: string, description: string) =>
    testInfo.annotations.push({ type, description });
  const ios = /iPhone|iPad|iPod/.test(await page.evaluate(() => navigator.userAgent));

  await check('cookie through addCookies(url)', async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await context.addCookies([
      { name: 'sdc_smoke', value: 'eins', url: ORIGIN, secure: true, sameSite: 'Lax' },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const seen = await page.evaluate(() => document.cookie);
    note(
      'cookie',
      `document.cookie nach addCookies: ${seen.includes('sdc_smoke=eins') ? 'gesehen' : 'nicht gesehen'}`,
    );
    expect.soft(seen).toContain('sdc_smoke=eins');
    try {
      await context.clearCookies({ name: 'sdc_smoke' });
      note('clearCookies(name)', 'unterstützt');
    } catch (e) {
      // the harness teardown falls back the same way
      note('clearCookies(name)', `abgelehnt: ${(e as Error).message.split('\n')[0]}`);
      await context.clearCookies();
    }
    const left = (await context.cookies(ORIGIN)).filter((c) => c.name === 'sdc_smoke');
    note('clearCookies', left.length === 0 ? 'entfernt' : 'noch da');
    expect.soft(left).toHaveLength(0);
  });

  await page.setContent(PAGE);

  await check('viewport numbers', async () => {
    const v = await page.evaluate(() => ({
      inner: window.innerHeight,
      lvh: Math.round(document.getElementById('lvh')!.getBoundingClientRect().height),
      vv: Math.round(window.visualViewport?.height ?? -1),
      width: window.innerWidth,
    }));
    note(
      'viewport',
      `innerHeight ${v.inner}, 100lvh ${v.lvh}, visualViewport ${v.vv}, innerWidth ${v.width}`,
    );
    if (ios) {
      // spec §8, legacy probe on iPhone 16 / iOS 18: 659 / 741 / 659
      expect.soft(v.inner).toBe(659);
      expect.soft(v.lvh).toBe(741);
      expect.soft(v.vv).toBe(659);
    } else expect.soft(v.inner).toBeGreaterThan(0);
  });

  await check('tap and fill focus the input', async () => {
    await page.locator('#name').tap();
    // the focus can land a moment after the tap (Android): wait briefly instead of checking at once
    await page
      .waitForFunction(() => document.activeElement?.id === 'name', undefined, { timeout: 3000 })
      .catch(() => {});
    const afterTap = await page.evaluate(() => document.activeElement?.id ?? '');
    note('tap', `Fokus nach tap: ${afterTap || 'keiner'}`);
    expect.soft(afterTap).toBe('name');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.locator('#name').fill('Probe');
    const afterFill = await page.evaluate(() => ({
      id: document.activeElement?.id ?? '',
      value: (document.getElementById('name') as HTMLInputElement).value,
    }));
    note('fill', `Fokus nach fill: ${afterFill.id || 'keiner'}, Wert „${afterFill.value}“`);
    expect.soft(afterFill).toEqual({ id: 'name', value: 'Probe' });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });

  await check('shot writes a file', async () => {
    const path = await shot('Smoke');
    note('shot', existsSync(path) ? 'Datei geschrieben' : 'keine Datei');
    expect.soft(existsSync(path)).toBe(true);
  });

  await check('layout returns R1 for the pass variant', async () => {
    const results = await layout({
      header: '#head',
      actionBar: '#bar',
      footer: '#bar',
      top: '#first',
    });
    note('layout', results.map((r) => `${r.rule} ${r.outcome} (${r.detail})`).join('; '));
    expect.soft(results.find((r) => r.rule === 'R1')?.outcome).toBe('bestanden');
  });
});
