/**
 * Layout rules over one measurement (spec §14, ported from the device-testing spike, flow names removed). Pure: no page,
 * no I/O. Every rule has a 1 px tolerance. A rule whose element is absent is omitted, never passed.
 */

export type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export type Metrics = {
  scrollY: number;
  innerHeight: number;
  innerWidth: number;
  /** document.documentElement.scrollWidth */
  scrollWidth: number;
  /** scrollHeight − innerHeight */
  maxScroll: number;
  /** 0 when no footer selector was given or the footer is absent */
  footerHeight: number;
  visualViewport: { offsetTop: number; height: number; width: number } | null;
  header: Rect | null;
  /** elements that must start below the header (R2) */
  top: Rect[];
  /** the pinned action bar (R3) */
  actionBar: Rect | null;
  /** the action button inside the bar (R4) */
  cta: Rect | null;
  /** content elements intersecting the action bar, as short labels (R3) */
  overlaps: string[];
  /** interactive elements smaller than 44x44, as short labels (R6) */
  smallTargets: string[];
  /** selected picker rows (R7) */
  selectedRows: Rect[];
};

export type RuleId = 'R1' | 'R2' | 'start' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';
export type Outcome = 'bestanden' | 'nicht bestanden' | 'nicht prüfbar hier';
export type RuleResult = { rule: RuleId; outcome: Outcome; detail: string };
export type Phase = 'settled' | 'pageend' | 'keyboard';
export type Platform = 'ios' | 'android';

const TOL = 1;
const n = (v: number) => Math.round(v * 10) / 10;
const result = (rule: RuleId, pass: boolean, detail: string): RuleResult => ({
  rule,
  outcome: pass ? 'bestanden' : 'nicht bestanden',
  detail,
});

function vvBox(m: Metrics): [number, number] {
  return m.visualViewport
    ? [m.visualViewport.offsetTop, m.visualViewport.height]
    : [0, m.innerHeight];
}

function r4(m: Metrics): RuleResult | null {
  if (!m.cta) return null;
  const [top, height] = vvBox(m);
  const pass = m.cta.top >= top - TOL && m.cta.bottom <= top + height + TOL;
  return result(
    'R4',
    pass,
    `Aktion ${n(m.cta.top)}..${n(m.cta.bottom)} im sichtbaren Bereich ${n(top)}..${n(top + height)}`,
  );
}

function r3(m: Metrics): RuleResult | null {
  if (!m.actionBar) return null;
  return result(
    'R3',
    m.overlaps.length === 0,
    m.overlaps.length
      ? `unter/über der Aktionsleiste: ${m.overlaps.join('; ')}`
      : 'nichts überlappt die Aktionsleiste',
  );
}

export function evaluateRules(m: Metrics, phase: Phase, platform: Platform): RuleResult[] {
  const out: Array<RuleResult | null> = [];
  if (phase === 'settled') {
    const over = m.maxScroll - m.footerHeight;
    out.push(
      result(
        'R1',
        over <= TOL,
        `maxScroll ${n(m.maxScroll)} − Footer ${n(m.footerHeight)} = ${n(over)}`,
      ),
    );
    out.push(result('start', m.scrollY <= TOL, `scrollY ${n(m.scrollY)}`));
    if (m.header && m.top.length) {
      const hb = m.header.bottom;
      const bad = m.top.filter((r) => r.top < hb - TOL);
      out.push(
        result(
          'R2',
          bad.length === 0,
          bad.length
            ? `oberstes Element bei ${bad.map((r) => n(r.top)).join(', ')} liegt über der Kopfzeile (${n(hb)})`
            : `alle oberen Elemente unter der Kopfzeile (${n(hb)})`,
        ),
      );
    }
    out.push(r4(m));
    out.push(
      result(
        'R5',
        m.scrollWidth - m.innerWidth <= TOL,
        `Seitenbreite ${n(m.scrollWidth)} bei Fensterbreite ${n(m.innerWidth)}`,
      ),
    );
    out.push(
      result(
        'R6',
        m.smallTargets.length === 0,
        m.smallTargets.length
          ? `kleiner als 44 px: ${m.smallTargets.join('; ')}`
          : 'alle Bedienelemente ≥ 44 px',
      ),
    );
    const limit = m.cta ?? m.actionBar;
    if (m.selectedRows.length && m.header && limit) {
      const bad = m.selectedRows.filter(
        (r) => r.top < m.header!.bottom - TOL || r.bottom > limit.top + TOL,
      );
      out.push(
        result(
          'R7',
          bad.length === 0,
          `gewählte Zeile ${m.selectedRows.map((r) => `${n(r.top)}..${n(r.bottom)}`).join(', ')} zwischen Kopfzeile ${n(m.header.bottom)} und Aktion ${n(limit.top)}`,
        ),
      );
    }
  } else {
    // page end and keyboard state: the action bar's rules
    out.push(r3(m), r4(m));
  }
  const rules = out.filter((r): r is RuleResult => r !== null);
  if (phase === 'keyboard' && platform === 'ios') {
    return rules.map((r) => ({
      rule: r.rule,
      outcome: 'nicht prüfbar hier',
      detail: 'Auf iOS öffnet Playwright keine Bildschirmtastatur.',
    }));
  }
  return rules;
}
