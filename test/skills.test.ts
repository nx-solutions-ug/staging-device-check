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
      const used = [...md.matchAll(/scripts\/sdc"? ([a-z-]+)/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const cmd of used) expect(COMMANDS as readonly string[]).toContain(cmd);
      // the CLI is always reached through the launcher in the plugin root (its own Node), never a bare `node`
      expect(md).not.toMatch(/dist\/cli\.js/);
      for (const m of md.matchAll(/sh "?([^"\s]*)\/scripts\/sdc/g))
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

  test('setup brings its own Node and asks for the password in a native dialog, the terminal only as fallback', () => {
    const md = read('skills', 'setup', 'SKILL.md');
    expect(md).toContain('sh "${CLAUDE_PLUGIN_ROOT}/scripts/install-node.sh"');
    expect(md).not.toMatch(/node --version|Node 26 oder neuer/);
    expect(md).toContain('sh "${CLAUDE_PLUGIN_ROOT}/scripts/ask-password.sh"');
    expect(md).toContain('600000');
    // the terminal path only when the dialog script exits 3
    expect(md).toMatch(/exits? (with )?(code )?3/i);
    expect(md).toContain('set-secret');
    expect(md).toMatch(/\/mcp/);
    expect(md).toMatch(/neu starten|restart/i);
    expect(md).toContain('doctor');
    expect(md).toContain('install-workspace');
    expect(md).toContain('local-state');
    // spec §5: Jira must be readable through her Atlassian connection
    expect(md).toMatch(/Jira[^\n]*(lesbar|readable)/);
  });

  test('tests-e2e names the settings file and builds the host through the CLI', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    expect(md).toContain('${XDG_CONFIG_HOME:-$HOME/.config}/staging-device-check/config.json');
    expect(md).toContain('sdc" host');
    expect(md).toContain('sdc" doctor');
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

  test('tests-e2e carries the app language over from the local look, generically', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    expect(md).toContain('appCookie(');
    expect(md).toMatch(/local look/);
    expect(md).toContain('nicht prüfbar hier (Gerätesprache)');
    expect(md).not.toMatch(/Never set cookies yourself\./);
    const ios = read('skills', 'tests-e2e', 'references', 'ios-limits.md');
    expect(ios).toMatch(/English/);
    expect(ios).toMatch(/paid plan/i);
    // no app's cookie name in the plugin
    expect(md + ios).not.toContain('_locale');
  });

  test('iOS taps do not wait for visibility: the skill and ios-limits say to wait first', () => {
    const md = read('skills', 'tests-e2e', 'SKILL.md');
    const ios = read('skills', 'tests-e2e', 'references', 'ios-limits.md');
    expect(ios).toMatch(/do not wait/);
    expect(md).toContain('toBeVisible()');
    expect(md).toMatch(/before every `tap`/);
    // the example follows its own rule: every tap comes right after a toBeVisible() on the same locator
    const example = md.slice(md.indexOf('```ts'), md.indexOf('```', md.indexOf('```ts') + 5));
    const lines = example.split('\n');
    lines.forEach((l, i) => {
      if (l.includes('.tap()')) expect(lines[i - 1] ?? '').toContain('toBeVisible()');
    });
  });

  test('tests-e2e says a real failure wins over nicht prüfbar hier', () => {
    expect(read('skills', 'tests-e2e', 'SKILL.md')).toMatch(/real failure wins/);
  });
});

describe('.mcp.json and scripts/playwright-mcp', () => {
  const script = () => read('scripts', 'playwright-mcp');

  test('.mcp.json starts the script through sh, nothing from PATH', () => {
    const server = (JSON.parse(read('.mcp.json')) as { mcpServers: Record<string, unknown> })
      .mcpServers.playwright;
    expect(server).toEqual({
      command: 'sh',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/playwright-mcp'],
    });
  });

  test('the script pins @playwright/mcp', () => {
    expect(script()).toMatch(/@playwright\/mcp@\d+\.\d+\.\d+(?!\S*[\^~*x])/);
  });

  test('starts with the gate storage state, isolated, at phone size, through the found Node', () => {
    const s = script();
    expect(s).toContain('--isolated');
    expect(s).toContain(
      '--storage-state "${XDG_DATA_HOME:-$HOME/.local/share}/staging-device-check/gate-state.json"',
    );
    expect(s).toContain('--viewport-size 393x852');
    expect(s).toContain('"$SDC_NODE_BIN/npx"');
  });
});

describe('README', () => {
  test('German README for the tester', () => {
    const md = read('README.md');
    // no Node to install, no terminal on a Mac
    expect(md).toMatch(/kein Node/i);
    expect(md).toMatch(/kein(e|en)? Terminal/i);
    expect(md).not.toMatch(/Node 26 oder neuer/);
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
