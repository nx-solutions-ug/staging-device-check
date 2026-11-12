/**
 * Turns Playwright's JSON report (`result.json`) into the run result and the German "Stand" section that the
 * tester pastes into the ticket. Result vocabulary is exact: bestanden, nicht bestanden, zu prüfen (Bild),
 * nicht prüfbar hier. No signed video URLs ever go into the section.
 *
 * One test per persona (one device session); each check is a `test.step`. The JSON reporter gives a step only its
 * title, duration and error, so "zu prüfen" and "nicht prüfbar hier" travel as test annotations whose description
 * starts with the step title: `<Schritt>: <Bild oder Grund>`. A whole test skipped with the "nicht prüfbar hier"
 * annotation (demo mailbox) is one row; a skip without it is a failure.
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
type PwStep = { title?: string; error?: { message?: string } };
type PwResult = {
  status?: string;
  steps?: PwStep[];
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
// oxlint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const firstLine = (s: string) =>
  s
    .replace(ANSI, '')
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
    // only a skip that says why counts as "nicht prüfbar hier"; any other skip hides a check and is a failure
    return a
      ? { outcome: 'nicht prüfbar hier', note: a.description ?? '' }
      : { outcome: 'nicht bestanden', note: 'übersprungen ohne Grund' };
  }
  if (status === 'passed') {
    const a = find(ZU_PRUEFEN);
    return a
      ? { outcome: 'zu prüfen (Bild)', note: a.description ?? '' }
      : { outcome: 'bestanden', note: '' };
  }
  return { outcome: 'nicht bestanden', note: firstLine(last.errors?.[0]?.message ?? status) };
}

const annotationsOf = (t: PwTest) => {
  const seen = new Set<string>();
  return [...(t.annotations ?? []), ...(t.results?.at(-1)?.annotations ?? [])].filter((a) => {
    const k = `${a.type}\u0000${a.description}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** The annotation of `type` that names this step (`<step>: <rest>`), and the rest. */
function stepMark(annotations: Annotation[], type: string, step: string): string | null {
  for (const a of annotations) {
    if (a.type !== type) continue;
    const d = a.description ?? '';
    if (d === step) return '';
    if (d.startsWith(`${step}: `)) return d.slice(step.length + 2);
  }
  return null;
}

function stepOutcome(step: PwStep, annotations: Annotation[]): { outcome: Outcome; note: string } {
  const title = step.title ?? '';
  const notHere = stepMark(annotations, NICHT_PRUEFBAR, title);
  if (notHere !== null) return { outcome: 'nicht prüfbar hier', note: notHere };
  if (step.error) return { outcome: 'nicht bestanden', note: firstLine(step.error.message ?? '') };
  const look = stepMark(annotations, ZU_PRUEFEN, title);
  if (look !== null) return { outcome: 'zu prüfen (Bild)', note: look };
  return { outcome: 'bestanden', note: '' };
}

export function parseResult(report: PlaywrightReport, screenshots: string[]): RunResult {
  const specs: PwSpec[] = [];
  const walk = (suite: PwSuite) => {
    specs.push(...(suite.specs ?? []));
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  // with several persona tests, a step row names its persona test
  const withSteps = new Set(
    specs
      .filter((sp) => sp.tests?.some((t) => t.results?.at(-1)?.steps?.length))
      .map((sp) => sp.title ?? ''),
  );
  const prefix = (spec: string, step: string) => (withSteps.size > 1 ? `${spec}: ${step}` : step);

  const checks: RunCheck[] = [];
  for (const spec of specs) {
    const specTitle = spec.title ?? '';
    for (const t of spec.tests ?? []) {
      const project = t.projectName ?? '';
      const device = deviceOf(project);
      const last = t.results?.at(-1) ?? {};
      const steps = last.steps ?? [];
      if (!steps.length || last.status === 'skipped') {
        checks.push({ title: specTitle, device, project, ...outcomeOf(t) });
        continue;
      }
      const annotations = annotationsOf(t);
      for (const step of steps)
        checks.push({
          title: prefix(specTitle, step.title ?? ''),
          device,
          project,
          ...stepOutcome(step, annotations),
        });
      // a failure outside every step (sign-in, a hard error between steps) must not vanish
      const failed = last.status !== 'passed';
      if (failed && !steps.some((s) => s.error))
        checks.push({
          title: `${specTitle}: Ablauf`,
          device,
          project,
          outcome: 'nicht bestanden',
          note: firstLine(last.errors?.[0]?.message ?? last.status ?? ''),
        });
    }
  }
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
    `**Gerätetest ${day} – ${[label, ...devices].join(', ')}**`,
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
