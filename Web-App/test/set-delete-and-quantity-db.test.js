/**
 * Deleting a set: at most ONE prompt (only the account choice in a household; the own set goes at
 * once with undo, js/deletion.js), and everything belonging to it goes along.
 * Changing the set count: parts and minifigures follow.
 *
 * Counter-checks (carried out): prompt in the btn-md handler built in again →
 * substep 1 red. `sets` removed from the trigger list → substep 4 red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { ohneKommentare, testData } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');

test('deleting asks at most once', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/collection.js'), 'utf8'));
  const detail = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/set-detail.js'), 'utf8'));

  // The button in the detail dialog must NOT ask itself.
  const btn = detail.slice(detail.indexOf("G('btn-md').onclick"));
  const handler = btn.slice(0, btn.indexOf('\n};'));
  assert.ok(handler.length > 20, 'Handler von btn-md nicht gefunden');
  assert.doesNotMatch(
    handler,
    /confirmDelete/,
    'Der Löschknopf im Dialog fragt wieder selbst — zusammen mit der Rückfrage ' + 'in delSet() sind das zwei',
  );
  assert.match(handler, /await delSet\(/, 'Er muss über delSet() gehen');

  // …and delSet asks at most once: only the account choice of a household; the own set is restorable.
  const fn = src.slice(
    src.indexOf('async function deletionChoice'),
    src.indexOf('export async function reimportParts'),
  );
  assert.equal((fn.match(/confirmDelete\(/g) || []).length, 0, 'das eigene Set ist wiederherstellbar: keine Rückfrage');
  assert.equal((fn.match(/deleteWithChoice\(/g) || []).length, 1, 'im Haushalt genau eine Rückfrage mit Wahl');
  assert.match(fn, /if \(!foreign\)\s*return '';/, 'ohne fremde Besitzer keine Wahl');
  // And the prompt must be able to cancel without anything being deleted.
  assert.match(fn, /\) return false;/, 'Ein „Abbrechen" muss vor dem DELETE herausspringen');
  // loadGallery() loads the metrics along; the parts and minifigures of the set are gone too.
  assert.match(fn, /loadGallery\(\);\s*emit\('loadParts'\);/, 'Nach dem Löschen müssen Sammlung und Teile nachziehen');
});

test('the quantity multiplication is in all places', () => {
  const h = ohneKommentare(require('./helpers/sources').handlerQuelle());
  // Parts and minifigures of a set count PER COPY times the set count.
  const stellen = (h.match(/quantityFrom\('sm', ?1\)/g) || []).length;
  assert.ok(
    stellen >= 3,
    `nur ${stellen} Stellen multiplizieren mit der Setanzahl — erwartet werden ` +
      'mindestens Teileliste, Kennzahlen und Minifigurenliste',
  );
  // And each of these places needs the JOIN source for it, otherwise the
  // alias `sm` does not exist at all. Without this second assertion the rule would also be
  // green with a multiplication that aborts at runtime.
  assert.ok(
    (h.match(/mengeJoin\(/g) || []).length >= 3,
    'Zu wenige JOIN-Quellen: quantityFrom() liest `sm.menge`, und den Alias hängt ' + 'erst mengeJoin() an',
  );

  // That the summary follows a quantity change is checked by
  // parts-summary.test.js on the running trigger (migration 0052).
});

test('deletion and quantity change against the database', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NUTZER = `dl-${process.pid}`;
  const SN = `76${(process.pid % 900) + 100}-1`;

  const aufraeumen = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'parts', 'minifigs', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                VALUES ($1,'N','EUR',20,20,3)`,
    [SN],
  );
  // Only the inventory row: quantity, price and condition stand in the acquisition
  // below (migration 0032 for price and condition, 0036 for the quantity).
  await holdsSet(db, uid, SN, 0);
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,15,'N',1)`,
    [uid, SN],
  );
  // One copy contains 10 parts and 1 minifigure.
  await holdsPart(db, uid, '3001', { setNumber: SN, menge: 10, colorId: 4 });
  await holdsMinifig(db, uid, 'cty0001', { setNumber: SN, menge: 1 });

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  const H = require('./helpers/sources').handlerModule(_req);
  const setzen = n =>
    fetch(`${base}/api/v1/sets/${SN}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: n }),
    });

  try {
    await t.test('more sets = more parts and minifigures', async () => {
      let st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, 'Vorbedingung');
      assert.equal(st.total_minifigs, 1, 'Vorbedingung');

      await setzen(3);
      st = await H.getStats([uid]);
      assert.equal(st.total_parts, 30, `Teile ${st.total_parts} statt 30`);
      assert.equal(st.total_minifigs, 3, `Minifiguren ${st.total_minifigs} statt 3`);

      // The LISTS too, not only the metrics — they query differently.
      const p = await H.partsQuery([uid], {});
      const teil = (p.parts || []).find(x => x.part_number === '3001');
      assert.equal(Number(teil?.quantity ?? teil?.total_quantity), 30, 'die Teileliste multipliziert nicht mit');
      const m = await H.readMinifigs([uid], {});
      assert.equal(
        Number(m.figs[0]?.total_quantity ?? m.figs[0]?.quantity),
        3,
        'die Minifigurenliste multipliziert nicht mit',
      );
      assert.equal(
        (await H.computeMinifigStats([uid])).total_quantity,
        3,
        'die Minifiguren-Kennzahl multipliziert nicht mit',
      );
    });

    await t.test('fewer sets = fewer parts and minifigures', async () => {
      // The opposite direction: without it the test would also be green if the number
      // only ever grew.
      await setzen(1);
      const st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, `Teile ${st.total_parts} statt 10`);
      assert.equal(st.total_minifigs, 1, `Minifiguren ${st.total_minifigs} statt 1`);
      // The piece count per copy stays at 10 — multiplying happens when
      // reading, not when writing. Since migration 0038 it no longer stands
      // in `parts` (the column does not exist), but ONCE in the catalog of the
      // set. If 30 stood there, somebody would have calculated the set count into it, and …
      const roh = await db.get(`SELECT quantity FROM set_parts_catalog WHERE set_number=$1 AND part_number='3001'`, [
        SN,
      ]);
      assert.equal(Number(roh.quantity), 10, 'die Katalog-Stückzahl muss die JE EXEMPLAR sein');
      // And in `parts` itself there is no quantity any more into which something
      // COULD be calculated. Without this second assertion the
      // test would also be green if the column showed up again.
      const spalte = await db.get(
        `SELECT 1 AS da FROM information_schema.columns
          WHERE table_name='parts' AND column_name='quantity'`,
      );
      assert.equal(spalte, undefined, 'parts.quantity ist zurück — dann gibt es die Stückzahl wieder zweimal');
    });

    await t.test('deleting takes parts, minifigures and purchase prices along', async () => {
      const r = await fetch(`${base}/api/v1/sets/${SN}`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      for (const tab of ['sets', 'parts', 'minifigs', 'set_acquisitions']) {
        const n = (await db.get(`SELECT COUNT(*)::int c FROM ${tab} WHERE set_number=$1`, [SN])).c;
        assert.equal(n, 0, `${tab}: ${n} Zeile(n) übrig`);
      }
      const st = await H.getStats([uid]);
      assert.equal(st.total_sets, 0);
      assert.equal(st.total_parts, 0, 'die Teile des Sets zählen weiter mit');
      assert.equal(st.total_minifigs, 0, 'die Minifiguren des Sets zählen weiter mit');
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
