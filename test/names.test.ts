import { describe, expect, test } from 'bun:test';
import { shotName, slug } from '../plugins/staging-device-check/workspace/harness/names.js';

describe('slug', () => {
  test('transliterates umlauts and ß', () => {
    expect(slug('Größe wählen')).toBe('groesse-waehlen');
    expect(slug('Über Öl & Äpfel')).toBe('ueber-oel-aepfel');
    expect(slug('Straße')).toBe('strasse');
  });

  test('lower case, runs of other characters become one dash, no edge dashes', () => {
    expect(slug('  iPhone 16 (iOS 18)  ')).toBe('iphone-16-ios-18');
    expect(slug('é à ç')).toBe('e-a-c');
    expect(slug('***')).toBe('x');
  });
});

describe('shotName', () => {
  test('<TICKET>_<device>_<persona>_<NN>-<step-slug>.png', () => {
    expect(shotName('TEST-1', 'iPhone 16', 'Tester A', 3, 'Größe wählen')).toBe(
      'TEST-1_iphone-16_tester-a_03-groesse-waehlen.png',
    );
    expect(shotName('TEST-1', 'Galaxy S23', 'b', 12, 'Fertig!')).toBe(
      'TEST-1_galaxy-s23_b_12-fertig.png',
    );
  });
});
