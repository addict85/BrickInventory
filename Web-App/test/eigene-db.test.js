/**
 * Im parallelen Lauf (scripts/test-lauf.js) hat jede Testdatei ihre eigene
 * Datenbank: eine Kopie der Vorlage mit fertigem Schema, benannt nach dem
 * Prozess. Ausserhalb dieses Laufs (npm run test:seriell, Einzelaufruf)
 * gibt es nichts zu prüfen.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in scripts/test-lauf.js den Vorlader (--require) weggelassen → rot:
 *      „die Datei hat ihre eigene Kopie der Vorlage“ (die Basis-Datenbank)
 *   B  in test/helpers/test-db.js `TEMPLATE` weggelassen (leere Datenbank)
 *      → rot: dieselbe Prüfung (relation schema_migrations fehlt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('die Datei hat ihre eigene Kopie der Vorlage', async (t) => {
  const vorlage = process.env.TEST_DB_VORLAGE;
  if (!vorlage) { t.skip('kein paralleler Lauf'); return; }
  const url = new URL(process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest');
  assert.equal(url.pathname, `/${vorlage}_${process.pid}`);
  const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    const r = await c.query(`SELECT to_regclass('public.users') IS NOT NULL AS schema,
                                    (SELECT count(*)::int FROM schema_migrations) AS migrationen`);
    assert.equal(r.rows[0].schema, true, 'die Kopie trägt das Schema der Vorlage');
    assert.ok(r.rows[0].migrationen > 50);
  } finally { await c.end(); }
});
