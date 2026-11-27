/**
 * The minimum length of a password — the same in all places. That every
 * path that sets a password checks it is shown by password-rule-db.test.js
 * (“passwords that are too short are rejected on all five paths”).
 *
 * Counter-check (measured 11.11.2026): `password_too_short` in src/infra/errorTexts.ts
 * set to „mindestens 8 Zeichen“ → red “the error message names the same number …”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, withoutComments } = require('./helpers/sources');
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
  assert.equal(passwordToShort(123), true, 'A number has no .length — it must not slip through');
  // The opposite direction, so that the line above does not merely prove „everything is too
  // short": the number becomes its digit sequence, and that is long
  // enough (`String(123456789012)` has twelve characters).
  assert.equal(passwordToShort(123456789012), false);
});

test('server and web app name the same number', () => {
  const web = withoutComments(read('public/js/form.js'));
  const webNumber = /export const PASSWORD_MIN_CHARS = (\d+)/.exec(web);
  assert.ok(webNumber, 'The web app no longer keeps a constant — then the number is scattered again');
  assert.equal(Number(webNumber[1]), PASSWORD_MIN_CHARS, 'Web app and server demand different lengths');
});

test('the error message names the same number as the rule', () => {
  // The texts cannot follow the constant; a text that promises less
  // than the server demands leads the user into a refusal.
  const { errorText } = _req('src/infra/errorTexts.js');
  for (const language of ['de', 'en'])
    assert.match(errorText('password_too_short', language), new RegExp(`\\b${PASSWORD_MIN_CHARS}\\b`), language);
  // The web app fills in the number at runtime: there a placeholder, no number.
  const texts = require('./helpers/sources').loadTranslations();
  for (const language of ['de', 'en']) {
    const text = texts[language]['settings.password.too_short'];
    assert.ok(text, `settings.password.too_short is missing in ${language}.js`);
    assert.ok(text.includes('{n}'), `${language}.js spells out the number instead of using {n}`);
  }
});

test('the web app checks before submitting', async () => {
  // Real bundle in jsdom: every form that sets a password names the rule at once and sends nothing.
  // Counter-checks (22.11.2026, each alone): the passwordRuleText check removed from btn-sav-pw
  // (settings.js), btn-cu or btn-rpw (user-management.js), btn-register, btn-reset or btn-required
  // (session.js) → red with the name of that form (rule not named, asked or sent anyway).
  const { openUi, tick } = require('./helpers/ui');
  const SHORT = 'kurz-1';
  const { de } = require('./helpers/sources').loadTranslations();
  const rule = de['settings.password.too_short'].replace('{n}', String(PASSWORD_MIN_CHARS));
  const forms = {
    'change password': { fields: { 'pw-n': SHORT, 'pw-r': SHORT }, button: 'btn-sav-pw', where: '#pw-n-error' },
    'create account': { fields: { 'nu-n': 'carla', 'nu-p': SHORT }, button: 'btn-cu', where: '#nu-p-error' },
    'reset account password': { fields: { 'rpw-uid': '7', 'rpw-v': SHORT }, button: 'btn-rpw', where: '#toasts' },
    register: {
      fields: { 'reg-user': 'carla', 'reg-email': 'c@example.org', 'reg-pass': SHORT, 'reg-pass2': SHORT },
      button: 'btn-register',
      where: '#reg-err',
      signedOut: true,
    },
    'reset via link': {
      fields: { 'reset-pass': SHORT, 'reset-pass2': SHORT },
      button: 'btn-reset',
      where: '#reset-err',
      signedOut: true,
    },
    'required change': {
      fields: { 'required-new': SHORT, 'required-repeat': SHORT },
      button: 'btn-required',
      where: '#required-err',
    },
  };
  for (const [name, f] of Object.entries(forms)) {
    const { w, d, calls, settle } = await openUi({}, { loggedIn: !f.signedOut });
    try {
      await settle();
      const before = calls.length;
      for (const [id, v] of Object.entries(f.fields)) {
        const el = d.getElementById(id);
        assert.ok(el, `${name}: field #${id} is missing`);
        el.value = v;
      }
      assert.ok(d.getElementById(f.button), `${name}: button #${f.button} is missing`);
      d.getElementById(f.button).click();
      await tick(50);
      const sent = calls.slice(before).filter(a => a.method !== 'GET');
      assert.deepEqual(
        sent.map(a => a.url),
        [],
        `${name}: a request went out with a too short password`,
      );
      assert.ok(d.querySelector(f.where)?.textContent.includes(rule), `${name}: the rule is not named at ${f.where}`);
      assert.notEqual(d.getElementById('confirm-modal')?.style.display, 'flex', `${name}: asked before checking`);
    } finally {
      w.close();
    }
  }
});
