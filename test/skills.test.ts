import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { COMMANDS } from '../src/cli.js';

const PLUGIN = join(import.meta.dir, '..', 'plugins', 'staging-device-check');
const skillDirs = () => readdirSync(join(PLUGIN, 'skills'));
const read = (...p: string[]) => readFileSync(join(PLUGIN, ...p), 'utf8');

function frontmatter(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error('no frontmatter');
  return parse(m[1]) as Record<string, unknown>;
}

describe('skills', () => {
  test('setup and tests-e2e exist', () => {
    expect(skillDirs().sort()).toEqual(['setup', 'tests-e2e']);
  });

  test('skills have name/description frontmatter and reference only existing cli commands', () => {
    for (const dir of skillDirs()) {
      const md = read('skills', dir, 'SKILL.md');
      const fm = frontmatter(md);
      expect(fm.name).toBe(dir);
      expect(typeof fm.description).toBe('string');
      expect((fm.description as string).length).toBeGreaterThan(40);
      // English description with German trigger sentences for the tester
      expect(fm.description as string).toMatch(/Use when/);
      expect(fm.description as string).toMatch(/"[^"]*(teste|einrichten)[^"]*"/);
      const used = [...md.matchAll(/cli\.js"? ([a-z-]+)/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const cmd of used) expect(COMMANDS as readonly string[]).toContain(cmd);
      // the CLI is always reached through the plugin root, which Claude Code substitutes in skill content
      for (const m of md.matchAll(/node "?([^"\s]*)\/dist\/cli\.js/g))
        expect(m[1]).toBe('${CLAUDE_PLUGIN_ROOT}');
    }
  });

  test('tests-e2e takes the ticket and links its references', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    const fm = frontmatter(md);
    expect(fm['argument-hint']).toBeTruthy();
    expect(md).toContain('$ARGUMENTS');
    for (const ref of ['stand-format', 'layout-rules', 'ios-limits', 'safety']) {
      expect(existsSync(join(PLUGIN, 'skills', 'tests-e2e', 'references', `${ref}.md`))).toBe(true);
      expect(md).toContain(`references/${ref}.md`);
    }
    // the rules from the carry the generated spec must follow
    for (const s of [
      'evaluateWith',
      'account(',
      "check('",
      'expect.soft',
      'zuPruefen(',
      '{ keyboard: true }',
      'One `test` per persona',
      'SDC_MAILBOX',
      '--mailbox demo',
    ])
      expect(md).toContain(s);
    // the per-check annotation helpers the skill names exist in the harness
    const fixtures = readFileSync(join(PLUGIN, 'workspace', 'harness', 'fixtures.ts'), 'utf8');
    expect(fixtures).toContain('export async function check(');
    // the spec example uses only check(), never a raw test.step or a hand-written annotation
    const example = /```ts\n([\s\S]*?)```/.exec(md)?.[1] ?? '';
    expect(example).toContain("check('");
    expect(example).not.toContain('test.step');
    expect(example).not.toContain('annotations.push');
  });

  test('setup sends set-secret to her own terminal, never through the chat', () => {
    const md = read('skills', 'setup', 'SKILL.md');
    expect(md).toContain('set-secret');
    expect(md).toMatch(/Terminal/);
    expect(md).toContain('doctor');
    expect(md).toContain('install-workspace');
    expect(md).toContain('local-state');
    // spec §5: Jira must be readable through her Atlassian connection
    expect(md).toMatch(/Jira[^\n]*(lesbar|readable)/);
  });

  test('tests-e2e names the settings file and builds the host through the CLI', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    expect(md).toContain('${XDG_CONFIG_HOME:-$HOME/.config}/staging-device-check/config.json');
    expect(md).toContain('cli.js" host');
    expect(md).toContain('cli.js" doctor');
    // the example asserts concrete rule outcomes, not just "not failed"
    expect(md).not.toContain(".not.toBe('nicht bestanden')");
  });

  test('tests-e2e starts run in the background, never as a plain 2-minute Bash call', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    const step = md.slice(md.indexOf('## 6.'), md.indexOf('## Never'));
    expect(step).toContain('run_in_background: true');
    expect(step).toContain('600000');
    expect(step).toMatch(/never a\s+plain/i);
    expect(step).toMatch(/completion notice/);
  });

  test('tests-e2e says a real failure wins over nicht prüfbar hier', () => {
    expect(read('skills', 'tests-e2e', 'SKILL.md')).toMatch(/real failure wins/);
  });
});

describe('.mcp.json', () => {
  const mcp = () =>
    JSON.parse(read('.mcp.json')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

  test('.mcp.json pins @playwright/mcp', () => {
    const s = mcp().mcpServers.playwright;
    expect(s).toBeDefined();
    const all = [s.command, ...s.args].join(' ');
    expect(all).toMatch(/@playwright\/mcp@\d+\.\d+\.\d+(?!\S*[\^~*x])/);
  });

  test('starts with the gate storage state, isolated, at phone size', () => {
    const all = [mcp().mcpServers.playwright.command, ...mcp().mcpServers.playwright.args].join(
      ' ',
    );
    expect(all).toContain('--isolated');
    expect(all).toContain('--storage-state');
    expect(all).toContain(
      '${XDG_DATA_HOME:-$HOME/.local/share}/staging-device-check/gate-state.json',
    );
    expect(all).toContain('--viewport-size 393x852');
  });
});

describe('README', () => {
  test('German README for the tester', () => {
    const md = read('README.md');
    expect(md).toContain('/plugin marketplace add nx-solutions-ug/staging-device-check');
    for (const w of [
      'bestanden',
      'nicht bestanden',
      'zu prüfen (Bild)',
      'nicht prüfbar hier',
      'Tastatur',
    ])
      expect(md).toContain(w);
  });
});
