import { describe, expect, test } from 'bun:test';
import { dataDir, stateDir } from '../src/paths.js';

describe('paths', () => {
  test('settings under XDG_CONFIG_HOME, state under XDG_DATA_HOME', () => {
    expect(dataDir({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/h' })).toBe('/x/cfg/staging-device-check');
    expect(stateDir({ XDG_DATA_HOME: '/x/data', HOME: '/h' })).toBe('/x/data/staging-device-check');
    expect(stateDir({ HOME: '/h' })).toBe('/h/.local/share/staging-device-check');
    expect(stateDir({ CLAUDE_PLUGIN_DATA: '/d', HOME: '/h' })).toBe(
      '/h/.local/share/staging-device-check',
    );
  });
});
