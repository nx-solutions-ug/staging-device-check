/** File-name helpers for screenshots (pure). */

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Lower case, German umlauts and ß transliterated, other accents stripped, runs of anything else → one dash. */
export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => TRANSLIT[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return out || 'x';
}

/** `<TICKET>_<device>_<persona>_<NN>-<step-slug>.png` (Global Constraints). */
export function shotName(
  ticket: string,
  device: string,
  persona: string,
  n: number,
  step: string,
): string {
  return `${ticket}_${slug(device)}_${slug(persona)}_${String(n).padStart(2, '0')}-${slug(step)}.png`;
}

/**
 * Description of a step's "zu prüfen" / "nicht prüfbar hier" annotation: `<step>: <rest>`. The JSON reporter keeps
 * no annotations per step, so `report` finds the step by this prefix.
 */
export function stepNote(step: string, rest: string): string {
  return `${step}: ${rest}`;
}
