/**
 * The CSV import of the wishlist writes into the account chosen in the field „Für Konto“
 * — like capturing a single wishlist item next to it. The
 * type check found the error: selectedOwner() was called without a field identifier
 * and always delivered „no account“.
 *
 * Counter-check (measured 05.11.2026, bundle rebuilt): in importWantedCsv
 * again `selectedOwner()` without an identifier → red: „Zielkonto im Upload“
 * (owner_user_id was missing in the form).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

test('wishlist: CSV import into the selected account', { timeout: 120_000 }, async t => {
  const app = await startApp(t, { name: `mkcsv_${process.pid}`, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, db, ruhig } = app;
  // The startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const kid = (await db.get('SELECT id FROM users WHERE username = $1', [`mkcsv_${process.pid}_kind`])).id;
  await b.auswerten(`location.hash = '#/merkliste'; true`);
  // The account field appears as soon as the household members are loaded.
  await bis(
    `[...document.querySelectorAll('#mk-owner option')].some(o => o.value === '${kid}')
    && getComputedStyle(document.getElementById('mk-owner-box')).display !== 'none'`,
    'Konto-Feld',
  );
  // Intercept the upload instead of sending it to the server: what is checked is what the UI sends.
  await b.auswerten(`(() => {
    const echt = window.fetch.bind(window);
    window.__upload = null;
    window.fetch = (url, o) => {
      if (!String(url).includes('/v2/wanted/import/csv')) return echt(url, o);
      window.__upload = Object.fromEntries([...o.body.entries()].filter(([k]) => k !== 'file'));
      return Promise.resolve(new Response(JSON.stringify({ success: true, total: 0, added: 0, skipped: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    const sel = document.getElementById('mk-owner'); sel.value = '${kid}';
    const feld = document.getElementById('mk-csv-file');
    const dt = new DataTransfer(); dt.items.add(new File(['Set;Zustand\\n10294-1;N\\n'], 'liste.csv', { type: 'text/csv' }));
    feld.files = dt.files;
    feld.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  await bis(`window.__upload !== null`, 'Upload gesendet');
  assert.deepEqual(
    await b.auswerten(`window.__upload`),
    { owner_user_id: String(kid) },
    'target account in the upload',
  );
});
