/**
 * “+” at quantity in the set detail creates a purchase entry — mostly with the
 * market price as an estimate. The UI says so: the toast names the
 * estimated amount and offers “change”, the purchase price list explains “≈”.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in autosaveSet the call meldeNeueExemplare(...) removed and again
 *      always toast('Gespeichert') → red: timeout “toast after +”
 *      (only “Gespeichert” comes)
 *   B  legendEstimated() returns '' → red: “the purchase price list explains ≈”
 *   C  the action omitted in the toast → red: “change opens the purchase prices”
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { holdsSet, catalogSet } = require('./helpers/inventory');

test('quantity "+" reports the new copy with price', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `plus_${process.pid}`,
    bestand: async (db, uid) => {
      await catalogSet(db, '21318-1', { name: 'Baumhaus', year: 2019 });
      await holdsSet(db, uid, '21318-1', 1, { preis: 224.99 });
      await db
        .run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                    VALUES ('21318-1', 'N', 'EUR', 300, 364.32, 400, 364.32, 10, NOW()) ON CONFLICT DO NOTHING`)
        .catch(() => {});
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db, uid, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  await b.auswerten(`location.hash = '#/sammlung/set/21318-1'; true`);
  await bis(
    `document.getElementById('set-modal')?.classList.contains('open') && !!document.getElementById('m-qty')`,
    'Set-Detail',
  );
  await b.auswerten(`document.querySelector('#set-modal [data-click="mQtyInc"]').click(); true`);
  await bis(
    `[...document.querySelectorAll('#toasts .toast')].some(x => /angelegt/.test(x.textContent))`,
    'Toast nach „+“',
  );

  await t.test('toast names the estimated price', async () => {
    const texte = await b.auswerten(`[...document.querySelectorAll('#toasts .toast')].map(x => x.textContent)`);
    assert.ok(
      texte.some(x => /Exemplar mit geschätztem Preis .*364[.,]32.* angelegt/.test(x)),
      JSON.stringify(texte),
    );
    assert.ok(!texte.some(x => /^Gespeichert/.test(x.trim())), `nur „Gespeichert“: ${JSON.stringify(texte)}`);
    const zeile = await db.get(
      `SELECT price_estimated, purchase_price FROM set_acquisitions WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [uid],
    );
    assert.equal(zeile.price_estimated, true, 'Testdaten: der Server schätzt den Preis');
  });
  await t.test('the purchase price list explains ≈', async () => {
    await bis(`/≈/.test(document.getElementById('m-acq-summary')?.textContent || '')`, 'geschätzte Zeile');
    const legende = await b.auswerten(`document.querySelector('#m-acq-summary .acq-legend')?.textContent || ''`);
    assert.match(legende, /≈ geschätzt/);
  });
  await t.test('change opens the purchase prices', async () => {
    const da = await b.auswerten(
      `(() => { const k = [...document.querySelectorAll('#toasts .toast-action')].find(x => x.textContent === 'Ändern'); k?.click(); return !!k; })()`,
    );
    assert.ok(da, 'Knopf „Ändern“ fehlt');
    await bis(`document.getElementById('acq-modal')?.classList.contains('open')`, 'Kaufpreis-Dialog');
  });
});
