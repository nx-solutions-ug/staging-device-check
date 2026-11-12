const MASK = '«geheim»';

/** Values shorter than this are ignored: masking "ab" would mask half of every log line. */
const MIN_LENGTH = 4;

/**
 * Masks each secret and the forms it takes in URLs, form bodies and headers: raw, `encodeURIComponent`,
 * form encoding (`+` for space), base64 and base64url. Longer forms are replaced first.
 */
export function redactor(secrets: string[]): (s: string) => string {
  const forms = new Set<string>();
  for (const s of secrets) {
    if (!s || s.length < MIN_LENGTH) continue;
    const b64 = Buffer.from(s).toString('base64');
    for (const f of [
      s,
      encodeURIComponent(s),
      new URLSearchParams({ v: s }).toString().slice(2),
      b64,
      b64.replace(/=+$/, ''),
      Buffer.from(s).toString('base64url'),
    ]) {
      if (f.length >= MIN_LENGTH) forms.add(f);
    }
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  return (text: string) => ordered.reduce((t, f) => t.split(f).join(MASK), String(text));
}
