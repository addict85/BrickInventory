/**
 * The minimum length of a password — the same in all places. That every
 * path that sets a password checks it is shown by password-rule-db.test.js
 * (“passwords that are too short are rejected on all five paths”).
 *
 * Counter-check (measured 11.11.2026): `passwort_zu_kurz` in src/infra/errorTexts.ts
 * set to „mindestens 8 Zeichen“ → red “the error message names the same number …”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { PASSWORD_MIN_CHARS, passwordToShort } = _req('src/account/loginCheck.js');

test('the rule itself also holds for what is not a string', () => {
  // Since 04.11.2026 twelve instead of eight.
  assert.equal(passwordToShort('12345678901'), true);
  assert.equal(passwordToShort('123456789012'), false);
  assert.equal(passwordToShort(''), true);
  assert.equal(passwordToShort(null), true);
  assert.equal(passwordToShort(undefined), true);
  // ── The case that two of the four old checks let through ─────────────
  // The body of a request can contain anything. `(123456789).length` is
  // `undefined`, and `undefined < 8` is FALSE — a password as a JSON number
  // thus got past `password.length < 8`. Only the two places with
  // `String(password).length` caught it.
  assert.equal(passwordToShort(123), true, 'Eine Zahl hat kein .length — sie darf nicht durchrutschen');
  // The opposite direction, so that the line above does not merely prove „everything is too
  // short": the number becomes its digit sequence, and that is long
  // enough (`String(123456789012)` has twelve characters).
  assert.equal(passwordToShort(123456789012), false);
});

test('server and web app name the same number', () => {
  const web = ohneKommentare(read('public/js/form.js'));
  const webNumber = /export const PASSWORD_MIN_CHARS = (\d+)/.exec(web);
  assert.ok(webNumber, 'Die Webapp fuehrt keine Konstante mehr — dann steht die Zahl wieder verstreut');
  assert.equal(Number(webNumber[1]), PASSWORD_MIN_CHARS, 'Webapp und Server verlangen verschiedene Laengen');
});

test('the error message names the same number as the rule', () => {
  // The texts cannot follow the constant; a text that promises less
  // than the server demands leads the user into a refusal.
  const { errorText } = _req('src/infra/errorTexts.js');
  for (const sprache of ['de', 'en'])
    assert.match(errorText('passwort_zu_kurz', sprache), new RegExp(`\\b${PASSWORD_MIN_CHARS}\\b`), sprache);
  // The web app fills in the number at runtime: there a placeholder, no number.
  const texte = require('./helpers/sources').loadTranslations();
  for (const sprache of ['de', 'en']) {
    const text = texte[sprache]['settings.password.too_short'];
    assert.ok(text, `settings.password.too_short fehlt in ${sprache}.js`);
    assert.ok(text.includes('{n}'), `${sprache}.js schreibt die Zahl aus statt {n} zu benutzen`);
  }
});

test('the web app checks before submitting', () => {
  // Otherwise it would submit and only then show the server error.
  const core = ohneKommentare(read('public/js/form.js'));
  const settings = ohneKommentare(require('./helpers/sources').ansichtQuelle('einstellungen'));
  // Login, registration and resetting stand in sitzung.js since the rebuild.
  const sitzung = ohneKommentare(read('public/js/session.js'));
  const webCalls =
    (core.match(/passwordRuleText\(/g) || []).length +
    (settings.match(/passwordRuleText\(/g) || []).length +
    (sitzung.match(/passwordRuleText\(/g) || []).length;
  // Five places set a password in the web app: registering,
  // resetting, changing, creating an account, resetting an account password.
  // Plus the definition itself in formular.js.
  assert.ok(webCalls >= 6, `Nur ${webCalls} Vorkommen — nicht alle fuenf Formulare pruefen vor dem Absenden`);
});
