import { defaults, type Config } from '../../src/config.js';

/** Invented values with the real shape — never real hosts, projects or people. */
export const sampleConfig = (over: Partial<Config> = {}): Config => ({
  apex: 'https://staging.example.test',
  hostPattern: 'd-{project}--{branch}.dating.{apexHost}',
  projects: { 'acme.de': 'acme-de' },
  browserstackYml: '/Users/tester/browserstack/browserstack.yml',
  accounts: [],
  jiraSite: 'example.atlassian.test',
  ...defaults,
  ...over,
});
