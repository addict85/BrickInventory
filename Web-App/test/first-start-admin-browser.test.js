/**
 * Enter confirms, and an administrator's first start asks for the password only
 * once: the confirmation dialog and the code field during setup submit with
 * the Enter key; the initial password travels from the login into the
 * mandatory change, “set up” does not ask again afterwards, the QR image has
 * a name and a wrong code stands at the field instead of as a toast.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  in aktionen.js the Enter listener for forms with `data-submit`
 *      removed → red: “Enter in the password field confirms”
 *   B  in showRequiredSwitch the takeover from #lp removed → red:
 *      “the initial password travels along”
 *   C  in setupSecondFactor again confirmWithPassword immediately → red: “set up
 *      without a third password prompt”
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
const { startApp, warte } = require('./helpers/app-browser');

const ROOT = path.join(__dirname, '..');
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };

test('Enter confirms, first start with one password prompt', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `erst_v_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db } = app;
  const tap = async text => b.tab('Input.insertText', { text });
  const enter = async () => {
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...ENTER });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
  };
  const offen = id => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  const errorToasts = `[...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent)`;

  await t.test('Enter in the password field confirms', async () => {
    await b.auswerten(`location.hash = '#/konto'; true`);
    await bis(`document.getElementById('prof-user')?.value !== ''`, 'Profil geladen');
    await b.auswerten(
      `document.getElementById('prof-first').value = 'Erika'; document.getElementById('btn-sav-prof').click(); true`,
    );
    await bis(`${offen('confirm-modal')} && document.activeElement?.id === 'cd-pw'`, 'Passwortdialog mit Fokus');
    await tap('app-Passwort-1');
    await enter();
    // With a second factor the code follows in the same dialog; it also goes with Enter.
    await bis(`document.activeElement?.id === 'cd-code'`, 'Enter im Passwortfeld bestätigt', 50);
    await tap(app.furtherCodes[0]);
    await enter();
    await bis(`!(${offen('confirm-modal')})`, 'Enter im Codefeld des Dialogs bestätigt', 50);
    for (
      let i = 0;
      i < 50 && (await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name !== 'Erika';
      i++
    )
      await warte(100);
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name, 'Erika');
  });

  // A fresh initial account as after the first server start: administrator, initial password, no second factor.
  const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
  const NAME = `erst_s_${process.pid}`,
    START = 'Start-Passwort-0815',
    NEU = 'Eigenes-Passwort-4711';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const sid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin, must_change_password)
    VALUES ($1, $2, $3, true, true, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(START, 4)],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [sid]).catch(() => {}));

  await t.test('the start password travels along', async () => {
    // Logging out reloads the page; the mask then speaks the browser's language.
    await b.tab('Network.setUserAgentOverride', {
      userAgent: await b.auswerten('navigator.userAgent'),
      acceptLanguage: 'de-DE',
    });
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(`!window.__alt && ${offen('login-screen')}`, 'Anmeldemaske');
    await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
      document.getElementById('lp').value = ${JSON.stringify(START)};
      document.getElementById('btn-login').click(); true`);
    await bis(offen('panel-required-change'), 'Pflichtwechsel', 300);
    const z =
      await b.auswerten(`({ altHidden: getComputedStyle(document.getElementById('required-alt-row')).display === 'none',
      fokus: document.activeElement?.id, regel: document.getElementById('required-rule').textContent,
      described: document.getElementById('required-new').getAttribute('aria-describedby') })`);
    assert.equal(z.altHidden, true, 'das Startpasswort reist mit (Feld „Aktuelles Passwort“ verborgen)');
    assert.equal(z.fokus, 'required-new', 'Fokus im ersten Feld');
    assert.match(z.regel, /12 Zeichen/, 'Regel als Hilfetext');
    assert.equal(z.described, 'required-rule');
    await tap(NEU);
    await b.auswerten(`document.getElementById('required-repeat').focus(); true`);
    await tap(NEU);
    await enter();
    // After reloading the page waits in case the server is still enqueuing its startup jobs.
    await bis(`!!document.getElementById('sf-start')`, 'Einrichten nach dem Wechsel', 1200);
    await bis(`document.activeElement?.id === 'sf-start'`, 'Fokus auf „Einrichten“');
  });

  let geheimnis = '';
  await t.test('setup without a third password prompt', async () => {
    await b.auswerten(`document.getElementById('sf-start').click(); true`);
    await bis(`!!document.querySelector('#sf-qr img') || ${offen('confirm-modal')}`, 'QR-Code oder Dialog');
    assert.equal(await b.auswerten(offen('confirm-modal')), false, 'Einrichten ohne dritte Passwortabfrage');
    geheimnis = await b.auswerten(
      `document.querySelector('#sf-required-surface code').textContent.replace(/\\s+/g, '')`,
    );
  });

  await t.test('QR image with name', async () => {
    assert.match(await b.auswerten(`document.querySelector('#sf-qr img').getAttribute('alt') || ''`), /QR-Code/);
  });

  await t.test('wrong code at the field', async () => {
    await b.auswerten(`document.getElementById('sf-code').focus(); true`);
    await tap('000000');
    await enter();
    await bis(`(document.getElementById('sf-error')?.textContent || '') !== ''`, 'Enter im Codefeld bestätigt', 50);
    const z = await b.auswerten(
      `({ ungueltig: document.getElementById('sf-code').getAttribute('aria-invalid'), toasts: ${errorToasts} })`,
    );
    assert.equal(z.ungueltig, 'true');
    assert.deepEqual(z.toasts, [], 'falscher Code am Feld, nicht als Toast');
  });

  await t.test('correct code shows the recovery codes', async () => {
    const _req = require('./helpers/sources').buildAndRequire();
    const zf = _req('src/factors/secondFactor.js');
    await b.auswerten(
      `document.getElementById('sf-code').value = ''; document.getElementById('sf-code').focus(); true`,
    );
    await tap(zf.hotp(zf.fromBase32(geheimnis), zf.timeStep()));
    await enter();
    await bis(`!!document.getElementById('sf-codes')`, 'Wiederherstellungscodes');
    assert.deepEqual(await b.auswerten(errorToasts), [], 'kein liegen gebliebener Fehler-Toast');
    // Above the codes the request to set up no longer stands.
    assert.match(
      await b.auswerten(`document.getElementById('sf-required-hint').textContent`),
      /ist eingerichtet.*Wiederherstellungscodes sichern/,
    );
  });
});
