import { describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { ACTION_BUTTON } from '../plugins/staging-device-check/workspace/harness/measure.js';

describe('action bar button', () => {
  test('is the first button inside the pinned bar, not the first in the DOM or the first submit', () => {
    const { document } = parseHTML(`<html><body>
      <button id="outside" type="submit">Oben</button>
      <div class="bar"><span>x</span><button id="back" type="button">Zurück</button><button id="next" type="submit">Weiter</button></div>
    </body></html>`);
    const bar = document.querySelector('.bar');
    expect(bar?.querySelector(ACTION_BUTTON)?.id).toBe('back');
  });

  test('a role=button element inside the bar counts', () => {
    const { document } = parseHTML(
      `<html><body><div class="bar"><a role="button" id="r">Weiter</a></div></body></html>`,
    );
    expect(document.querySelector('.bar')?.querySelector(ACTION_BUTTON)?.id).toBe('r');
  });
});
