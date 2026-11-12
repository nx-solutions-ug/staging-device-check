import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseResult, renderStand } from '../src/report.js';
import { stepNote } from '../plugins/staging-device-check/workspace/harness/names.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/report/${name}`, import.meta.url), 'utf8');
const HOST = 'd-acme-de--main.dating.staging.example.test';
const DATE = new Date('2026-11-12T10:30:00');
const SHOTS = [
  'ACME-1_samsung-galaxy-s23_tester-a_01-start.png',
  'OTHER-2_iphone-16_x_01-y.png',
  'ACME-1_iphone-16_tester-a_01-start.png',
];

describe('parseResult', () => {
  test('maps Playwright statuses and annotations to the result vocabulary', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), SHOTS);
    const by = (title: string, device: string) =>
      r.checks.find((c) => c.title === title && c.device === device)?.outcome;
    expect(by('Weiter-Knopf bleibt über der Tastatur sichtbar', 'iPhone')).toBe(
      'nicht prüfbar hier',
    );
    expect(by('Weiter-Knopf bleibt über der Tastatur sichtbar', 'Android')).toBe('bestanden');
    expect(by('Profilbild | Rahmen sieht wie im Entwurf aus', 'iPhone')).toBe('zu prüfen (Bild)');
    expect(by('Seite startet oben', 'Android')).toBe('nicht bestanden');
  });

  test('a skipped test with the annotation is never a pass or a failure', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), []);
    const skipped = r.checks.filter((c) => c.outcome === 'nicht prüfbar hier');
    expect(skipped).toHaveLength(1);
  });
});

describe('parseResult skips', () => {
  test('a skip without the annotation is a failure, noted as skipped without reason', () => {
    const report = {
      suites: [
        {
          title: 'a.spec.ts',
          specs: [
            {
              title: 'ohne Grund übersprungen',
              tests: [
                {
                  projectName: 'Samsung Galaxy S23',
                  annotations: [],
                  results: [{ status: 'skipped' }],
                  status: 'skipped',
                },
              ],
            },
          ],
        },
      ],
    };
    const [c] = parseResult(report as never, []).checks;
    expect(c.outcome).toBe('nicht bestanden');
    expect(c.note).toBe('übersprungen ohne Grund');
  });
});

