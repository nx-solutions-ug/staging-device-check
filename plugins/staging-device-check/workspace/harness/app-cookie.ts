/**
 * A preference the app keeps in its own cookie — its language, typically — carried over from the local look, so the
 * device shows what the tester sees. BrowserStack's iPhone runs in English and ignores Playwright's `locale`. Only the
 * confirmed host, only a short value, never anything that signs in or holds a session.
 */
const SIGN_IN = /gate|sess|token|auth|csrf|xsrf|remember|login|jwt/i;

export type AppCookie = {
  name: string;
  value: string;
  url: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Lax';
};

export function appCookieParam(host: string, name: string, value: string): AppCookie {
  if (!name || SIGN_IN.test(name) || value.length > 64 || /[;\r\n]/.test(name + value))
    throw new Error(
      `appCookie setzt nur eine Einstellung der App (etwa ihre Sprache), keinen Anmelde- oder Sitzungs-Cookie: „${name}“`,
    );
  return { name, value, url: `https://${host}/`, secure: true, httpOnly: false, sameSite: 'Lax' };
}
