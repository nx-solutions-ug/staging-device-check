import { describe, expect, test } from 'bun:test';
import { appHost, branchLabel } from '../src/hosts.js';
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
