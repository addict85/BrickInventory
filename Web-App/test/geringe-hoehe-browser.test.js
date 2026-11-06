/**
 * Geringe Höhe (200 % Zoom = 640 × 450): Der Kopf weicht beim Rollen nach
 * unten und kommt beim Rollen nach oben zurück, die untere Leiste zeigt nur
 * Symbole (Namen bleiben für Vorleser), und das weggeklickte Rebrickable-Band
 * bleibt auch in einer neuen Sitzung weg.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in 10-mobile.js die Klasse kopf-weg nie gesetzt → rot: „Kopf weicht
 *      beim Rollen“
 *   B  die Regel `.ntab .tab-label { position:absolute … }` für geringe Höhe
 *      entfernt → rot: „untere Leiste schmal, Namen bleiben“ (59 px)
 *   C  rbHinweisWeg/rbHinweisZeigen wieder mit sessionStorage → rot: „Band
 *      bleibt weg, auch nach neuer Sitzung“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

test('Geringe Höhe: Kopf, Leiste und Band', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `hoehe_${process.pid}`,
    bestand: async (db, uid) => {
      await db.run(`DELETE FROM global_settings WHERE key = 'rebrickable_api_key'`);
      await db.run(`INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`);
      for (let i = 0; i < 12; i++) await haeltSet(db, uid, `${71000 + i}-1`, 1, { preis: 10 + i });
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, ruhig } = app;
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 640, height: 450, deviceScaleFactor: 1, mobile: false });
  await bis(`document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`, 'zwölf Sets');
  await ruhig();
  const kopf = `(() => { const r = document.querySelector('header').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })()`;
  const rolle = async (y) => { await b.auswerten(`window.scrollTo(0, ${y}); true`); await warte(350); };

  await t.test('Kopf weicht beim Rollen', async () => {
    await rolle(0);
    assert.deepEqual((await b.auswerten(kopf))[0], 0);
    await rolle(300); await rolle(600);
    const unten = await b.auswerten(kopf);
    assert.ok(unten[1] <= 0, `Kopf noch sichtbar: ${unten}`);
    await rolle(450);
    assert.equal((await b.auswerten(kopf))[0], 0, 'Kopf kommt beim Rollen nach oben nicht zurück');
  });

  await t.test('untere Leiste schmal, Namen bleiben', async () => {
    const m = await b.auswerten(`(() => { const n = document.querySelector('nav'); const tabs = [...n.querySelectorAll('.ntab')].filter(x => x.getClientRects().length);
      return { hoehe: Math.round(n.getBoundingClientRect().height), namen: tabs.map(x => x.textContent.trim()).filter(Boolean).length, tabs: tabs.length,
               ziel: Math.min(...tabs.map(x => Math.round(x.getBoundingClientRect().height))) }; })()`);
    assert.ok(m.hoehe <= 46, `Leiste ${m.hoehe} px hoch`);
    assert.ok(m.ziel >= 44, `Tippziel ${m.ziel} px`);
    assert.equal(m.namen, m.tabs, 'ein Reiter ohne Namen');
  });

  await t.test('Band bleibt weg, auch nach neuer Sitzung', async () => {
    await rolle(0);
    await bis(`!document.getElementById('rb-hinweis').hidden`, 'Hinweisband');
    await b.auswerten(`document.querySelector('#rb-hinweis [data-click="rbHinweisWeg"]').click(); sessionStorage.clear(); true`);
    await b.tab('Page.reload');
    await bis(`(document.getElementById('ubadge')?.textContent || '').length > 0 && document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`, 'neu geladen', 300);
    await ruhig();
    assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').hidden`), true);
  });
});
