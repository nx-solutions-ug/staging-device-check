import { describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import {
  consentBanner,
  consentShownInPage,
  FIRST_WAIT_MS,
  type ConsentPage,
} from '../plugins/staging-device-check/workspace/harness/consent.js';
import {
  closeKeyboard,
  EingabeFehler,
  KEYBOARD_CLOSE_MS,
  setNativeInPage,
  tapSafely,
  typeSafely,
  viewportInPage,
  type TypeDeps,
  type Viewport,
} from '../plugins/staging-device-check/workspace/harness/input.js';
import {
  probeInPage,
  settle,
  SETTLE_LIMIT_MS,
  unsettled,
  type Probe,
} from '../plugins/staging-device-check/workspace/harness/settle.js';

const fakeClock = () => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
};

describe('consent banner', () => {
  const page = (shows: boolean[], appears = true) => {
    const log: string[] = [];
    const p: ConsentPage = {
      shown: async (l) => (log.push(`shown ${l}`), shows.shift() ?? false),
      appears: async (l, ms) => (log.push(`appears ${l} ${ms}`), appears),
      dismiss: async (l) => void log.push(`dismiss ${l}`),
    };
    return { p, log };
  };

  test('without a label nothing happens', async () => {
    const { p, log } = page([true], true);
    const c = consentBanner(undefined, p);
    await c.afterGoto();
    await c.look();
    expect(log).toEqual([]);
  });

  test('the first navigation waits for a late banner and dismisses it; later ones only look', async () => {
    const { p, log } = page([false, true]);
    const c = consentBanner('Nur notwendige', p);
    await c.afterGoto();
    expect(c.dismissed).toBe(true);
    await c.afterGoto();
    await c.look();
    expect(log).toEqual([
      `appears Nur notwendige ${FIRST_WAIT_MS}`,
      'dismiss Nur notwendige',
      'shown Nur notwendige',
      'shown Nur notwendige',
      'dismiss Nur notwendige',
    ]);
  });

  test('a banner that shows later than the first wait is still dismissed before the next action', async () => {
    const { p, log } = page([false, true], false);
    const c = consentBanner('Ablehnen', p);
    await c.afterGoto();
    expect(c.dismissed).toBe(false);
    await c.look();
    await c.look();
    expect(log).toEqual([
      `appears Ablehnen ${FIRST_WAIT_MS}`,
      'shown Ablehnen',
      'shown Ablehnen',
      'dismiss Ablehnen',
    ]);
    expect(c.dismissed).toBe(true);
  });

  test('the first wait is at least 10 s (the local look waits as long)', () => {
    expect(FIRST_WAIT_MS).toBeGreaterThanOrEqual(10_000);
  });
});

/** linkedom lays nothing out: every element gets the box and style the test gives it. */
function dom(html: string, boxes: Record<string, { height?: number; hidden?: boolean }> = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const [sel, b] of Object.entries(boxes))
    for (const el of document.querySelectorAll(sel)) {
      (el as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
        top: 10,
        left: 0,
        width: 100,
        height: b.height ?? 40,
        bottom: 50,
        right: 100,
      });
      (el as unknown as { _hidden: boolean })._hidden = !!b.hidden;
    }
  const g = globalThis as Record<string, unknown>;
  const before = { document: g.document, getComputedStyle: g.getComputedStyle, window: g.window };
  g.document = document;
  g.window = window;
  g.getComputedStyle = (el: { _hidden?: boolean }) => ({
    visibility: el._hidden ? 'hidden' : 'visible',
    display: 'block',
    opacity: '1',
  });
  return {
    document,
    window,
    restore: () => Object.assign(g, before),
  };
}

describe('consentShownInPage', () => {
  test('a visible button with exactly the label, whitespace aside', () => {
    const d = dom(
      '<div><button id="a">  Nur   notwendige </button><button id="b">Alle</button></div>',
      {
        button: {},
      },
    );
    try {
      expect(consentShownInPage('Nur notwendige')).toBe(true);
      expect(consentShownInPage('Nur')).toBe(false);
    } finally {
      d.restore();
    }
  });

  test('a hidden or zero-size button is not shown', () => {
    const d = dom('<button id="a">Nur notwendige</button><span role="button">Ablehnen</span>', {
      '#a': { hidden: true },
      span: { height: 0 },
    });
    try {
      expect(consentShownInPage('Nur notwendige')).toBe(false);
      expect(consentShownInPage('Ablehnen')).toBe(false);
    } finally {
      d.restore();
    }
  });
});

