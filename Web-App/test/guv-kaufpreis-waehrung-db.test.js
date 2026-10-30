/**
 * Die G&V kennt EINEN Kaufpreis: den mengengewichteten aus den Erfassungen mit
 * Preis in der Anzeigewährung. Ein Set, dessen Preis nur in einer anderen
 * Währung erfasst ist, hat keinen bekannten Kaufpreis — es darf nicht als
 * gratis gekauft und damit als reiner Gewinn dastehen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  hasCost wieder wahr, sobald es irgendeine Erfassung gibt (wie der
 *      alte Schnitt mit COALESCE(…, 0)) → rot: „nur in EUR erfasst: Kaufpreis
 *      unbekannt“
 *   B  ein Kaufpreis 0 als fehlend gelesen (`… || null`) → rot: „ein
 *      erfasster Preis 0 zählt“ (purchase_price null statt 0)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, erfasse } = require('./helpers/bestand');

const NAME = `guvwaehrung_${process.pid}`;
const NR = { eur: `9${process.pid}1-1`, gemischt: `9${process.pid}2-1`, null: `9${process.pid}3-1` };

test('G&V: ein Kaufpreis, in der Anzeigewährung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  const nummern = Object.values(NR);
  for (const nr of nummern) {
    await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [nr]);
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
      VALUES ($1, 'N', 'CHF', 120, NOW()) ON CONFLICT DO NOTHING`, [nr]);
  }
  const mitWaehrung = async (nr, menge, preis, waehrung, am) => {
    await erfasse(db, uid, nr, menge, { preis, am });
    await db.run(`UPDATE set_acquisitions SET currency = $1 WHERE id = (SELECT max(id) FROM set_acquisitions WHERE user_id = $2)`, [waehrung, uid]);
  };
  await haeltSet(db, uid, NR.eur, 0);
  await mitWaehrung(NR.eur, 2, 100, 'EUR');
  await haeltSet(db, uid, NR.gemischt, 0);
  await mitWaehrung(NR.gemischt, 1, 80, 'CHF', '2026-01-02');
  await mitWaehrung(NR.gemischt, 3, 999, 'EUR', '2026-01-03');
  await haeltSet(db, uid, NR.null, 0);
  await mitWaehrung(NR.null, 1, 0, 'CHF');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
    await db.pool.end().catch(() => {});
  });

  const { computePnl } = _req('utils/financeCalc.js');
  const pnl = await computePnl(uid, [uid]);
  const zeile = (nr) => pnl.sets.find(s => s.set_number === nr);
  assert.equal(pnl.currency, 'CHF');

  await t.test('nur in EUR erfasst: Kaufpreis unbekannt', () => {
    const z = zeile(NR.eur);
    assert.equal(z.current_price, 120);
    assert.equal(z.purchase_price, null);
    assert.equal(z.pnl_abs, null);
    assert.equal(z.pnl_pct, null);
  });

  await t.test('gemischt: nur die Erfassung in CHF zählt', () => {
    const z = zeile(NR.gemischt);
    assert.equal(z.purchase_price, 80);
    assert.equal(z.pnl_pct, '50.0');
  });

  await t.test('ein erfasster Preis 0 zählt', () => {
    // Bekannt und 0 (Geschenk): der Betrag zählt, eine Prozentzahl gibt es
    // nicht — siehe geschenk-guv-db.test.js.
    const z = zeile(NR.null);
    assert.equal(z.purchase_price, 0);
    assert.equal(z.pnl_abs, '120.00');
    assert.equal(z.pnl_pct, null);
  });

  await t.test('die Summe des Kaufpreises lässt das Unbekannte weg', () => {
    // 80 × 4 (gemischt: die Menge zählt alle Erfassungen) + 0; EUR-Set ohne Betrag.
    assert.equal(Number(pnl.totals.sets_purchase), 80 * 4);
  });
});
