/**
 * Enter bestätigt, und der Erststart eines Verwalters fragt das Passwort nur
 * einmal: Der Bestätigungsdialog und das Codefeld beim Einrichten senden mit
 * der Eingabetaste ab; das Startpasswort reist aus der Anmeldung in den
 * Pflichtwechsel, „Einrichten“ fragt danach nicht erneut, das QR-Bild hat
 * einen Namen und ein falscher Code steht am Feld statt als Toast.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in actions.js den Enter-Hörer für Formulare mit `data-submit`
 *      entfernt → rot: „Enter im Passwortfeld bestätigt“
 *   B  in zeigePflichtwechsel das Übernehmen aus #lp entfernt → rot:
 *      „das Startpasswort reist mit“
 *   C  in zfEinrichten wieder sofort mitPasswortBestaetigen → rot: „Einrichten
 *      ohne dritte Passwortabfrage“
 *   D  das Setzen von alt am QR-Bild entfernt → rot: „QR-Bild mit Namen“
 *   E  zfBestaetigen meldet den Fehler wieder als Toast → rot: „falscher
 *      Code am Feld“
 *   F  die Einrichtung wieder in <div class="sform"> statt <form> → rot:
 *      „Enter im Codefeld bestätigt“
 *   G  in zeigeCodes das Umschalten der Einleitung entfernt → rot: „richtiger
 *      Code zeigt die Wiederherstellungscodes“ (Einleitung „Bitte jetzt …“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { starteApp, warte } = require('./helpers/app-browser');

const ROOT = path.join(__dirname, '..');
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };

test('Enter bestätigt, Erststart mit einer Passwortabfrage', { timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, { name: `erst_v_${process.pid}` });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, db } = app;
  const tippe = async (text) => b.tab('Input.insertText', { text });
  const enter = async () => {
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...ENTER });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
  };
  const offen = (id) => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  const fehlerToasts = `[...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent)`;

  await t.test('Enter im Passwortfeld bestätigt', async () => {
    await b.auswerten(`location.hash = '#/konto'; true`);
    await bis(`document.getElementById('prof-user')?.value !== ''`, 'Profil geladen');
    await b.auswerten(`document.getElementById('prof-first').value = 'Erika'; document.getElementById('btn-sav-prof').click(); true`);
    await bis(`${offen('confirm-modal')} && document.activeElement?.id === 'cd-pw'`, 'Passwortdialog mit Fokus');
    await tippe('app-Passwort-1');
    await enter();
    // Mit zweitem Faktor folgt der Code im selben Dialog; auch er geht mit Enter.
    await bis(`document.activeElement?.id === 'cd-code'`, 'Enter im Passwortfeld bestätigt', 50);
    await tippe(app.weitereCodes[0]);
    await enter();
    await bis(`!(${offen('confirm-modal')})`, 'Enter im Codefeld des Dialogs bestätigt', 50);
    for (let i = 0; i < 50 && (await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name !== 'Erika'; i++) await warte(100);
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [app.uid])).first_name, 'Erika');
  });

  // Ein frisches Startkonto wie nach dem ersten Serverstart: Verwalter, Startpasswort, kein zweiter Faktor.
  const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
  const NAME = `erst_s_${process.pid}`, START = 'Start-Passwort-0815', NEU = 'Eigenes-Passwort-4711';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const sid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin, must_change_password)
    VALUES ($1, $2, $3, true, true, true, true) RETURNING id`, [NAME, `${NAME}@example.org`, await bcrypt.hash(START, 4)])).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [sid]).catch(() => {}));

  await t.test('das Startpasswort reist mit', async () => {
    await b.auswerten(`document.getElementById('btn-logout').click(); true`);
    await bis(offen('login-screen'), 'Anmeldemaske');
    await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
      document.getElementById('lp').value = ${JSON.stringify(START)};
      document.getElementById('btn-login').click(); true`);
    await bis(offen('panel-pflichtwechsel'), 'Pflichtwechsel', 300);
    const z = await b.auswerten(`({ altVerborgen: getComputedStyle(document.getElementById('pflicht-alt-zeile')).display === 'none',
      fokus: document.activeElement?.id, regel: document.getElementById('pflicht-regel').textContent,
      beschrieben: document.getElementById('pflicht-neu').getAttribute('aria-describedby') })`);
    assert.equal(z.altVerborgen, true, 'das Startpasswort reist mit (Feld „Aktuelles Passwort“ verborgen)');
    assert.equal(z.fokus, 'pflicht-neu', 'Fokus im ersten Feld');
    assert.match(z.regel, /12 Zeichen/, 'Regel als Hilfetext');
    assert.equal(z.beschrieben, 'pflicht-regel');
    await tippe(NEU);
    await b.auswerten(`document.getElementById('pflicht-wdh').focus(); true`);
    await tippe(NEU);
    await enter();
    // Nach dem Neuladen wartet die Seite, falls der Server noch seine Startaufträge einreiht.
    await bis(`!!document.getElementById('zf-start')`, 'Einrichten nach dem Wechsel', 1200);
    await bis(`document.activeElement?.id === 'zf-start'`, 'Fokus auf „Einrichten“');
  });

  let geheimnis = '';
  await t.test('Einrichten ohne dritte Passwortabfrage', async () => {
    await b.auswerten(`document.getElementById('zf-start').click(); true`);
    await bis(`!!document.querySelector('#zf-qr img') || ${offen('confirm-modal')}`, 'QR-Code oder Dialog');
    assert.equal(await b.auswerten(offen('confirm-modal')), false, 'Einrichten ohne dritte Passwortabfrage');
    geheimnis = await b.auswerten(`document.querySelector('#zf-pflicht-flaeche code').textContent.replace(/\\s+/g, '')`);
  });

  await t.test('QR-Bild mit Namen', async () => {
    assert.match(await b.auswerten(`document.querySelector('#zf-qr img').getAttribute('alt') || ''`), /QR-Code/);
  });

  await t.test('falscher Code am Feld', async () => {
    await b.auswerten(`document.getElementById('zf-code').focus(); true`);
    await tippe('000000');
    await enter();
    await bis(`(document.getElementById('zf-fehler')?.textContent || '') !== ''`, 'Enter im Codefeld bestätigt', 50);
    const z = await b.auswerten(`({ ungueltig: document.getElementById('zf-code').getAttribute('aria-invalid'), toasts: ${fehlerToasts} })`);
    assert.equal(z.ungueltig, 'true');
    assert.deepEqual(z.toasts, [], 'falscher Code am Feld, nicht als Toast');
  });

  await t.test('richtiger Code zeigt die Wiederherstellungscodes', async () => {
    const _req = require('./helpers/sources').buildAndRequire();
    const zf = _req('src/konto/zweiterFaktor.js');
    await b.auswerten(`document.getElementById('zf-code').value = ''; document.getElementById('zf-code').focus(); true`);
    await tippe(zf.hotp(zf.ausBase32(geheimnis), zf.zeitschritt()));
    await enter();
    await bis(`!!document.getElementById('zf-codes')`, 'Wiederherstellungscodes');
    assert.deepEqual(await b.auswerten(fehlerToasts), [], 'kein liegen gebliebener Fehler-Toast');
    // Über den Codes steht nicht mehr die Aufforderung zum Einrichten.
    assert.match(await b.auswerten(`document.getElementById('zfpflicht-hinweis').textContent`), /ist eingerichtet.*Wiederherstellungscodes sichern/);
  });
});
