/**
 * Ein normales Konto, das eine Verwalterseite oder einen unbekannten Pfad
 * aufruft, sieht die Sammlung — und die Adresse sagt dasselbe (#/sammlung),
 * dazu ein Hinweis, warum. Ein Sprungverweis (#inhalt) bleibt still.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  im popstate-Zweig die Rückgabe von wendeAn() übergangen (kein
 *      replaceState auf adresse()) → rot: „Verwalterseite: Adresse und Hinweis“
 *      (Adresse blieb #/einstellungen, kein Hinweis)
 *   B  istAppPfad() liefert immer false → rot: „unbekannter Pfad: Hinweis“
 *   C  istAppPfad() liefert immer true → rot: „Sprungverweis bleibt still“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');

test('Verwalterseiten und unbekannte Pfade für normale Konten', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `nutzer_${process.pid}`,
    bestand: async (db, uid) => { await db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]); },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  await warte(1200);
  const toasts = () => b.auswerten(`[...document.querySelectorAll('#toasts .toast')].map(x => x.textContent)`);
  const leeren = () => b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);

  await t.test('Verwalterseite: Adresse und Hinweis', async () => {
    await leeren();
    await b.auswerten(`location.hash = '#/einstellungen'; true`);
    await warte(800);
    const z = await b.auswerten(`({ hash: location.hash, sammlung: document.getElementById('tab-gallery')?.classList.contains('active'),
      einst: document.getElementById('tab-settings')?.classList.contains('active') })`);
    assert.deepEqual(z, { hash: '#/sammlung', sammlung: true, einst: false });
    assert.ok((await toasts()).some(x => /nur für Verwalter/.test(x)), JSON.stringify(await toasts()));
  });

  await t.test('unbekannter Pfad: Hinweis', async () => {
    await leeren();
    await b.auswerten(`location.hash = '#/gibt-es-nicht'; true`);
    await warte(800);
    assert.equal(await b.auswerten(`location.hash`), '#/sammlung');
    assert.ok((await toasts()).some(x => /gibt es nicht/.test(x)), JSON.stringify(await toasts()));
  });

  await t.test('Sprungverweis bleibt still', async () => {
    await leeren();
    await b.auswerten(`location.hash = '#inhalt'; true`);
    await warte(800);
    assert.deepEqual(await toasts(), []);
  });
});
