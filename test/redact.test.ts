import { describe, expect, test } from 'bun:test';
import { redactor } from '../src/redact.js';

const SECRET = 'invented secret/pass+word=';

describe('redactor', () => {
  test('redactor masks raw, encoded and base64 forms', () => {
    const r = redactor([SECRET]);
    const forms = [
      SECRET,
      encodeURIComponent(SECRET),
      new URLSearchParams({ p: SECRET }).toString().slice(2),
      Buffer.from(SECRET).toString('base64'),
      Buffer.from(SECRET).toString('base64url'),
    ];
    for (const f of forms) expect(r(`before ${f} after`)).toBe('before «geheim» after');
  });

  test('several secrets, the longer one first', () => {
    const r = redactor(['abcd', 'abcdefgh']);
    expect(r('x abcdefgh y abcd z')).toBe('x «geheim» y «geheim» z');
  });

  test('empty and very short values are ignored instead of masking everything', () => {
    const r = redactor(['', 'ab', 'invented-token']);
    expect(r('ab invented-token ab')).toBe('ab «geheim» ab');
  });
});
