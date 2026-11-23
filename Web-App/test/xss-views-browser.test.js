/**
 * No markup from data: names, themes, categories and storage locations with an XSS payload
 * rendered through the main views, in real Chrome.
 *
 * Counter-checks (measured):
 *   A  in the collection tile name (collection.js) the name put in ungeprueft()
 *      (before the rework: esc() removed) → red: „Sammlung“ with img[onerror]
 *   B  esc() removed in the storage location field (storage-locations.js) (before the rework) → red:
 *      „Lagerorte“
 *
 * Without Chrome (CHROME_BIN) it is skipped; prerequisite: test DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { holdsSet, holdsPart, holdsMinifig, catalogSet } = require('./helpers/inventory');

const N = `<img src=x onerror="window.__xss=1">"'><svg onload="window.__xss=2">`;
const SPUR = 'XSS-Spur';

/** What would have arisen in the DOM from the payload, and whether it stands as text. */
const CHECK = `(() => {
  const fremd = [...document.querySelectorAll('*')].filter(e =>
      [...e.attributes].some(a => /^on/i.test(a.name)) || (e.tagName === 'IMG' && e.getAttribute('src') === 'x'))
    .map(e => e.outerHTML.slice(0, 100));
  return { fremd, xss: window.__xss ?? null, asText: document.body.innerText.includes('<img src=x onerror')
    || [...document.querySelectorAll('input')].some(i => i.getClientRects().length && i.value.includes('<img src=x onerror')) };
})()`;

test('XSS payloads in the main views stay text', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `xss_${process.pid}`,
    holding: async (db, uid) => {
      const location = (
        await db.get('INSERT INTO storage_locations (user_id, name) VALUES ($1, $2) RETURNING id', [
          uid,
          `${SPUR} ${N}`,
        ])
      ).id;
      for (const [nr, was] of [
        ['99901-1', 'Set'],
        ['99902-1', 'Wunsch'],
      ])
        await catalogSet(db, nr, { name: `${SPUR} ${was} ${N}`, theme: `${SPUR} Thema ${N}`, year: 2020, pieces: 100 });
      await holdsSet(db, uid, '99901-1', 1, { price: 10 });
      await db.run('UPDATE sets SET storage_id = $1 WHERE user_id = $2 AND set_number = $3', [
        location,
        uid,
        '99901-1',
      ]);
      await db.run(
        `INSERT INTO part_custom (user_id, part_number, part_name, category_name) VALUES ($1, 'xss1', $2, $3)`,
        [uid, `${SPUR} Teil ${N}`, `${SPUR} Kategorie ${N}`],
      );
      await holdsPart(db, uid, 'xss1', { storageId: location, price: 1 });
      await db.run(`INSERT INTO minifig_custom (user_id, fig_number, fig_name) VALUES ($1, 'fig-xss1', $2)`, [
        uid,
        `${SPUR} Figur ${N}`,
      ]);
      await holdsMinifig(db, uid, 'fig-xss1', { storageId: location, price: 1 });
      await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '99902-1', 'N')`, [uid]);
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // The start loads settings and prices afterwards; only then is the state settled.
  await settle();

  /** @param {string} name @param {string} hash @param {string} [ready] expression that becomes true when the data is in place */
  const viewName = async (name, hash, ready) => {
    await t.test(name, async () => {
      await b.evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
      await until(
        ready ?? `document.body.innerText.includes(${JSON.stringify(SPUR + ' ')})`,
        `${name}: Daten sichtbar`,
      );
      await settle();
      const r = await b.evaluate(CHECK);
      assert.deepEqual(r.fremd, [], `${name}: markup from data in the DOM`);
      assert.equal(r.xss, null, `${name}: payload executed`);
      assert.ok(r.asText, `${name}: payload is not shown as text — does the test still check anything?`);
    });
  };
  await viewName(
    'Sammlung',
    '#/sammlung',
    `document.querySelector('#gallery')?.innerText.includes(${JSON.stringify(SPUR + ' Set')})`,
  );
  await viewName(
    'Set-Detail',
    '#/sammlung/set/99901-1',
    `document.querySelector('#set-modal.open')?.innerText.includes(${JSON.stringify(SPUR)})`,
  );
  await b.evaluate(`document.querySelector('#set-modal.open [data-click="closeModal"]')?.click(); true`);
  await viewName('Teile', '#/teile');
  await viewName('Figuren', '#/minifiguren');
  await viewName('Merkliste', '#/merkliste');
  await viewName('Finanzen', '#/finanzen');
  // The locations are in input fields here (rename); the name is then a value, not text.
  await viewName(
    'Lagerorte',
    '#/lagerorte',
    `[...document.querySelectorAll('.location-input')].some(i => i.value.includes(${JSON.stringify(SPUR)}))`,
  );
});
