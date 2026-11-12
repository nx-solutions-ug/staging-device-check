import { describe, expect, test } from 'bun:test';
import {
  evaluateRules,
  type Metrics,
  type Rect,
} from '../plugins/staging-device-check/workspace/harness/rules.js';

const rect = (top: number, bottom: number, left = 0, right = 393): Rect => ({
  top,
  bottom,
  left,
  right,
  width: right - left,
  height: bottom - top,
});

/** A settled 393x659 phone page that passes every rule; tests override one number at a time. */
const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  scrollY: 0,
  innerHeight: 659,
  innerWidth: 393,
  scrollWidth: 393,
  maxScroll: 120,
  footerHeight: 120,
  visualViewport: { offsetTop: 0, height: 659, width: 393 },
  header: rect(0, 56),
  top: [rect(72, 120, 16, 64)],
  actionBar: rect(587, 659),
  cta: rect(599, 647, 16, 377),
  overlaps: [],
  smallTargets: [],
  selectedRows: [],
  ...over,
});

const byRule = (rs: ReturnType<typeof evaluateRules>, rule: string) =>
  rs.find((r) => r.rule === rule);

describe('evaluateRules', () => {
  test('R1 fails at maxScroll 258 with footer 120 (138 over)', () => {
    const r = byRule(evaluateRules(metrics({ maxScroll: 258 }), 'settled', 'ios'), 'R1');
    expect(r?.outcome).toBe('nicht bestanden');
    expect(r?.detail).toContain('138');
  });

  test('R1 passes at 120/120', () => {
    expect(byRule(evaluateRules(metrics(), 'settled', 'ios'), 'R1')?.outcome).toBe('bestanden');
  });

  test('R1 tolerates 1 px', () => {
    expect(
      byRule(evaluateRules(metrics({ maxScroll: 121 }), 'settled', 'ios'), 'R1')?.outcome,
    ).toBe('bestanden');
  });

  test('R4 passes with keyboard open on android (cta 524.7..572.7, vv offsetTop 294 height 355)', () => {
    const m = metrics({
      cta: rect(524.7, 572.7),
      visualViewport: { offsetTop: 294, height: 355, width: 393 },
    });
    expect(byRule(evaluateRules(m, 'keyboard', 'android'), 'R4')?.outcome).toBe('bestanden');
  });

  test('R4 fails when cta.bottom > offsetTop+height+1', () => {
    const m = metrics({
      cta: rect(600, 650.1),
      visualViewport: { offsetTop: 294, height: 355, width: 393 },
    });
    const r = byRule(evaluateRules(m, 'keyboard', 'android'), 'R4');
    expect(r?.outcome).toBe('nicht bestanden');
    expect(r?.detail).toContain('294');
  });

  test('ios keyboard phase reports nicht prüfbar hier', () => {
    const rs = evaluateRules(metrics({ overlaps: ['text "x" 12px'] }), 'keyboard', 'ios');
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.outcome).toBe('nicht prüfbar hier');
  });

  test('absent action bar omits R3/R4', () => {
    for (const phase of ['settled', 'pageend', 'keyboard'] as const) {
      const rs = evaluateRules(metrics({ actionBar: null, cta: null }), phase, 'android');
      expect(byRule(rs, 'R3')).toBeUndefined();
      expect(byRule(rs, 'R4')).toBeUndefined();
    }
  });

  test('R2 and start in the settled phase', () => {
    const rs = evaluateRules(metrics({ top: [rect(40, 90)], scrollY: 30 }), 'settled', 'ios');
    expect(byRule(rs, 'R2')?.outcome).toBe('nicht bestanden');
    expect(byRule(rs, 'start')?.outcome).toBe('nicht bestanden');
    expect(byRule(evaluateRules(metrics({ top: [] }), 'settled', 'ios'), 'R2')).toBeUndefined();
  });

  test('R3 at the page end fails on an overlap', () => {
    expect(byRule(evaluateRules(metrics(), 'pageend', 'ios'), 'R3')?.outcome).toBe('bestanden');
    const r = byRule(evaluateRules(metrics({ overlaps: ['img 30px'] }), 'pageend', 'ios'), 'R3');
    expect(r?.outcome).toBe('nicht bestanden');
    expect(r?.detail).toContain('img 30px');
  });

  test('R5 horizontal overflow, R6 small targets, R7 selected row', () => {
    const rs = evaluateRules(
      metrics({
        scrollWidth: 420,
        smallTargets: ['button "OK" 40x30'],
        selectedRows: [rect(590, 638)],
      }),
      'settled',
      'android',
    );
    expect(byRule(rs, 'R5')?.outcome).toBe('nicht bestanden');
    expect(byRule(rs, 'R6')?.outcome).toBe('nicht bestanden');
    expect(byRule(rs, 'R7')?.outcome).toBe('nicht bestanden');
    const ok = evaluateRules(metrics({ selectedRows: [rect(300, 348)] }), 'settled', 'android');
    expect(byRule(ok, 'R5')?.outcome).toBe('bestanden');
    expect(byRule(ok, 'R6')?.outcome).toBe('bestanden');
    expect(byRule(ok, 'R7')?.outcome).toBe('bestanden');
    expect(byRule(evaluateRules(metrics(), 'settled', 'android'), 'R7')).toBeUndefined();
  });
});
