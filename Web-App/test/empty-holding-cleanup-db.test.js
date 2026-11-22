/**
 * If the last purchase price is deleted, NOTHING remains.
 *
 * Counter-check (performed): cleanupWhenEmpty removed from the set configuration
 * → three of the four substeps turn red (gallery, statistics,
 * valuation).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsMinifig, holdsSet, holdsPart, haltRow, quantityOf } = require('./helpers/inventory');

test('last purchase price deleted → the entry disappears entirely', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NUTZER = `lk-${process.pid}`;
  const ROUTE = `80${(process.pid % 900) + 100}-1`; // deletion happens here
  const BLEIBT = `80${(process.pid % 900) + 101}-1`; // control group

  const aufraeumen = async () => {
    for (const sn of [ROUTE, BLEIBT])
      for (const tab of ['sets', 'set_acquisitions', 'parts', 'minifigs', 'price_cache'])
        await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [sn]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await db.run(
    `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
    [uid],
  );
  await aufraeumen();

  for (const sn of [ROUTE, BLEIBT]) {
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'N','CHF',20,20,3)`,
      [sn],
    );
    await holdsSet(db, uid, sn, 0); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,15,'N',1)`,
      [uid, sn],
    );
    // Derived parts and minifigures — they hang on the set and must
    // go along. If they stay, they keep appearing in the parts list and
    // finance sums without there being a set for them.
    await holdsPart(db, uid, '3001', { setNumber: sn, quantity: 10, colorId: 4 });
    await holdsMinifig(db, uid, 'cty0001', { setNumber: sn, quantity: 1 });
  }

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  const H = require('./helpers/sources').handlerModule(_req);
  const FC = _req('src/finances/financeCalc.js');

  try {
    const liste = await (await fetch(`${base}/api/v2/sets/${ROUTE}/acquisitions`)).json();
    const acqId = liste.acquisitions?.[0]?.id;
    assert.ok(acqId, 'Vorbedingung: es gibt eine Erfassung');
    const r = await fetch(`${base}/api/v2/sets/${ROUTE}/acquisitions/${acqId}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).new_quantity, 0);

    await t.test('the gallery no longer shows it', async () => {
      const g = await H.readSets([uid], {});
      const nummern = g.sets.map(s => s.set_number);
      assert.deepEqual(
        nummern,
        [BLEIBT],
        `Galerie zeigt noch: ${nummern.join(', ')} — ein Set mit Menge 0 ist ein Geistereintrag`,
      );
      assert.equal(g.total, 1, 'die Gesamtzahl zählt es noch mit');
    });

    await t.test('the statistics no longer count it', async () => {
      const st = await H.getStats([uid]);
      assert.equal(st.total_sets, 1, `Sets=${st.total_sets} statt 1`);
      assert.equal(st.total_quantity, 1);
      // The set's parts and minifigures must have gone along — otherwise they would stand
      // without a set in the parts list and sums.
      assert.equal(st.total_parts, 10, `Teile=${st.total_parts} — die des gelöschten Sets zählen mit`);
      assert.equal(st.total_minifigs, 1, `Minifiguren=${st.total_minifigs} — dito`);
    });

    await t.test('the valuation no longer includes it', async () => {
      // The actual damage: `quantity || 1` made a 1 out of 0, the
      // deleted set contributed 20 CHF to the portfolio.
      const val = await FC.valueSets(uid, [uid]);
      const nummern = (val.sets || []).map(s => s.set_number);
      assert.deepEqual(nummern, [BLEIBT], `Bewertung enthält noch: ${nummern.join(', ')}`);
      assert.equal(
        parseFloat(val.totals.avg),
        20,
        `Summe ${val.totals.avg} statt 20.00 — ein Set ohne Bestand wird mitbewertet`,
      );
    });

    await t.test('no row remains in the database', async () => {
      for (const [tab, spalte] of [
        ['sets', 'set_number'],
        ['parts', 'set_number'],
        ['minifigs', 'set_number'],
        ['set_acquisitions', 'set_number'],
      ]) {
        const n = (await db.get(`SELECT COUNT(*)::int c FROM ${tab} WHERE ${spalte}=$1`, [ROUTE])).c;
        assert.equal(n, 0, `${tab}: ${n} Zeile(n) übrig`);
      }
    });

    await t.test('the control group is untouched', async () => {
      // Without this opposite direction the test would also be green if deleting
      // an entry took the whole stock along.
      // Two questions, two tables (migration 0036): does the stock row still
      // stand, and how many copies do the entries say? Previously …
      assert.ok(await haltRow(db, uid, BLEIBT), 'das andere Set wurde mitgelöscht');
      assert.equal(await quantityOf(db, uid, BLEIBT), 1, 'das andere Set hat seine Erfassung verloren');
      assert.equal((await db.get(`SELECT COUNT(*)::int c FROM parts WHERE set_number=$1`, [BLEIBT])).c, 1);
    });

    await t.test('deleting one of several acquisitions changes nothing about the inventory', async () => {
      // The rule only applies when no entry is left.
      // Another DAY: per account, set and day exactly one entry is allowed
      // (idx_set_acq_tag_zustand) — the database rejects two on the same day.
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                    VALUES ($1,$2,9,'U',2, NOW() - INTERVAL '1 day')`,
        [uid, BLEIBT],
      );
      const l = await (await fetch(`${base}/api/v2/sets/${BLEIBT}/acquisitions`)).json();
      const erste = l.acquisitions[0].id;
      await fetch(`${base}/api/v2/sets/${BLEIBT}/acquisitions/${erste}`, { method: 'DELETE' });
      assert.ok(await haltRow(db, uid, BLEIBT), 'das Set wurde gelöscht, obwohl noch eine Erfassung übrig ist');
      const quantity = await quantityOf(db, uid, BLEIBT);
      assert.ok(quantity > 0, `Menge ${quantity}`);
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
