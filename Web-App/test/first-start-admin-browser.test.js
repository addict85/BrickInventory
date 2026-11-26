/**
 * An administrator's first start asks for the password only once, at the login
 * (docs/SICHERHEIT.md): the profile saves without a dialog, the mandatory change
 * asks only for the new password, “set up” does not ask again, the code field
 * submits with the Enter key, the QR image has a name and a wrong code stands at
 * the field instead of as a toast.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  (26.11.2026) in actions.js the Enter listener for forms with `data-submit`
 *      removed → red: “the mandatory change asks only for …” (Enter in the
 *      repeat field submits nothing) and the parts after it
 *   B  (26.11.2026) the field `required-alt` back into index.html → red: “the
 *      mandatory change asks only for the new password”
 *   C  in setupSecondFactor a password dialog first again → red: “set up
 *      without a further password prompt”
 *   D  setting alt on the QR image removed → red: “QR image with name”
 *   E  confirmSecondFactor reports the error as a toast again → red: “wrong
 *      code at the field”
 *   F  the setup again in <div class="sform"> instead of <form> → red:
 *      “Enter in the code field confirms”
 *   G  in zeigeCodes the switch of the introduction removed → red: “correct
 *      code shows the recovery codes” (introduction “Bitte jetzt …”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp, sleep } = require('./helpers/app-browser');

const ROOT = path.join(__dirname, '..');
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };

test('first start with one password prompt', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `erst_v_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, db } = app;
  const tap = async text => b.tab('Input.insertText', { text });
  const enter = async () => {
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...ENTER });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
  };
  const open = id => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  const errorToasts = `[...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent)`;

  await t.test('the profile saves without a dialog', async () => {
    await b.evaluate(`location.hash = '#/konto'; true`);
    await until(`document.getElementById('prof-user')?.value !== ''`, 'Profile loaded');
    await b.evaluate(
      `document.getElementById('prof-first').value = 'Erika'; document.getElementById('btn-sav-prof').click(); true`,
    );
    for (
      let i = 0;
      i < 50 && (await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name !== 'Erika';
      i++
    )
      await sleep(100);
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name, 'Erika');
    assert.equal(await b.evaluate(open('confirm-modal')), false, 'a dialog opened');
  });

  // A fresh initial account as after the first server start: administrator, initial password, no second factor.
  const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
  const NAME = `erst_s_${process.pid}`,
    START = 'Start-Passwort-0815',
    NEW = 'Eigenes-Passwort-4711';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const sid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin, must_change_password)
    VALUES ($1, $2, $3, true, true, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(START, 4)],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [sid]).catch(() => {}));

  await t.test('the mandatory change asks only for the new password', async () => {
    // Logging out reloads the page; the mask then speaks the browser's language.
    await b.tab('Network.setUserAgentOverride', {
      userAgent: await b.evaluate('navigator.userAgent'),
      acceptLanguage: 'de-DE',
    });
    await b.evaluate(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await until(`!window.__alt && ${open('login-screen')}`, 'Anmeldemaske');
    await b.evaluate(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
      document.getElementById('lp').value = ${JSON.stringify(START)};
      document.getElementById('btn-login').click(); true`);
    await until(open('panel-required-change'), 'Pflichtwechsel', 300);
    const z =
      await b.evaluate(`({ oldField: !!document.querySelector('#panel-required-change [autocomplete="current-password"]'),
      focused: document.activeElement?.id, rule: document.getElementById('required-rule').textContent,
      described: document.getElementById('required-new').getAttribute('aria-describedby') })`);
    assert.equal(z.oldField, false, 'the mandatory change asks only for the new password');
    assert.equal(z.focused, 'required-new', 'Focus in the first field');
    assert.match(z.rule, /12 Zeichen/, 'Rule as help text');
    assert.equal(z.described, 'required-rule');
    await tap(NEW);
    await b.evaluate(`document.getElementById('required-repeat').focus(); true`);
    await tap(NEW);
    await enter();
    // After reloading the page waits in case the server is still enqueuing its startup jobs.
    await until(`!!document.getElementById('sf-start')`, 'Setup after the switch', 1200);
    await until(`document.activeElement?.id === 'sf-start'`, 'Focus on „Einrichten“');
  });

  let secret = '';
  await t.test('setup without a further password prompt', async () => {
    await b.evaluate(`document.getElementById('sf-start').click(); true`);
    await until(`!!document.querySelector('#sf-qr img') || ${open('confirm-modal')}`, 'QR code or dialog');
    assert.equal(await b.evaluate(open('confirm-modal')), false, 'setup without a further password prompt');
    secret = await b.evaluate(`document.querySelector('#sf-required-surface code').textContent.replace(/\\s+/g, '')`);
  });

  await t.test('QR image with name', async () => {
    assert.match(await b.evaluate(`document.querySelector('#sf-qr img').getAttribute('alt') || ''`), /QR-Code/);
  });

  await t.test('wrong code at the field', async () => {
    await b.evaluate(`document.getElementById('sf-code').focus(); true`);
    await tap('000000');
    await enter();
    await until(
      `(document.getElementById('sf-error')?.textContent || '') !== ''`,
      'Enter in the code field confirms',
      50,
    );
    const z = await b.evaluate(
      `({ invalid: document.getElementById('sf-code').getAttribute('aria-invalid'), toasts: ${errorToasts} })`,
    );
    assert.equal(z.invalid, 'true');
    assert.deepEqual(z.toasts, [], 'wrong code at the field, not as a toast');
  });

  await t.test('correct code shows the recovery codes', async () => {
    const _req = require('./helpers/sources').buildAndRequire();
    const zf = _req('src/factors/secondFactor.js');
    await b.evaluate(`document.getElementById('sf-code').value = ''; document.getElementById('sf-code').focus(); true`);
    await tap(zf.hotp(zf.fromBase32(secret), zf.timeStep()));
    await enter();
    await until(`!!document.getElementById('sf-codes')`, 'Wiederherstellungscodes');
    assert.deepEqual(await b.evaluate(errorToasts), [], 'no leftover error toast');
    // Above the codes the request to set up no longer stands.
    assert.match(
      await b.evaluate(`document.getElementById('sf-required-hint').textContent`),
      /ist eingerichtet.*Wiederherstellungscodes sichern/,
    );
  });
});
