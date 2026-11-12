import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Genericity guard for a public repo. Every tracked file outside test/fixtures/ is scanned. The forbidden words
 * (product hostnames, people, the product's ticket prefix) are stored only as SHA-256 prefixes, so this file does not
 * publish what it guards against. Plain patterns cover what is not secret to name: `.atlassian.net`, local home
 * paths and key-like strings.
 */
const ROOT = join(import.meta.dir, '..');
const hash = (w: string) => createHash('sha256').update(w).digest('hex').slice(0, 16);

/** product hostnames, people and companies: whole lower-cased words */
const WORDS = new Set([
  'f9291d4a448cef58',
  '6ccf29cf9c8b94a8',
  '34664e8c9a73a7e4',
  '3f9e814779d6acd8',
  '760dcecfbe1ce8c3',
  '7909868fb12ecbf4',
  '959d8e35560f9dda',
  '8f8e1f80de4676c8',
  '48b09b312eb74f45',
]);
/** ticket prefixes of the product: `<prefix>-<number>` */
const TICKET_PREFIXES = new Set(['2a517c2f6d3a4ad0']);

const GENERATED =
  /(^|\/)(bun\.lock|package-lock\.json)$|^plugins\/staging-device-check\/(dist\/|workspace\/harness\/lib\.js$)/;
/** 20+ characters of mixed case and digits, the shape of an access key; invented test values start with these */
const KEY_LIKE =
  /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g;
const INVENTED = /^(fake|invented|example)/i;
const HOME_PATH = /(?<![\w.])\/(home|Users)\/(?!tester\/)[A-Za-z][\w.-]*\//g;

const files = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    // this file holds only hashes plus the plain patterns and their self-test samples
    .filter((f) => f && !f.startsWith('test/fixtures/') && f !== 'test/generic.test.ts');

export function findings(path: string, text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    for (const w of line.toLowerCase().match(/[\p{L}\p{N}]+(?:-\d+)?/gu) ?? []) {
      const ticket = /^([\p{L}]+)-\d+$/u.exec(w);
      if (ticket && TICKET_PREFIXES.has(hash(ticket[1]))) out.push(`${at} ticket key`);
      if (WORDS.has(hash(ticket ? ticket[1] : w)) || WORDS.has(hash(w)))
        out.push(`${at} forbidden word`);
    }
    if (/\.atlassian\.net\b/i.test(line)) out.push(`${at} .atlassian.net`);
    for (const m of line.matchAll(HOME_PATH)) out.push(`${at} home path ${m[0]}`);
    if (!GENERATED.test(path))
      for (const m of line.matchAll(KEY_LIKE))
        if (!INVENTED.test(m[0])) out.push(`${at} key-like ${m[0].slice(0, 4)}…`);
  });
  return out;
}

describe('genericity guard', () => {
  test('the guard catches what it is meant to catch', () => {
    const word = ['ma', 'x'].join(''); // stand-in: proves the word check without naming a real one
    expect(findings('x.md', `${word} ok`)).toEqual([]);
    expect(findings('x.md', 'see https://acme.atlassian.net/browse')).toEqual([
      'x.md:1 .atlassian.net',
    ]);
    expect(findings('x.md', 'path /home/someone/project')[0]).toContain('home path');
    expect(findings('x.md', 'key Ab3dEf6hIj9kLm2nOp5q')[0]).toContain('key-like');
    expect(findings('x.md', 'key fakeAccessKey000000000')).toEqual([]);
  });

  test('no product hostnames, people, ticket keys, home paths or keys anywhere in the repo', () => {
    const hits = files().flatMap((f) => findings(f, readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
