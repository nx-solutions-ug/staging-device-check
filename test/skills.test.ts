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
      "'zu prüfen'",
      "'nicht prüfbar hier'",
      'SDC_MAILBOX',
      '--mailbox demo',
    ])
      expect(md).toContain(s);
  });

  test('setup sends set-secret to her own terminal, never through the chat', () => {
    const md = read('skills', 'setup', 'SKILL.md');
    expect(md).toContain('set-secret');
    expect(md).toMatch(/Terminal/);
    expect(md).toContain('doctor');
    expect(md).toContain('install-workspace');
    expect(md).toContain('local-state');
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
