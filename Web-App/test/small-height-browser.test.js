/**
 * Low height (200 % zoom = 640 × 450): the header gives way when scrolling
 * down and comes back when scrolling up, the bottom bar stays
 * narrow (since round 27 the name next to the symbol, below 600 px only symbols),
 * and the dismissed Rebrickable banner stays away even in a new session.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  the class header-remove never set in mobile.js → red: “header gives
 *      way when scrolling”
 *   B  the rule `.ntab .tab-label { position:absolute … }` for low height
 *      removed → red: “bottom bar narrow, names stay” (59 px); since
 *      15.11.2026 the rule for 601–640 px (`flex-direction: row`) → red: same place
 *   C  dismissRbHint/showRbHint again with sessionStorage → red: “banner
 *      stays away, even after a new session”
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

test('low height: header, bar and banner', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `hoehe_${process.pid}`,
    holding: async (db, uid) => {
      await db.run(`DELETE FROM global_settings WHERE key = 'rebrickable_api_key'`);
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`,
      );
      for (let i = 0; i < 12; i++) await holdsSet(db, uid, `${71000 + i}-1`, 1, { preis: 10 + i });
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 640, height: 450, deviceScaleFactor: 1, mobile: false });
  await bis(
    `document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`,
    'zwölf Sets',
  );
  await ruhig();
  const kopf = `(() => { const r = document.querySelector('header').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })()`;
  const rolle = async y => {
    await b.auswerten(`window.scrollTo(0, ${y}); true`);
    await warte(350);
  };

  await t.test('header gives way when scrolling', async () => {
    await rolle(0);
    assert.deepEqual((await b.auswerten(kopf))[0], 0);
    await rolle(300);
    await rolle(600);
    const unten = await b.auswerten(kopf);
    assert.ok(unten[1] <= 0, `Kopf noch sichtbar: ${unten}`);
    await rolle(450);
    assert.equal((await b.auswerten(kopf))[0], 0, 'Kopf kommt beim Rollen nach oben nicht zurück');
  });

  await t.test('bottom bar narrow, names stay', async () => {
    const m =
      await b.auswerten(`(() => { const n = document.querySelector('nav'); const tabs = [...n.querySelectorAll('.ntab')].filter(x => x.getClientRects().length);
      return { hoehe: Math.round(n.getBoundingClientRect().height), namen: tabs.map(x => x.textContent.trim()).filter(Boolean).length, tabs: tabs.length,
               ziel: Math.min(...tabs.map(x => Math.round(x.getBoundingClientRect().height))) }; })()`);
    assert.ok(m.hoehe <= 46, `Leiste ${m.hoehe} px hoch`);
    assert.ok(m.ziel >= 44, `Tippziel ${m.ziel} px`);
    assert.equal(m.namen, m.tabs, 'ein Reiter ohne Namen');
  });

  await t.test('banner stays away, even after a new session', async () => {
    await rolle(0);
    await bis(`!document.getElementById('rb-hint').hidden`, 'Hinweisband');
    await b.auswerten(
      `document.querySelector('#rb-hint [data-click="dismissRbHint"]').click(); sessionStorage.clear(); true`,
    );
    await b.tab('Page.reload');
    await bis(
      `(document.getElementById('ubadge')?.textContent || '').length > 0 && document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`,
      'neu geladen',
      300,
    );
    await ruhig();
    assert.equal(await b.auswerten(`document.getElementById('rb-hint').hidden`), true);
  });
});
