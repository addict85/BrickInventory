/**
 * Change the purchase price → the tile follows, on BOTH paths.
 *
 * Counter-check (performed): in zustandsAggregat() avg_purchase_price
 * switched to `MAX(purchase_price)` → “opposite direction" turns red
 * (expected 125, got 200). Reset afterwards.
 *
 * TRAP when writing this test: on the first attempt my setup only cleared
 * `sets` between the two runs, not `set_acquisitions`. The
 * entry from the first run stayed, “the newest entry" was
 * therefore another row, and the test reported an error that did not
 * exist. Hence both tables are explicitly cleared here.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('the changed purchase price reaches the tile — web app AND app', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const USER = `spiegel-${process.pid}`;
  const SN = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  // Recreate the starting point fresh every time — including the entries.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await holdsSet(db, uid, SN, 0); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`,
      [uid, SN],
    );
    return (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])).id;
  };
  // What the tile shows: the aggregate from the entries, not a mirrored column.
  const kachel = async () =>
    (await _req('src/sets/read.js').conditionAggregate(require('./helpers/sources').testContext('sets'), [uid], SN))
      .avg_purchase_price;

  try {
    for (const [name, path] of /** @type {[string, (id: number) => string][]} */ ([
      ['Webapp', id => `/api/v2/sets/${SN}/acquisitions/${id}`],
      ['Android', id => `/api/v2/sets/${SN}/acquisitions/${id}`],
    ])) {
      const id = await aufbauen();
      const r = await fetch(`${base}${path(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: 107.0 }),
      });
      assert.equal(r.status, 200, `${name}: die Änderung muss angenommen werden`);

      const erfasst = parseFloat(
        (await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id])).purchase_price,
      );
      assert.equal(erfasst, 107.0, `${name}: die Erfassung muss den neuen Preis tragen`);
      assert.equal(
        await kachel(),
        107.0,
        `${name}: die Kachel zieht den neuen Preis nicht mit — Galerie, Finanzübersicht und ` +
          'Detail-Kachel rechnen aus den Erfassungen und zeigen dann den alten Wert',
      );
    }

    // Opposite direction — and here lies the difference to before.
    const alt = await aufbauen();
    // Another DAY, not merely an hour later: the index
    // idx_set_acq_tag_zustand allows only ONE entry per day and set. With
    // “+1 hour" the test depended on the time of the run — in the evening the
    // second row fell on the same day and the setup failed on the index
    // (noticed in the suite at 23:xx, at noon it would have passed).
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,200.00,'U',1, NOW() + INTERVAL '1 day')`,
      [uid, SN],
    );
    const r2 = await fetch(`${base}/api/v2/sets/${SN}/acquisitions/${alt}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 50.0 }),
    });
    assert.equal(r2.status, 200);
    assert.equal(
      await kachel(),
      125.0,
      'Die Kachel muss den Mittelwert über BEIDE Erfassungen zeigen (50 und 200). ' +
        'Bei 200 zählt weiterhin nur die neueste — die Regel der gelöschten Spalte.',
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
