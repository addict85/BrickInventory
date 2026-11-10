/**
 * „+“ bei Anzahl im Set-Detail legt eine Kauferfassung an — meist mit dem
 * Marktpreis als Schätzung. Die Oberfläche sagt das: Der Toast nennt den
 * geschätzten Betrag und bietet „Ändern“ an, die Kaufpreisliste erklärt „≈“.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in autosaveSet den Aufruf meldeNeueExemplare(...) entfernt und wieder
 *      immer toast('Gespeichert') → rot: Zeitüberschreitung „Toast nach +“
 *      (es kommt nur „Gespeichert“)
 *   B  legendeGeschaetzt() liefert '' → rot: „die Kaufpreisliste erklärt ≈“
 *   C  im Toast die Aktion weggelassen → rot: „Ändern öffnet die Kaufpreise“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet, katalogSet } = require('./helpers/bestand');

test('Anzahl „+“ meldet das neue Exemplar mit Preis', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `plus_${process.pid}`,
    bestand: async (db, uid) => {
      await katalogSet(db, '21318-1', { name: 'Baumhaus', year: 2019 });
      await haeltSet(db, uid, '21318-1', 1, { preis: 224.99 });
      await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                    VALUES ('21318-1', 'N', 'EUR', 300, 364.32, 400, 364.32, 10, NOW()) ON CONFLICT DO NOTHING`).catch(() => {});
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, db, uid, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  await b.auswerten(`location.hash = '#/sammlung/set/21318-1'; true`);
  await bis(`document.getElementById('set-modal')?.classList.contains('open') && !!document.getElementById('m-qty')`, 'Set-Detail');
  await b.auswerten(`document.querySelector('#set-modal [data-click="mQtyInc"]').click(); true`);
  await bis(`[...document.querySelectorAll('#toasts .toast')].some(x => /angelegt/.test(x.textContent))`, 'Toast nach „+“');

  await t.test('Toast nennt den geschätzten Preis', async () => {
    const texte = await b.auswerten(`[...document.querySelectorAll('#toasts .toast')].map(x => x.textContent)`);
    assert.ok(texte.some(x => /Exemplar mit geschätztem Preis .*364[.,]32.* angelegt/.test(x)), JSON.stringify(texte));
    assert.ok(!texte.some(x => /^Gespeichert/.test(x.trim())), `nur „Gespeichert“: ${JSON.stringify(texte)}`);
    const zeile = await db.get(`SELECT price_estimated, purchase_price FROM set_acquisitions WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [uid]);
    assert.equal(zeile.price_estimated, true, 'Testdaten: der Server schätzt den Preis');
  });
  await t.test('die Kaufpreisliste erklärt ≈', async () => {
    await bis(`/≈/.test(document.getElementById('m-acq-summary')?.textContent || '')`, 'geschätzte Zeile');
    const legende = await b.auswerten(`document.querySelector('#m-acq-summary .acq-legende')?.textContent || ''`);
    assert.match(legende, /≈ geschätzt/);
  });
  await t.test('Ändern öffnet die Kaufpreise', async () => {
    const da = await b.auswerten(`(() => { const k = [...document.querySelectorAll('#toasts .toast-aktion')].find(x => x.textContent === 'Ändern'); k?.click(); return !!k; })()`);
    assert.ok(da, 'Knopf „Ändern“ fehlt');
    await bis(`document.getElementById('acq-modal')?.classList.contains('open')`, 'Kaufpreis-Dialog');
  });
});
