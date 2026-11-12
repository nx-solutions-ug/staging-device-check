import { describe, expect, test } from 'bun:test';
import { appCookieParam } from '../plugins/staging-device-check/workspace/harness/app-cookie.js';

const HOST = 'd-acme-de--main.app.staging.example.test';

describe('appCookieParam', () => {
  test('a preference the app reads (its language) goes to the confirmed host only, readable by the page', () => {
    expect(appCookieParam(HOST, 'ui_lang', 'de')).toEqual({
      name: 'ui_lang',
      value: 'de',
      url: `https://${HOST}/`,
      secure: true,
      httpOnly: false,
      sameSite: 'Lax',
    });
  });

  test('refuses sign-in, session, gate and token cookies', () => {
    for (const name of [
      'staging_gate',
      'APP_SESSID',
      'session',
      'run_token',
      'auth',
      'XSRF-TOKEN',
      'remember_me',
      'jwt',
      'login',
    ])
      expect(() => appCookieParam(HOST, name, 'x')).toThrow('nur eine Einstellung');
  });

  test('refuses long values: a preference is short', () => {
    expect(() => appCookieParam(HOST, 'ui_lang', 'x'.repeat(65))).toThrow('nur eine Einstellung');
  });
});
