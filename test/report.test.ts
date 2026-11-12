import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseResult, renderStand } from '../src/report.js';

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
