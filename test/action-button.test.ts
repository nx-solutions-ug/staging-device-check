import { describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { pickActionButton } from '../plugins/staging-device-check/workspace/harness/measure.js';

const all = () => true;
const bar = (html: string) =>
  parseHTML(`<html><body><div class="bar">${html}</div></body></html>`).document.querySelector(
    '.bar',
  );

describe('measured action button', () => {
  test('the spec selector wins when given', () => {
    const b = bar(
      '<button id="back" type="button">Zurück</button><button id="next" type="submit">Weiter</button>',
    );
    expect(pickActionButton(b, '#back', all)?.id).toBe('back');
  });

  test('otherwise the submit button in the bar ("Zurück" before "Weiter")', () => {
    const b = bar(
      '<button id="back" type="button">Zurück</button><button id="next" type="submit">Weiter</button>',
    );
    expect(pickActionButton(b, undefined, all)?.id).toBe('next');
  });

  test('otherwise the last visible button in the bar', () => {
    const b = bar(
      '<button id="back" type="button">Zurück</button><a role="button" id="next">Weiter</a><button id="hidden" type="button">x</button>',
    );
    expect(pickActionButton(b, undefined, (el) => el.id !== 'hidden')?.id).toBe('next');
  });

  test('a submit outside the bar is never picked', () => {
    const { document } = parseHTML(
      '<html><body><button id="outside" type="submit">Oben</button><div class="bar"><button id="in" type="button">Weiter</button></div></body></html>',
    );
    expect(pickActionButton(document.querySelector('.bar'), undefined, all)?.id).toBe('in');
  });

  test('no bar, no button', () => {
    expect(pickActionButton(null, undefined, all)).toBeNull();
  });
});