describe('tap', () => {
  const deps = (views: Viewport[], log: string[]) => {
    const clock = fakeClock();
    return {
      ...clock,
      viewport: async () => views.shift() ?? { inner: 800, visual: 800, editableFocused: false },
      blur: async () => void log.push('blur'),
      ready: async () => void log.push('ready'),
      tap: async () => void log.push('tap'),
      consent: async () => void log.push('consent'),
    };
  };
  const open = { inner: 800, visual: 480, editableFocused: true };
  const closed = { inner: 800, visual: 800, editableFocused: false };

  test('keyboard closed: consent, ready, tap — no blur', async () => {
    const log: string[] = [];
    await tapSafely(deps([closed], log));
    expect(log).toEqual(['consent', 'ready', 'tap']);
  });

  test('keyboard open: blur, wait until two readings agree and the gap is gone, then tap', async () => {
    const log: string[] = [];
    const d = deps([open, { ...open, visual: 650 }, closed, closed], log);
    await tapSafely(d);
    expect(log).toEqual(['consent', 'blur', 'ready', 'tap']);
    expect(d.now()).toBe(450);
  });

  test('a focused field alone counts as an open keyboard (Android may resize the window too)', async () => {
    const log: string[] = [];
    await tapSafely(
      deps([{ inner: 480, visual: 480, editableFocused: true }, closed, closed], log),
    );
    expect(log).toContain('blur');
  });

  test('keepKeyboard leaves the keyboard open (picking a suggestion)', async () => {
    const log: string[] = [];
    await tapSafely(deps([open], log), { keepKeyboard: true });
    expect(log).toEqual(['consent', 'ready', 'tap']);
  });

  test('a keyboard that does not close stops waiting at the bound', async () => {
    const log: string[] = [];
    const d = deps(Array(100).fill(open), log);
    expect(await closeKeyboard(d)).toBe(false);
    expect(d.now()).toBeGreaterThanOrEqual(KEYBOARD_CLOSE_MS);
    expect(d.now()).toBeLessThan(KEYBOARD_CLOSE_MS + 200);
  });
});

describe('typeInto', () => {
  const deps = (arrivesAfter: string | null, setterWorks = true) => {
    const log: string[] = [];
    let last = '';
    const d: TypeDeps = {
      ...fakeClock(),
      tapField: async () => void log.push('tap'),
      fill: async (v) => {
        log.push(`fill ${v}`);
        last = 'fill';
      },
      setNative: async (v) => {
        log.push(`setter ${v}`);
        last = 'setter';
        return setterWorks;
      },
      pressSequentially: async (v) => {
        log.push(`type ${v}`);
        last = 'pressSequentially';
      },
      arrived: async () => last === arrivesAfter,
    };
    return { d, log };
  };

  test('fill that arrives is enough', async () => {
    const { d, log } = deps('fill');
    expect(await typeSafely(d, '#ort', '91077')).toBe('fill');
    expect(log).toEqual(['tap', 'fill 91077']);
  });

  test('fill that does not arrive falls back to the native setter', async () => {
    const { d, log } = deps('setter');
    expect(await typeSafely(d, '#ort', '91077')).toBe('setter');
    expect(log).toEqual(['tap', 'fill 91077', 'setter 91077']);
  });

  test('typing comes last, into the cleared field', async () => {
    const { d, log } = deps('pressSequentially');
    expect(await typeSafely(d, '#ort', '91077')).toBe('pressSequentially');
    expect(log).toEqual(['tap', 'fill 91077', 'setter 91077', 'setter ', 'type 91077']);
  });

  test('a field the setter cannot handle goes straight to typing', async () => {
    const { d, log } = deps('pressSequentially', false);
    expect(await typeSafely(d, '#ort', 'x')).toBe('pressSequentially');
    expect(log).toEqual(['tap', 'fill x', 'setter x', 'setter ', 'type x']);
  });

  test('a fill that throws does not stop the fallbacks', async () => {
    const { d } = deps('setter');
    d.fill = async () => {
      throw new Error('fill refused');
    };
    expect(await typeSafely(d, '#ort', 'x')).toBe('setter');
  });

  test('nothing arrives: a German error naming the field, after bounded waits', async () => {
    const { d } = deps(null);
    await expect(typeSafely(d, '#ort', 'x', { waitMs: 1_000 })).rejects.toBeInstanceOf(
      EingabeFehler,
    );
    await expect(typeSafely(deps(null).d, '#ort', 'x')).rejects.toThrow('Eingabe in #ort');
    expect(d.now()).toBeLessThanOrEqual(3 * 1_150);
  });
});

