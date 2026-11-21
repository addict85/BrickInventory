/**
 * CSV import and capturing by hand must leave behind the same. Both run
 * in the account as in operation: the import via the real chain (testServer) and the
 * job, the capturing in the name of the account (asAccount).
 *
 * Counter-check (measured 13.11.2026): in the worker the job without its account
 * (inNamesOfJob with asRequest({})) → red (the import fails).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, asAccount } = require('./helpers/sources');
const { testServer } = require('./helpers/server');
const _req = buildAndRequire();
const { importWorker } = require('./helpers/jobs');
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('import without a price leaves the same as capturing without a price', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  importWorker(t, _req);

  const name = `imp_${process.pid}`;
  const IMPORTED = `imp${String(process.pid).slice(-5)}`;
  const OF_HAND = `hnd${String(process.pid).slice(-5)}`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [name],
  );
  const uid = u.id;

  const { base, schliessen } = testServer(_req, { sitzung: { userId: uid } });

  try {
    // part_name stands in the file so that no Rebrickable lookup is
    // needed. A price does NOT stand in it — that is exactly what this is about.
    const csv = `part_number,part_name,quantity\n${IMPORTED},Testteil,3\n`;
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'teile.csv');
    const antwort = await fetch(`${base}/api/v1/parts/import/csv`, { method: 'POST', body: fd });
    const ergebnis = await antwort.json();
    assert.equal(ergebnis.success, true, `Import fehlgeschlagen: ${JSON.stringify(ergebnis)}`);
    assert.equal(ergebnis.added, 1, `Es wurde nichts angelegt: ${JSON.stringify(ergebnis)}`);

    // The same case by hand, via the same route as the web app.
    const { addManualPart } = _req('src/parts/manualParts.js');
    await asAccount(uid, () =>
      addManualPart(uid, { part_number: OF_HAND, part_name: 'Testteil', color_id: 0, quantity: 3 }),
    );

    // Read from the ACQUISITION
    const spalten = 'unit_price, condition, quantity';
    const imp = await db.get(`SELECT ${spalten} FROM part_acquisitions WHERE user_id=$1 AND part_number=$2`, [
      uid,
      IMPORTED,
    ]);
    const hand = await db.get(`SELECT ${spalten} FROM part_acquisitions WHERE user_id=$1 AND part_number=$2`, [
      uid,
      OF_HAND,
    ]);
    assert.ok(imp, 'Zum importierten Teil wurde keine Erfassung angelegt');
    assert.ok(hand, 'Zum von Hand erfassten Teil wurde keine Erfassung angelegt');

    // The actual error: without a value in the file nothing may stand in the
    // field „Preis/Stk".
    assert.equal(
      imp.unit_price,
      null,
      `Der Import hat ${imp.unit_price} als Preis/Stk eingetragen, obwohl in der ` +
        'Datei keiner stand. Das Feld bedeutet „was der Mensch bezahlt hat" — ' +
        'src/inventory/purchasePriceBackfill.ts liest es genau so.',
    );

    // And the rule behind it: BOTH paths leave behind the same.
    assert.deepEqual(
      { unit_price: imp.unit_price, condition: imp.condition, quantity: imp.quantity },
      { unit_price: hand.unit_price, condition: hand.condition, quantity: hand.quantity },
      'CSV-Import und Erfassen von Hand hinterlassen verschiedene Erfassungen für ' +
        'denselben Fall. Beide rechnen über manualPartPurchase — weichen ' +
        'sie ab, rechnet einer der beiden wieder selbst.',
    );
  } finally {
    await schliessen();
    await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
