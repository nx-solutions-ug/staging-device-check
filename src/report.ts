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

export type Outcome =
  | 'bestanden'
  | 'nicht bestanden'
  | 'zu prüfen (Bild)'
  | 'nicht prüfbar hier'
  /** only in a run stopped before its end: the check did not finish, never a pass */
  | 'abgebrochen';
export type DeviceColumn = 'iPhone' | 'Android';

export type RunCheck = {
  title: string;
  device: DeviceColumn;
  project: string;
  outcome: Outcome;
  note: string;
};
export type RunResult = {
  checks: RunCheck[];
  screenshots: string[];
  /** why the run was stopped before its end (run.json) */
  aborted?: string;
  /** internal errors of the device service, kept out of the section: for the log only */
  log: string[];
};

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

/** Errors of the device service's own plumbing (its local socket, gRPC), not of the app: never a row's text. */
const INTERNAL = /ECONNREFUSED|ECONNRESET|EPIPE|\bUNAVAILABLE\b|grpc|sdk-platform|\.sock\b/i;
const INTERNAL_NOTE = 'interner Fehler des Gerätedienstes (Details im Log)';

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

function outcomeOf(t: PwTest, clean: (m: string) => string): { outcome: Outcome; note: string } {
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
  return { outcome: 'nicht bestanden', note: clean(last.errors?.[0]?.message ?? status) };
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

function stepOutcome(
  step: PwStep,
  annotations: Annotation[],
  clean: (m: string) => string,
): { outcome: Outcome; note: string } {
  const title = step.title ?? '';
  const notHere = stepMark(annotations, NICHT_PRUEFBAR, title);
  if (notHere !== null) return { outcome: 'nicht prüfbar hier', note: notHere };
  if (step.error) return { outcome: 'nicht bestanden', note: clean(step.error.message ?? '') };
  const look = stepMark(annotations, ZU_PRUEFEN, title);
  if (look !== null) return { outcome: 'zu prüfen (Bild)', note: look };
  return { outcome: 'bestanden', note: '' };
}

/** The checks `run` read from the spec before the SDK started (run.json), and the devices of the run. */
export type RunPlan = {
  tests: Array<{ title: string; checks: string[] }>;
  devices: string[];
  /** set when run stopped the run before its end (run.json `aborted`) */
  aborted?: string;
};

const NOT_RUN = 'nicht gelaufen';

/** Whether an annotation of a check names one of these step titles (`<step>` or `<step>: <rest>`). */
const namesStep = (a: Annotation, titles: string[]) =>
  titles.some((t) => a.description === t || (a.description ?? '').startsWith(`${t}: `));

export function parseResult(
  report: PlaywrightReport,
  screenshots: string[],
  plan?: RunPlan,
): RunResult {
  const aborted = plan?.aborted;
  const log: string[] = [];
  // a row's note: the first line, or a neutral text when the device service's plumbing failed (raw text to the log)
  const clean = (message: string) => {
    if (!INTERNAL.test(message)) return firstLine(message);
    log.push(message.replace(ANSI, '').trim());
    return INTERNAL_NOTE;
  };
  const abortedRow = (title: string, device: DeviceColumn, project: string): RunCheck => ({
    title,
    device,
    project,
    outcome: 'abgebrochen',
    note: '',
  });
  const specs: PwSpec[] = [];
  const walk = (suite: PwSuite) => {
    specs.push(...(suite.specs ?? []));
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  // with several persona tests, a check row names its persona test
  const personas = new Set(
    plan
      ? plan.tests.map((t) => t.title)
      : specs
          .filter((sp) => sp.tests?.some((t) => t.results?.at(-1)?.steps?.length))
          .map((sp) => sp.title ?? ''),
  );
  const prefix = (spec: string, step: string) => (personas.size > 1 ? `${spec}: ${step}` : step);
  const planned = (spec: string) => plan?.tests.find((t) => t.title === spec)?.checks ?? [];

  const checks: RunCheck[] = [];
  for (const spec of specs) {
    const specTitle = spec.title ?? '';
    for (const t of spec.tests ?? []) {
      const project = t.projectName ?? '';
      const device = deviceOf(project);
      const last = t.results?.at(-1) ?? {};
      const steps = last.steps ?? [];
      if (!steps.length || last.status === 'skipped') {
        const whole = outcomeOf(t, clean);
        const own = planned(specTitle);
        // stopped before its first check: what it planned did not finish; the error is the abort's, not the app's
        if (aborted && last.status !== 'skipped' && last.status !== 'passed') {
          if (whole.note && whole.note !== INTERNAL_NOTE) log.push(whole.note);
          for (const c of own.length ? own : [specTitle])
            checks.push(abortedRow(own.length ? prefix(specTitle, c) : c, device, project));
          continue;
        }
        // a persona skipped as a whole (demo mailbox): each planned check says so
        if (whole.outcome === 'nicht prüfbar hier' && own.length)
          for (const c of own)
            checks.push({ title: prefix(specTitle, c), device, project, ...whole });
        else checks.push({ title: specTitle, device, project, ...whole });
        continue;
      }
      const annotations = annotationsOf(t);
      // the check that was running when the run was stopped did not finish
      const cut =
        aborted &&
        last.status !== 'passed' &&
        (last.status === 'interrupted' || INTERNAL.test(steps.at(-1)?.error?.message ?? ''))
          ? steps.at(-1)
          : undefined;
      for (const step of steps) {
        const title = prefix(specTitle, step.title ?? '');
        if (step === cut && step.error) {
          clean(step.error.message ?? '');
          checks.push(abortedRow(title, device, project));
        } else checks.push({ title, device, project, ...stepOutcome(step, annotations, clean) });
      }
      const problems: string[] = [];
      // a note for a check that has no step: its check never got its row, so the run is not trustworthy
      const titles = steps.map((s) => s.title ?? '');
      for (const a of annotations)
        if ((a.type === ZU_PRUEFEN || a.type === NICHT_PRUEFBAR) && !namesStep(a, titles))
          problems.push(`Notiz passt zu keiner Prüfung: ${a.description ?? ''}`);
      // a failure outside every step (sign-in, a hard error between steps) must not vanish
      // (after an abort that failure is the abort's: log only)
      if (last.status !== 'passed' && !steps.some((s) => s.error)) {
        const message = last.errors?.[0]?.message ?? last.status ?? '';
        if (aborted) log.push(firstLine(message));
        else problems.push(clean(message));
      }
      if (problems.length)
        checks.push({
          title: `${specTitle}: Ablauf`,
          device,
          project,
          outcome: 'nicht bestanden',
          note: problems.join('; '),
        });
    }
  }

  if (plan) {
    const devices = [...new Set(plan.devices.map(deviceOf))];
    for (const pt of plan.tests)
      for (const device of devices)
        for (const c of pt.checks) {
          const title = prefix(pt.title, c);
          if (!checks.some((x) => x.title === title && x.device === device))
            checks.push(
              aborted
                ? abortedRow(title, device, '')
                : { title, device, project: '', outcome: 'nicht bestanden', note: NOT_RUN },
            );
        }
    // rows in the planned order; anything unplanned (Ablauf, per-test rows) after its persona's checks
    const order = new Map<string, number>();
    plan.tests.forEach((pt, i) => {
      pt.checks.forEach((c, j) => order.set(prefix(pt.title, c), i * 1000 + j));
      order.set(`${pt.title}: Ablauf`, i * 1000 + 999);
    });
    const rank = (c: RunCheck) => order.get(c.title) ?? Number.MAX_SAFE_INTEGER;
    checks.sort((a, b) => rank(a) - rank(b));
  }
  return { checks, screenshots, ...(aborted ? { aborted } : {}), log };
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
  const stopped = r.aborted ? ` – abgebrochen (${r.aborted})` : '';
  const lines = [
    `**Gerätetest ${day} – ${[label, ...devices].join(', ')}${stopped}**`,
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
