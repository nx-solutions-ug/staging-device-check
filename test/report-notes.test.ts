import { describe, expect, test } from 'bun:test';
import { parseResult, renderStand, type RunCheck, type RunResult } from '../src/report.js';

const HOST = 'd-acme-de--main.dating.staging.example.test';
const DATE = new Date('2026-11-12T10:30:00');
const ANDROID = 'chrome-Samsung Galaxy S23:13.0-browserstack-mobile';
const ESC = String.fromCharCode(27);

const failed = (message: string, project = ANDROID) => ({
  suites: [
    {
      title: 'tests-e2e.spec.ts',
      specs: [
        {
          title: 'Konto A (frau)',
          tests: [
            {
              projectName: project,
              results: [{ status: 'failed', steps: [{ title: 'Eins', error: { message } }] }],
            },
          ],
        },
      ],
    },
  ],
});
const note = (message: string) => {
  const r = parseResult(failed(message) as never, []);
  return { note: r.checks[0].note, log: r.log, outcome: r.checks[0].outcome };
};

describe('a failed check reads as a sentence, the raw message goes to the log', () => {
  test("the spec's own sentence stays, without the Error prefix and the Expected/Received block", () => {
    const r = note(
      `Error: Abstand Hinweis → Button -6 px\n\n${ESC}[2mexpect(${ESC}[22mreceived).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 0\nReceived:    -6`,
    );
    expect(r).toEqual({
      note: 'Abstand Hinweis → Button -6 px',
      log: [],
      outcome: 'nicht bestanden',
    });
  });

  test('"ok" parts of a joined list are dropped', () => {
    expect(
      note('Error: ok; Ort A: 447..491 außerhalb 198..489; ok; Ort B: fehlt\n\nexpect').note,
    ).toBe('Ort A: 447..491 außerhalb 198..489; Ort B: fehlt');
  });

  test('a harness error keeps its German message without the class name', () => {
    expect(note('StagingZugangFehler: Der Run-Token wurde nicht angenommen.').note).toBe(
      'Der Run-Token wurde nicht angenommen.',
    );
  });

  test.each([
    [
      'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 0\nReceived: 138',
      'Messung nicht wie erwartet',
    ],
    [
      `Error: ${ESC}[2mexpect(${ESC}[22mlocator).toBeVisible() failed\n\nLocator: x`,
      'Element nicht sichtbar',
    ],
    ['Error: expect(locator).toBeEnabled() failed', 'Element nicht bedienbar'],
    ['Error: expect(locator).toHaveText(expected) failed', 'Text nicht wie erwartet'],
    ['Test timeout of 30000ms exceeded.', 'Zeitüberschreitung: der Test lief zu lange'],
    [
      'TimeoutError: locator.tap: Timeout 15000ms exceeded.\nCall log:',
      'Zeitüberschreitung bei einer Aktion auf der Seite',
    ],
    ['Error: locator.tap: Element is not visible', 'Aktion auf der Seite fehlgeschlagen'],
    ['Error: page.goto: net::ERR_NAME_NOT_RESOLVED', 'Seite konnte nicht geöffnet werden'],
    ['page.goto: 503 Service Unavailable', 'Seite konnte nicht geöffnet werden'],
    [
      'Error: locator.fill: Error: strict mode violation: getByRole(...) resolved to 2 elements',
      'Element nicht eindeutig gefunden',
    ],
    ['TypeError: fetch failed: connect ECONNREFUSED 127.0.0.1:443', 'Technischer Fehler im Test'],
    ['ReferenceError: x is not defined', 'Technischer Fehler im Test'],
  ])('a Playwright or JavaScript message becomes a short sentence: %s', (message, sentence) => {
    const r = note(message);
    expect(r.note).toBe(`${sentence} (Details im Log)`);
    expect(r.outcome).toBe('nicht bestanden');
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain(
      message.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '').split('\n')[0],
    );
    expect(r.log[0]).not.toContain(ESC);
  });

  test('the log line names the device and the check', () => {
    expect(note('Test timeout of 30000ms exceeded.').log[0]).toMatch(
      /^Android – Eins: Test timeout/,
    );
  });

  test('no row of a real failure keeps an English Playwright text', () => {
    for (const m of [
      'Error: expect(received).toEqual(expected)',
      'Error: locator.click: Target page, context or browser has been closed',
      'Error: frame.waitForFunction: Timeout 5000ms exceeded.',
    ])
      expect(note(m).note).not.toMatch(/expect\(|locator\.|frame\.|Timeout \d+ms|Target page/);
  });
});