describe('in-page input helpers', () => {
  test('the setter writes the value and fires input and change; a non-field is refused', () => {
    const d = dom('<input id="ort"><div id="box"></div>');
    try {
      const events: string[] = [];
      const el = d.document.querySelector('#ort') as unknown as HTMLInputElement;
      const g = globalThis as Record<string, unknown>;
      const before = { a: g.HTMLInputElement, b: g.HTMLTextAreaElement, c: g.Event };
      Object.assign(g, {
        HTMLInputElement: d.window.HTMLInputElement,
        HTMLTextAreaElement: d.window.HTMLTextAreaElement,
        Event: d.window.Event,
      });
      try {
        el.addEventListener('input', () => events.push(`input ${el.value}`));
        el.addEventListener('change', () => events.push('change'));
        expect(setNativeInPage({ selector: '#ort', value: '91077' })).toBe(true);
        expect(el.value).toBe('91077');
        expect(events).toEqual(['input 91077', 'change']);
        expect(setNativeInPage({ selector: '#box', value: 'x' })).toBe(false);
        expect(setNativeInPage({ selector: '#weg', value: 'x' })).toBe(false);
      } finally {
        Object.assign(g, {
          HTMLInputElement: before.a,
          HTMLTextAreaElement: before.b,
          Event: before.c,
        });
      }
    } finally {
      d.restore();
    }
  });

  test('viewport: a focused text field counts, a focused button does not', () => {
    const d = dom('<input id="ort"><input id="ok" type="submit"><textarea id="t"></textarea>');
    try {
      Object.assign(d.window, { innerHeight: 800, visualViewport: { height: 480.4 } });
      const focus = (id: string) =>
        Object.defineProperty(d.document, 'activeElement', {
          value: d.document.getElementById(id),
          configurable: true,
        });
      focus('ort');
      expect(viewportInPage()).toEqual({ inner: 800, visual: 480, editableFocused: true });
      focus('ok');
      expect(viewportInPage().editableFocused).toBe(false);
      focus('t');
      expect(viewportInPage().editableFocused).toBe(true);
    } finally {
      d.restore();
    }
  });
});

describe('layout waits for a page at rest', () => {
  const probes = (list: Probe[]) => async () => list.shift() ?? list.at(-1)!;
  const p = (shape: number[], running = 0, present = true): Probe => ({ present, running, shape });

  test('two equal readings in a row: at rest', async () => {
    const c = fakeClock();
    const s = await settle(probes([p([1, 2]), p([1, 2])]), c);
    expect(s).toEqual({ stable: true, ms: 150 });
  });

  test('one reading alone is never enough', async () => {
    const c = fakeClock();
    let n = 0;
    await settle(async () => (n++, p([1])), c);
    expect(n).toBe(2);
  });

  test('a fading bar: waits while its finite animation runs and its box moves', async () => {
    const c = fakeClock();
    const s = await settle(
      probes([p([0, 700], 1), p([0, 640], 1), p([0, 600]), p([0, 600.3]), p([0, 600.3])]),
      c,
    );
    expect(s).toEqual({ stable: true, ms: 450 });
  });

  test('never at rest: stops at the bound, says why', async () => {
    for (const [make, why] of [
      [(i: number) => p([i]), 'Maße ändern sich noch'],
      [() => p([1], 1), 'Animation läuft noch'],
      [() => p([1], 0, false), 'Elemente fehlen'],
    ] as const) {
      const c = fakeClock();
      let i = 0;
      const s = await settle(async () => make(i++), c);
      expect(s).toMatchObject({ stable: false, why });
      expect(s.ms).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
      expect(s.ms).toBeLessThan(SETTLE_LIMIT_MS + 200);
    }
  });

  test('not at rest is never a pass; "nicht prüfbar hier" stays', () => {
    const results = unsettled(
      [
        { rule: 'R3', outcome: 'bestanden', detail: 'nichts überlappt die Aktionsleiste' },
        { rule: 'R4', outcome: 'nicht prüfbar hier', detail: 'iOS' },
      ],
      { stable: false, ms: 3_050, why: 'Animation läuft noch' },
    );
    expect(results).toEqual([
      {
        rule: 'R3',
        outcome: 'nicht bestanden',
        detail:
          'Seite kam in 3.1 s nicht zur Ruhe (Animation läuft noch) — nichts überlappt die Aktionsleiste',
      },
      { rule: 'R4', outcome: 'nicht prüfbar hier', detail: 'iOS' },
    ]);
    const passed = [{ rule: 'R1' as const, outcome: 'bestanden' as const, detail: 'x' }];
    expect(unsettled(passed, { stable: true, ms: 150 })).toBe(passed);
  });

  test('probe: an endlessly animated element is left out, a finite animation counts', () => {
    const d = dom(
      '<header>k</header><img class="g" id="avatar"><div class="g" id="bubble"></div><nav>w</nav>',
      {
        header: {},
        '.g': {},
        nav: {},
      },
    );
    try {
      Object.assign(d.window, {
        scrollY: 0,
        innerHeight: 800,
        visualViewport: { offsetTop: 0, height: 800 },
      });
      const anim = (iterations: number) => ({
        playState: 'running',
        effect: { getTiming: () => ({ iterations }) },
      });
      const set = (id: string, list: object[]) =>
        Object.assign(d.document.getElementById(id) as object, { getAnimations: () => list });
      set('avatar', [anim(Infinity)]);
      set('bubble', [anim(1)]);
      const probe = probeInPage({ header: 'header', actionBar: 'nav', top: '.g' });
      expect(probe.present).toBe(true);
      expect(probe.running).toBe(1);
      expect(probe.shape).toHaveLength(4 * 3 + 3);
      expect(probeInPage({ header: 'header', actionBar: '.missing' }).present).toBe(false);
    } finally {
      d.restore();
    }
  });
});
