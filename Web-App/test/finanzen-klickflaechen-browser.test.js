/**
 * Am Rechner ist jedes Bedienelement der Finanzansicht mindestens 32 px hoch und breit (wie .delbtn und
 * .acq-loeschen): Sortierknöpfe im Tabellenkopf, Zeilenlinks und das Kontomenü der Kopfleiste. Gemessen im
 * Browser; die Kopfleiste behält ihre Höhe von 58 px.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  .sort-knopf wieder min-height/min-width 24 px → rot: „Bedienelemente der Finanzen“
 *      (Sortierknöpfe 24 px hoch, „Name“ 34 × 24)
 *   B  .zeile-oeffnen wieder min-height 24 px → rot: „Bedienelemente der Finanzen“ (Zeilenlink 24 px)
 *   C  --kopf-hoehe wieder 28 px → rot: „Bedienelemente der Finanzen“ (btn-umenu 28 px)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

const ZU_KLEIN = `[...document.querySelectorAll('a[href], button, [role=button], [role=tab], select, input:not([type=hidden])')]
  .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  .map(e => { const r = e.getBoundingClientRect(); return { k: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).trim().split(/\\s+/).join('.'),
    w: Math.round(r.width), h: Math.round(r.height), t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20) }; })
  .filter(x => x.h < 32 || x.w < 32).map(x => x.k + ' ' + x.w + '×' + x.h + ' „' + x.t + '“')`;

test('Finanzen am Rechner: Bedienelemente mindestens 32 px', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `finklick_${process.pid}`,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10294-1', 2, { preis: 100 });
      await haeltSet(db, uid, '75192-1', 1, { preis: 50 });
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

  await t.test('Bedienelemente der Finanzen', async () => {
    assert.deepEqual(await b.auswerten(ZU_KLEIN), []);
    const m =
      await b.auswerten(`({ sort: document.querySelectorAll('.sort-knopf').length, zeile: document.querySelectorAll('.zeile-oeffnen').length,
      kopf: Math.round(document.querySelector('header').getBoundingClientRect().height) })`);
    assert.ok(m.sort >= 3 && m.zeile >= 1, `zu wenig gemessen: ${JSON.stringify(m)}`);
    assert.equal(m.kopf, 58, 'Kopfleiste ist nicht mehr 58 px hoch');
  });
});