const row = (
  title: string,
  device: 'iPhone' | 'Android',
  outcome: RunCheck['outcome'],
  n = '',
): RunCheck => ({
  title,
  device,
  project: device,
  outcome,
  note: n,
});
const IP1 = 'ACME-1_safari-iphone-16_frau_01-wohnort-start.png';
const IP2 = 'ACME-1_safari-iphone-16_frau_02-ortsfeld.png';
const AN1 = 'ACME-1_chrome-samsung-galaxy-s23_frau_01-wohnort-start.png';
const result = (checks: RunCheck[], screenshots = [AN1, IP2, IP1]): RunResult => ({
  checks,
  screenshots,
  log: [],
});
const tableOf = (md: string) =>
  md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Prüfung'));
const render = (r: RunResult) =>
  renderStand(r, 'ACME-1', HOST, ['iPhone 16', 'Samsung Galaxy S23'], DATE);

describe('images are numbered once, the table refers to them by number', () => {
  test('the list numbers every image once, iPhone first, with device and step', () => {
    const md = render(result([row('Eins', 'iPhone', 'bestanden')]));
    expect(md).toContain(
      [
        'Bilder zum Anhängen:',
        `1. iPhone – Wohnort start (${IP1})`,
        `2. iPhone – Ortsfeld (${IP2})`,
        `3. Android – Wohnort start (${AN1})`,
      ].join('\n'),
    );
  });

  test('no file name appears in the table, and each appears exactly once in the section', () => {
    const md = render(
      result([
        row('Optik', 'iPhone', 'zu prüfen (Bild)', `Box nur so hoch wie Ortsfeld — ${IP1}`),
        row('Optik', 'Android', 'zu prüfen (Bild)', `Box nur so hoch wie Ortsfeld — ${AN1}`),
        row('Feld', 'iPhone', 'zu prüfen (Bild)', IP2),
      ]),
    );
    for (const line of tableOf(md)) expect(line).not.toContain('.png');
    for (const f of [IP1, IP2, AN1]) expect(md.split(f).length - 1).toBe(1);
  });

  test('identical notes of both devices are merged, each image named with its device', () => {
    const md = render(
      result([
        row('Optik', 'iPhone', 'zu prüfen (Bild)', `Box nur so hoch wie Ortsfeld — ${IP1}`),
        row('Optik', 'Android', 'zu prüfen (Bild)', `Box nur so hoch wie Ortsfeld — ${AN1}`),
      ]),
    );
    expect(tableOf(md)).toEqual([
      '| Optik | zu prüfen (Bild) | zu prüfen (Bild) | Box nur so hoch wie Ortsfeld — Bild 1 (iPhone), Bild 3 (Android) |',
    ]);
  });

  test('a note that is only an image reads "Bild N"; different notes stay per device', () => {
    const md = render(
      result([
        row('Feld', 'iPhone', 'zu prüfen (Bild)', IP2),
        row('Feld', 'Android', 'nicht bestanden', 'Abstand -6 px'),
      ]),
    );
    expect(tableOf(md)).toEqual([
      '| Feld | zu prüfen (Bild) | nicht bestanden | iPhone: Bild 2; Android: Abstand -6 px |',
    ]);
  });

  test('an image the note names but the folder lacks reads "Bild fehlt", never its file name', () => {
    const md = render(
      result([
        row('Feld', 'iPhone', 'zu prüfen (Bild)', 'ACME-1_safari-iphone-16_frau_09-weg.png'),
      ]),
    );
    expect(tableOf(md)).toEqual(['| Feld | zu prüfen (Bild) | — | iPhone: Bild fehlt |']);
  });

  test("another ticket's images are left out of the list", () => {
    const md = render(
      result([row('Eins', 'iPhone', 'bestanden')], [IP1, 'OTHER-2_safari-iphone-16_x_01-y.png']),
    );
    expect(md).not.toContain('OTHER-2');
    expect(md).toContain(`1. iPhone – Wohnort start (${IP1})`);
  });
});
