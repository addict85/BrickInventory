/**
 * One header for sets, parts and minifigures, in the same place, and from the
 * first visible frame nothing jumps in it anymore (banner, account selection,
 * key figures, filter fields). In the household, with storage location, without key and
 * with delayed responses, so that everything loaded later occurs.
 *
 * Counter-checks (measured on 13.11.2026):
 *   A  in showApp() removeStartupScaffold() again immediately instead of after banner and
 *      account filter → red: all three “loading without a jump” (the header slips
 *      45 px lower as soon as the banner comes)
 *   B  `.bstat .bstat-s:empty::before` without content → red: “sets: loading without
 *      a jump” (key figures 77 → 95 px high as soon as “4 different” comes)
 *   C  path and subtitle of the minifigures removed → red: “same header”
 *      (title at y 184 instead of 205)
 *   D  `#gtheme` and `#parts-color` without fixed width → red: “sets” and
 *      “parts: loading without a jump” (the search field shrinks as soon as the
 *      options come)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

/** Records the position of the header parts in every frame as soon as the startup skeleton is gone. */
const RECORD = `(() => {
  window.__kopf = [];
  const teile = ['.breadcrumb', 'h1', '.ptitle-sub', '.collection-choice', '.brick-stats', '.capture-bar', '.search-field'];
  const bild = () => {
    const tab = document.querySelector('.tab.active');
    const app = document.getElementById('app');
    if (tab && app && app.style.display === 'block' && !document.getElementById('start-skeleton')) {
      const situation = teile.map(s => {
        const e = tab.querySelector(s);
        if (!e || !e.getClientRects().length) return s + ': –';
        const b = e.getBoundingClientRect();
        return s + ': ' + [b.x, b.y, b.width, b.height].map(Math.round).join('/');
      });
      const z = situation.join(' | ');
      if (window.__kopf.at(-1) !== z) window.__kopf.push(z);
    }
    requestAnimationFrame(bild);
  };
  requestAnimationFrame(bild);
})()`;

test('header of the collection: the same and without a jump', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `kopf_${process.pid}`,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal')`, [uid]);
    },
    intercept: [
      { muster: '*household-members*', contains: '/household-members', delay: 600 },
      { muster: '*settings/raw*', contains: '/settings/raw', delay: 300 },
      { muster: '*/v2/stats*', contains: '/v2/stats', delay: 900 },
      // List and parts filter only come after the skeleton: then the select fields visibly fill.
      { muster: '*/v2/sets?*', contains: '/v2/sets?', delay: 1200 },
      { muster: '*/v2/parts/colors*', contains: '/v2/parts/colors', delay: 1200 },
    ],
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig(15_000);
  await b.tab('Page.addScriptToEvaluateOnNewDocument', { source: RECORD });

  /** @type {Record<string, string>} */
  const endState = {};
  for (const [name, hash, fertig] of [
    [
      'Sets',
      '#/sammlung',
      `!!document.querySelector('#gallery .sc') && document.getElementById('bstat-sets').textContent !== '—'`,
    ],
    ['Teile', '#/teile', `document.getElementById('ps-total').textContent !== '—'`],
    ['Minifiguren', '#/minifiguren', `document.getElementById('mf-total').textContent !== '—'`],
  ]) {
    await t.test(`${name}: loading without a jump`, async () => {
      await b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
      await b.tab('Page.reload');
      await bis(`!!window.__kopf && ${fertig}`, `${name} loaded`, 300);
      await ruhig(4000);
      const bilder = await b.auswerten('window.__kopf');
      assert.ok(bilder.length >= 1, 'no frame recorded');
      assert.deepEqual(bilder, [bilder.at(-1)], 'the header changed after the first frame');
      assert.equal(await b.auswerten(`document.getElementById('rb-hint').hidden`), false, 'Band is missing');
      endState[name] = bilder.at(-1);
    });
  }

  await t.test('same header in all three views', () => {
    // Up to the add bar everything matches; widths of path and subtitle depend on the text.
    const kopf = z =>
      z
        .split(' | ')
        .slice(0, 6)
        .map(s => s.replace(/^(\.breadcrumb|\.ptitle-sub|h1): (\d+)\/(\d+)\/\d+/, '$1: $2/$3'));
    assert.deepEqual(kopf(endState.Teile), kopf(endState.Sets));
    assert.deepEqual(kopf(endState.Minifiguren), kopf(endState.Sets));
  });
});
