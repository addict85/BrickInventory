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
const { startApp, sleep } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

test('low height: header, bar and banner', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `hoehe_${process.pid}`,
    holding: async (db, uid) => {
      await db.run(`DELETE FROM global_settings WHERE key = 'rebrickable_api_key'`);
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`,
      );
      for (let i = 0; i < 12; i++) await holdsSet(db, uid, `${71000 + i}-1`, 1, { price: 10 + i });
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 640, height: 450, deviceScaleFactor: 1, mobile: false });
  await until(
    `document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`,
    'zwölf Sets',
  );
  await settle();
  const head = `(() => { const r = document.querySelector('header').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })()`;
  const role = async y => {
    await b.evaluate(`window.scrollTo(0, ${y}); true`);
    await sleep(350);
  };

  await t.test('header gives way when scrolling', async () => {
    await role(0);
    assert.deepEqual((await b.evaluate(head))[0], 0);
    await role(300);
    await role(600);
    const lower = await b.evaluate(head);
    assert.ok(lower[1] <= 0, `header still visible: ${lower}`);
    await role(450);
    assert.equal((await b.evaluate(head))[0], 0, 'header does not come back when scrolling up');
  });

  await t.test('bottom bar narrow, names stay', async () => {
    const m =
      await b.evaluate(`(() => { const n = document.querySelector('nav'); const tabs = [...n.querySelectorAll('.ntab')].filter(x => x.getClientRects().length);
      return { height: Math.round(n.getBoundingClientRect().height), names: tabs.map(x => x.textContent.trim()).filter(Boolean).length, tabs: tabs.length,
               target: Math.min(...tabs.map(x => Math.round(x.getBoundingClientRect().height))) }; })()`);
    assert.ok(m.height <= 46, `bar ${m.height} px high`);
    assert.ok(m.target >= 44, `Tippziel ${m.target} px`);
    assert.equal(m.names, m.tabs, 'a tab without a name');
  });

  await t.test('banner stays away, even after a new session', async () => {
    await role(0);
    await until(`!document.getElementById('rb-hint').hidden`, 'Hinweisband');
    await b.evaluate(
      `document.querySelector('#rb-hint [data-click="dismissRbHint"]').click(); sessionStorage.clear(); true`,
    );
    await b.tab('Page.reload');
    await until(
      `(document.getElementById('ubadge')?.textContent || '').length > 0 && document.querySelectorAll('#gallery .scard, #gallery [data-click="openModal"]').length >= 12`,
      'neu geladen',
      300,
    );
    await settle();
    assert.equal(await b.evaluate(`document.getElementById('rb-hint').hidden`), true);
  });
});
