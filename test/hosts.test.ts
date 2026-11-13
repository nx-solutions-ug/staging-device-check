import { describe, expect, test } from 'bun:test';
import { appHost, branchLabel, consentButtonFor, projectOfHost } from '../src/hosts.js';
import { sampleConfig } from './fixtures/config.js';

describe('branchLabel', () => {
  test.each([
    ['main', 'main'],
    ['feat/ACME-42-dark-mode', 'feat--acme-42-dark-mode'],
    ['fix/a_b.c', 'fix--a-b-c'],
    ['Release/2026/11', 'release--2026--11'],
  ])('%s -> %s', (branch, label) => {
    expect(branchLabel(branch)).toBe(label);
  });
});

describe('appHost', () => {
  test('appHost builds the example host', () => {
    expect(appHost(sampleConfig(), 'acme-de', 'main')).toBe(
      'd-acme-de--main.dating.staging.example.test',
    );
  });

  test('a feature branch becomes its label', () => {
    expect(appHost(sampleConfig(), 'acme-de', 'feat/ACME-42-dark-mode')).toBe(
      'd-acme-de--feat--acme-42-dark-mode.dating.staging.example.test',
    );
  });

  test('a trailing slash or a port-free apex with a path does not leak into the host', () => {
    expect(
      appHost(sampleConfig({ apex: 'https://staging.example.test/' }), 'acme-de', 'main'),
    ).toBe('d-acme-de--main.dating.staging.example.test');
  });

  test('a pattern with an unknown placeholder is refused', () => {
    expect(() =>
      appHost(sampleConfig({ hostPattern: '{tenant}.{apexHost}' }), 'acme-de', 'main'),
    ).toThrow('hostPattern');
  });
});

describe('consentButtonFor', () => {
  const config = () => ({
    ...sampleConfig(),
    projects: { 'acme.de': 'acme-de', 'acme.de plus': 'acme-de-plus' },
    consentButtons: { 'acme-de': 'Nur notwendige' },
  });

  test('the settings entry of the host’s project wins over the spec’s label', () => {
    expect(consentButtonFor(config(), 'd-acme-de--main.dating.staging.example.test', 'Alle')).toBe(
      'Nur notwendige',
    );
  });

  test('the longest project label decides; without an entry the spec’s label stays', () => {
    const host = 'd-acme-de-plus--feat--x.dating.staging.example.test';
    expect(projectOfHost(config(), host)).toBe('acme-de-plus');
    expect(consentButtonFor(config(), host, 'Ablehnen')).toBe('Ablehnen');
  });

  test('a host of another apex, no settings, or no label at all give no label', () => {
    expect(projectOfHost(config(), 'd-acme-de--main.dating.other.example.test')).toBeNull();
    expect(consentButtonFor(config(), 'd-acme-de--main.dating.other.example.test')).toBeUndefined();
    expect(consentButtonFor(null, 'd-acme-de--main.dating.staging.example.test', 'Nein')).toBe(
      'Nein',
    );
    expect(consentButtonFor(null, 'x.example.test', '')).toBeUndefined();
  });

  test('a project label like a prototype name is just a label', () => {
    const c = { ...config(), projects: { x: 'constructor' }, consentButtons: {} };
    expect(consentButtonFor(c, 'd-constructor--main.dating.staging.example.test', 'Nein')).toBe(
      'Nein',
    );
  });

  test('a label that a longer one starts with does not take the longer one’s hosts', () => {
    const c = { ...config(), projects: { a: 'acme', b: 'acme--x' } };
    expect(projectOfHost(c, 'd-acme--x--main.dating.staging.example.test')).toBe('acme--x');
  });

  test('only the whole host counts', () => {
    for (const host of [
      'x.d-acme-de--main.dating.staging.example.test',
      'd-acme-de--main.dating.staging.example.test.evil.example',
    ])
      expect(projectOfHost(config(), host)).toBeNull();
  });
});