describe('parseResult with test.step checks (one test per persona)', () => {
  // test/fixtures/report/steps.json: a real Playwright 1.62.1 JSON report — one persona test, four steps, two devices
  const steps = () => parseResult(JSON.parse(fixture('steps.json')), []);
  const row = (title: string, device: string) =>
    steps().checks.find((c) => c.title === title && c.device === device);

  test('one persona test with steps gives one row per step and device', () => {
    const r = steps();
    expect([...new Set(r.checks.map((c) => c.title))]).toEqual([
      'Preis wird angezeigt',
      'Wohnort-Schritt zeigt die Auswahl',
      'Abstände wie im Entwurf',
      'Weiter-Knopf über der Tastatur',
    ]);
    expect(r.checks).toHaveLength(8);
    expect(row('Preis wird angezeigt', 'Android')?.outcome).toBe('nicht bestanden');
    expect(row('Preis wird angezeigt', 'Android')?.note).toContain('Preis');
    expect(row('Preis wird angezeigt', 'Android')?.note).not.toContain(String.fromCharCode(27));
    expect(row('Abstände wie im Entwurf', 'iPhone')?.outcome).toBe('zu prüfen (Bild)');
    expect(row('Abstände wie im Entwurf', 'iPhone')?.note).toBe(
      'ACME-1_iphone_frau_01-wohnort.png',
    );
  });

  test('a soft failure in one step leaves the next step running and passing', () => {
    expect(row('Wohnort-Schritt zeigt die Auswahl', 'iPhone')?.outcome).toBe('bestanden');
    expect(row('Wohnort-Schritt zeigt die Auswahl', 'Android')?.outcome).toBe('bestanden');
  });

  test('the iOS keyboard step alone is nicht prüfbar hier, the rest of the persona is measured', () => {
    expect(row('Weiter-Knopf über der Tastatur', 'iPhone')?.outcome).toBe('nicht prüfbar hier');
    expect(row('Weiter-Knopf über der Tastatur', 'iPhone')?.note).toBe(
      'Tastatur auf iOS — auf eigenem iPhone prüfen',
    );
    expect(row('Weiter-Knopf über der Tastatur', 'Android')?.outcome).toBe('bestanden');
    const others = steps().checks.filter(
      (c) => c.device === 'iPhone' && c.title !== 'Weiter-Knopf über der Tastatur',
    );
    expect(others.map((c) => c.outcome)).not.toContain('nicht prüfbar hier');
  });

  test('three steps passed / failed / zu prüfen render as three rows', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'Konto A (frau)',
              tests: [
                {
                  projectName: 'chrome-Samsung Galaxy S23:13.0',
                  annotations: [{ type: 'zu prüfen', description: 'Bild: ACME-1_x_01-a.png' }],
                  results: [
                    {
                      status: 'failed',
                      steps: [
                        { title: 'Text', duration: 1 },
                        {
                          title: 'Preis',
                          duration: 1,
                          error: { message: 'Error: falscher Preis' },
                        },
                        { title: 'Bild', duration: 1 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = renderStand(
      parseResult(report as never, []),
      'ACME-1',
      HOST,
      ['Samsung Galaxy S23'],
      DATE,
    );
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Prüfung'));
    expect(rows).toEqual([
      '| Text | — | bestanden | — |',
      '| Preis | — | nicht bestanden | Android: Error: falscher Preis |',
      '| Bild | — | zu prüfen (Bild) | Android: ACME-1_x_01-a.png |',
    ]);
  });

  test('the harness note format is the one report reads', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'Konto A',
              tests: [
                {
                  projectName: 'safari-iPhone 16:18',
                  annotations: [
                    { type: 'zu prüfen', description: stepNote('Bild: Kopf', 'ACME-1_a.png') },
                    { type: 'nicht prüfbar hier', description: stepNote('Tastatur', 'iOS') },
                  ],
                  results: [
                    { status: 'passed', steps: [{ title: 'Bild: Kopf' }, { title: 'Tastatur' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseResult(report as never, []).checks.map((c) => [c.outcome, c.note])).toEqual([
      ['zu prüfen (Bild)', 'ACME-1_a.png'],
      ['nicht prüfbar hier', 'iOS'],
    ]);
  });

  test('a failure outside every step (e.g. sign-in) gets its own row', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: 'Konto A (frau)',
              tests: [
                {
                  projectName: 'safari-iPhone 16:18',
                  results: [
                    {
                      status: 'failed',
                      errors: [{ message: 'Error: Anmeldung fehlgeschlagen' }],
                      steps: [{ title: 'Text', duration: 1 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = parseResult(report as never, []);
    expect(r.checks.map((c) => [c.title, c.outcome])).toEqual([
      ['Text', 'bestanden'],
      ['Konto A (frau): Ablauf', 'nicht bestanden'],
    ]);
  });
});

describe('renderStand', () => {
  test('renderStand golden output', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), SHOTS);
    expect(renderStand(r, 'ACME-1', HOST, ['iPhone 16', 'Samsung Galaxy S23'], DATE)).toBe(
      fixture('stand.md'),
    );
  });

  test('renderStand adds the own-iPhone line only when needed', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), SHOTS);
    const withoutSkip = {
      ...r,
      checks: r.checks.filter((c) => c.outcome !== 'nicht prüfbar hier'),
    };
    const md = renderStand(withoutSkip, 'ACME-1', HOST, ['iPhone 16'], DATE);
    expect(md).not.toContain('Auf dem eigenen iPhone prüfen');
    expect(renderStand(r, 'ACME-1', HOST, ['iPhone 16'], DATE)).toContain(
      'Auf dem eigenen iPhone prüfen:',
    );
  });

  test('heading without devices has no trailing separator', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), SHOTS);
    const first = renderStand(r, 'ACME-1', HOST, [], DATE).split('\n')[0];
    expect(first).toMatch(/^\*\*Gerätetest 12\.11\.2026 – [^,]+\*\*$/);
  });

  test('no screenshots and no signed URLs', () => {
    const r = parseResult(JSON.parse(fixture('result.json')), []);
    const md = renderStand(r, 'ACME-1', HOST, ['iPhone 16'], DATE);
    expect(md).toContain('Bilder zum Anhängen: keine');
    expect(md).not.toMatch(/https?:\/\//);
  });
});

describe('an aborted run', () => {
  const IPHONE = 'safari-iPhone 16:18-browserstack-mobile';
  const SDK_ERROR =
    'Error: 14 UNAVAILABLE: No connection established. Last error: Error: connect ECONNREFUSED /tmp/sdk-platform-0000.sock';
  const plan = (aborted?: string) => ({
    tests: [{ title: 'Konto A (frau)', checks: ['Eins', 'Zwei', 'Drei'] }],
    devices: ['iPhone 16'],
    ...(aborted ? { aborted } : {}),
  });
  const report = (result: object) => ({
    suites: [
      {
        title: 'tests-e2e.spec.ts',
        specs: [{ title: 'Konto A (frau)', tests: [{ projectName: IPHONE, ...result }] }],
      },
    ],
  });

  test('stopped before the first check: every planned check is abgebrochen, no SDK error in any row', () => {
    const r = parseResult(
      report({
        results: [{ status: 'failed', steps: [], errors: [{ message: SDK_ERROR }] }],
      }) as never,
      [],
      plan('Strg+C'),
    );
    expect(r.aborted).toBe('Strg+C');
    expect(r.checks.map((c) => [c.title, c.outcome])).toEqual([
      ['Eins', 'abgebrochen'],
      ['Zwei', 'abgebrochen'],
      ['Drei', 'abgebrochen'],
    ]);
    const md = renderStand(r, 'ACME-1', HOST, ['iPhone 16'], DATE);
    expect(md).toContain('abgebrochen');
    expect(md.split('\n')[0]).toContain('abgebrochen');
    expect(md).not.toMatch(/ECONNREFUSED|UNAVAILABLE|sdk-platform|nicht gelaufen/);
    expect(r.log.join('\n')).toContain('ECONNREFUSED');
  });

  test('stopped during a check: what ran keeps its outcome, the running check and the rest are abgebrochen', () => {
    const r = parseResult(
      report({
        results: [
          {
            status: 'interrupted',
            steps: [
              { title: 'Eins' },
              {
                title: 'Zwei',
                error: { message: 'Target page, context or browser has been closed' },
              },
            ],
            errors: [{ message: 'Target page, context or browser has been closed' }],
          },
        ],
      }) as never,
      [],
      plan('Strg+C'),
    );
    expect(r.checks.map((c) => [c.title, c.outcome, c.note])).toEqual([
      ['Eins', 'bestanden', ''],
      ['Zwei', 'abgebrochen', ''],
      ['Drei', 'abgebrochen', ''],
    ]);
  });

  test('without an abort a check that did not run stays nicht gelaufen', () => {
    const r = parseResult(
      report({
        results: [
          {
            status: 'failed',
            steps: [{ title: 'Eins', error: { message: 'Knopf fehlt' } }],
            errors: [],
          },
        ],
      }) as never,
      [],
      plan(),
    );
    expect(r.checks.find((c) => c.title === 'Zwei')).toMatchObject({
      outcome: 'nicht bestanden',
      note: 'nicht gelaufen',
    });
    expect(renderStand(r, 'ACME-1', HOST, ['iPhone 16'], DATE).split('\n')[0]).not.toContain(
      'abgebrochen',
    );
  });
});

describe('internal errors of the device service', () => {
  test('stay out of every row (neutral note), and go to the log', () => {
    const r = parseResult(
      {
        suites: [
          {
            title: 'a.spec.ts',
            specs: [
              {
                title: 'Konto A (frau)',
                tests: [
                  {
                    projectName: 'safari-iPhone 16:18-browserstack-mobile',
                    results: [
                      {
                        status: 'failed',
                        steps: [
                          {
                            title: 'Eins',
                            error: {
                              message:
                                'Error: 14 UNAVAILABLE: connect ECONNREFUSED /tmp/sdk-platform-1.sock',
                            },
                          },
                        ],
                        errors: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as never,
      [],
    );
    expect(r.checks[0]).toMatchObject({ title: 'Eins', outcome: 'nicht bestanden' });
    expect(r.checks[0].note).not.toMatch(/ECONNREFUSED|UNAVAILABLE|sdk-platform/);
    expect(r.checks[0].note).toContain('Log');
    expect(r.log.join('\n')).toContain('ECONNREFUSED');
  });
});
