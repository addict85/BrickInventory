/**
 * Nach dem Abmelden und nach dem Ende der Sitzung steht kein Passwort mehr im
 * Anmeldefeld, und der Ablauf meldet sich genau einmal: als Hinweis in der
 * Anmeldekarte, ohne Fehler-Toast der Listen dahinter.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  in showLogin() das Leeren von #lp entfernt → rot: beide Teilfälle
 *      („das Passwort steht noch im Feld“)
 *   B  in listeLadefehler() die Zeile für Status 401 entfernt und in toast()
 *      den Filter für 401-Meldungen → rot: „Sitzungsablauf“ (Fehler-Toast
 *      „Nicht angemeldet …“ neben dem Hinweis)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

const felder = `({ lu: document.getElementById('lu').value, lp: document.getElementById('lp').value,
  lc: document.getElementById('lc').value, maske: getComputedStyle(document.getElementById('login-screen')).display,
  hinweis: document.getElementById('login-hinweis').hidden ? '' : document.getElementById('login-hinweis').textContent,
  fehler: [...document.querySelectorAll('#toasts .toast.error')].map(t => t.textContent) })`;

test('Anmeldefelder nach Sitzungsablauf und nach Abmelden', { timeout: 180_000 }, async (t) => {
  const app = await starteApp(t, { name: `ablauf_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const maske = `getComputedStyle(document.getElementById('login-screen')).display !== 'none'`;

  await t.test('Sitzungsablauf: Name bleibt, Passwort weg, genau eine Meldung', async () => {
    assert.notEqual(await app.b.auswerten(`document.getElementById('lp').value`), '', 'Vorbedingung: Passwort im Feld');
    await app.db.run(`DELETE FROM user_sessions`);
    // Zwei Ansichten im selben Takt: Die Sammlung lädt neu, während die Teile schon 401 bekommen.
    await app.b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click();
      document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await app.bis(maske, 'Anmeldemaske nach 401');
    await warte(1500);
    const f = await app.b.auswerten(felder);
    assert.equal(f.lp, '', 'das Passwort steht noch im Feld');
    assert.match(f.lu, /^ablauf_/, 'der Name bleibt zum schnellen Wiederanmelden');
    assert.match(f.hinweis, /Sitzung abgelaufen/);
    assert.deepEqual(f.fehler, [], 'Fehler-Toast neben dem Hinweis');
  });

  await t.test('Abmelden leert Name, Passwort und Code', async () => {
    // Verwalter brauchen den zweiten Faktor; der erste Code ging an die erste Anmeldung.
    await app.b.auswerten(`document.getElementById('lp').value = 'app-Passwort-1';
      document.getElementById('lc').value = ${JSON.stringify(app.weitereCodes[0])};
      document.getElementById('btn-login').click(); true`);
    await app.bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'wieder angemeldet', 300);
    assert.equal(await app.b.auswerten(`document.getElementById('login-hinweis').hidden`), true, 'Hinweis verschwindet mit der Anmeldung');
    await app.b.auswerten(`document.getElementById('lp').value = 'app-Passwort-1'; document.getElementById('lc').value = '123456';
      document.getElementById('btn-logout').click(); true`);
    await app.bis(maske, 'Anmeldemaske');
    const f = await app.b.auswerten(felder);
    assert.equal(f.lp, '', 'das Passwort steht noch im Feld');
    assert.equal(f.lc, '', 'der Code steht noch im Feld');
    assert.equal(f.lu, '', 'der Name steht noch im Feld');
    assert.equal(f.hinweis, '', 'nach eigenem Abmelden kein Ablauf-Hinweis');
  });
});
