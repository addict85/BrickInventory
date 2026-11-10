'use strict';
/**
 * Der Preisverlauf zeichnet nur Zustände, zu denen es eine Erfassung gibt.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in manualPriceHistory() wieder beide Zustände fest gezeichnet
 *      (['N', 'U'] statt zustaendeFuerVerlauf) → rot: „nur Gebraucht wird
 *      gezeichnet“
 *   B  history_new auf die gezeichneten Zustände gekürzt → rot: „die
 *      Rohdaten bleiben vollständig“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');

test('ohne Erfassung kein Zustand im Diagramm, die Rohdaten bleiben', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  if (!await dbOderSkip(t, _req)) return;
  const { getMinifigPriceHistory, zustaendeFuerVerlauf } = _req('src/finanzen/priceHistory.js');
  const NAME = `verlauf-${process.pid}`, FN = `fig-vl${process.pid}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number=$1', [FN]);
  };
  await weg();
  t.after(async () => { await weg().catch(() => {}); await db.pool.end().catch(() => {}); });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)
                VALUES ($1,$2,1,3,'U','CHF')`, [uid, FN]);
  await db.run(`INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, recorded_at)
                VALUES ($1,'N','CHF',5,'2026-10-01'), ($1,'U','CHF',4,'2026-10-01'), ($1,'U','CHF',4.5,'2026-10-02')`, [FN]);

  const v = await getMinifigPriceHistory([uid], FN, 'CHF');
  assert.deepEqual(v.chart.values.map(s => s.name), ['U'], 'nur Gebraucht wird gezeichnet');
  assert.equal(v.history_new.length, 1, 'die Rohdaten bleiben vollständig');
  assert.equal(v.history_used.length, 2);

  // Ohne jede Erfassung gilt der Rückfall: beide Zustände.
  assert.deepEqual(zustaendeFuerVerlauf([], ['N', 'U']), ['N', 'U']);
});
