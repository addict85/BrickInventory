/**
 * On the desktop every control of the finances view is at least 32 px high and wide (like .delbtn and
 * .acq-loeschen): sort buttons in the table header, row links and the account menu of the header. Measured in the
 * browser; the header keeps its height of 58 px.
 *
 * Counter-checks (measured 08.11.2026, each alone):
 *   A  .sort-knopf again min-height/min-width 24 px → red: “controls of the finances”
 *      (sort buttons 24 px high, “Name” 34 × 24)
 *   B  .zeile-oeffnen again min-height 24 px → red: “controls of the finances” (row link 24 px)
 *   C  --kopf-hoehe back to 28 px → red: “controls of the finances” (btn-umenu 28 px)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

const TO_SMALL = `[...document.querySelectorAll('a[href], button, [role=button], [role=tab], select, input:not([type=hidden])')]
  .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  .map(e => { const r = e.getBoundingClientRect(); return { k: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).trim().split(/\\s+/).join('.'),
    w: Math.round(r.width), h: Math.round(r.height), t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20) }; })
  .filter(x => x.h < 32 || x.w < 32).map(x => x.k + ' ' + x.w + '×' + x.h + ' „' + x.t + '“')`;

test('finances on the computer: controls at least 32 px', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `finklick_${process.pid}`,
    bestand: async (db, uid) => {
      await holdsSet(db, uid, '10294-1', 2, { preis: 100 });
      await holdsSet(db, uid, '75192-1', 1, { preis: 50 });
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await b.auswerten(`location.hash = '#/finanzen'; true`);
  await bis(`document.querySelectorAll('[data-fin-art="sets"] tbody tr').length === 2`, 'Sets in der Finanztabelle');
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ruhig();

  await t.test('controls of the finances', async () => {
    assert.deepEqual(await b.auswerten(TO_SMALL), []);
    const m =
      await b.auswerten(`({ sort: document.querySelectorAll('.sort-knopf').length, zeile: document.querySelectorAll('.zeile-oeffnen').length,
      kopf: Math.round(document.querySelector('header').getBoundingClientRect().height) })`);
    assert.ok(m.sort >= 3 && m.zeile >= 1, `zu wenig gemessen: ${JSON.stringify(m)}`);
    assert.equal(m.kopf, 58, 'Kopfleiste ist nicht mehr 58 px hoch');
  });
});
