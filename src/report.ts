/**
 * Turns Playwright's JSON report (`result.json`) into the run result and the German "Stand" section that the
 * tester pastes into the ticket. Result vocabulary is exact: bestanden, nicht bestanden, zu prüfen (Bild),
 * nicht prüfbar hier. A test skipped with the "nicht prüfbar hier" annotation (demo mailbox, iOS keyboard) is never
 * a pass or a failure. No signed video URLs ever go into the section.
 */

export type Outcome = 'bestanden' | 'nicht bestanden' | 'zu prüfen (Bild)' | 'nicht prüfbar hier';
export type DeviceColumn = 'iPhone' | 'Android';

export type RunCheck = {
  title: string;
  device: DeviceColumn;
  project: string;
  outcome: Outcome;
  note: string;
};
export type RunResult = { checks: RunCheck[]; screenshots: string[] };

type Annotation = { type?: string; description?: string };
type PwResult = {
  status?: string;
  errors?: Array<{ message?: string }>;
  annotations?: Annotation[];
};
type PwTest = {
  projectName?: string;
  annotations?: Annotation[];
  results?: PwResult[];
  status?: string;
};
type PwSpec = { title?: string; tests?: PwTest[] };
type PwSuite = { title?: string; specs?: PwSpec[]; suites?: PwSuite[] };
export type PlaywrightReport = { suites?: PwSuite[] };

const NICHT_PRUEFBAR = 'nicht prüfbar hier';
const ZU_PRUEFEN = 'zu prüfen';

const deviceOf = (project: string): DeviceColumn =>
  /iphone|ipad|ios/i.test(project) ? 'iPhone' : 'Android';
const firstLine = (s: string) =>
  s
    .split('\n')
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 160) ?? '';

function outcomeOf(t: PwTest): { outcome: Outcome; note: string } {
  const last = t.results?.at(-1) ?? {};
  const annotations = [...(t.annotations ?? []), ...(last.annotations ?? [])];
  const find = (type: string) => annotations.find((a) => a.type === type);
  const status = last.status ?? 'skipped';
  if (status === 'skipped') {
    const a = find(NICHT_PRUEFBAR);
    return { outcome: 'nicht prüfbar hier', note: a?.description ?? 'übersprungen' };
  }
  if (status === 'passed') {
    const a = find(ZU_PRUEFEN);
    return a
      ? { outcome: 'zu prüfen (Bild)', note: a.description ?? '' }
      : { outcome: 'bestanden', note: '' };
  }
  return { outcome: 'nicht bestanden', note: firstLine(last.errors?.[0]?.message ?? status) };
}

export function parseResult(report: PlaywrightReport, screenshots: string[]): RunResult {
  const checks: RunCheck[] = [];
  const walk = (suite: PwSuite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const project = t.projectName ?? '';
        checks.push({
          title: spec.title ?? '',
          device: deviceOf(project),
          project,
          ...outcomeOf(t),
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  return { checks, screenshots };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');

export function renderStand(
  r: RunResult,
  ticket: string,
  host: string,
  devices: string[],
  date: Date,
): string {
  const label = host.split('.')[0];
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const lines = [
    `**Gerätetest ${day} – ${label}, ${devices.join(', ')}**`,
    '',
    '| Prüfung | iPhone | Android | Hinweis |',
    '|---|---|---|---|',
  ];

  const titles = [...new Set(r.checks.map((c) => c.title))];
  for (const title of titles) {
    const rows = r.checks.filter((c) => c.title === title);
    const of = (d: DeviceColumn) => rows.find((c) => c.device === d);
    const ios = of('iPhone');
    const android = of('Android');
    const notes = [ios, android].map((c) => c?.note ?? '');
    const present = [ios, android].filter((c): c is RunCheck => !!c);
    const note =
      present.length > 1 && notes[0] === notes[1]
        ? notes[0]
        : present
            .filter((c) => c.note)
            .map((c) => `${c.device}: ${c.note}`)
            .join('; ');
    lines.push(
      `| ${cell(title)} | ${ios?.outcome ?? '—'} | ${android?.outcome ?? '—'} | ${cell(note) || '—'} |`,
    );
  }

  const shots = r.screenshots.filter((f) => f.startsWith(`${ticket}_`)).sort();
  lines.push('');
  if (shots.length) lines.push('Bilder zum Anhängen:', ...shots.map((f) => `- ${f}`));
  else lines.push('Bilder zum Anhängen: keine');

  const ownPhone = titles.filter((t) =>
    r.checks.some((c) => c.title === t && c.outcome === 'nicht prüfbar hier'),
  );
  if (ownPhone.length) lines.push('', `Auf dem eigenen iPhone prüfen: ${ownPhone.join(', ')}`);
  return `${lines.join('\n')}\n`;
}
