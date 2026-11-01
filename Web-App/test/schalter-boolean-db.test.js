/**
 * Ja/Nein-Spalten sind BOOLEAN — geprüft an der echten Datenbank
 * (information_schema und pg_constraint), nicht an den Migrationen.
 * Gesucht wird zweifach: nach Spaltennamen, die eine Flagge sind
 * (is_…, has_…, must_…, never_…, …_verified), und nach Schranken, die eine
 * Zahl auf 0 und 1 beschränken. Beide Listen müssen leer sein.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   a) in db/migrations/0085-schalter-als-boolean.sql den Block für
 *      catalog_cache.is_gear entfernt → rot („catalog_cache.is_gear: integer“).
 *   b) dort die Schranken von users nicht entfernt und is_admin nicht umgestellt
 *      → rot (Spalte und Schranke users_is_admin_schalter).
 * Der Teil „die Suche greift“ legt selbst eine 0/1-Spalte an und muss sie finden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

const FLAGGE = String.raw`^(is|has|must|never)_|_verified$`;

/** Flaggen-Spalten, die nicht BOOLEAN sind, und Schranken auf 0/1 — im Schema `schema`. */
async function zahlenFlaggen(db, schema) {
  const spalten = await db.all(
    `SELECT table_name || '.' || column_name || ': ' || data_type AS z FROM information_schema.columns
      WHERE table_schema = $1 AND column_name ~ $2 AND data_type <> 'boolean'
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE')
      ORDER BY 1`, [schema, FLAGGE]);
  const schranken = await db.all(
    `SELECT conname AS z FROM pg_constraint
      WHERE connamespace = $1::regnamespace AND contype = 'c'
        AND pg_get_constraintdef(oid) ~ 'ARRAY\\[0, 1\\]|IN \\(0, ?1\\)'
      ORDER BY 1`, [schema]);
  return [...spalten, ...schranken].map(r => r.z);
}

test('keine Ja/Nein-Spalte trägt 0/1', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  try {
    await t.test('die Suche greift', async () => {
      const booleans = await db.get(`SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~ $1 AND data_type = 'boolean'`, [FLAGGE]);
      assert.ok(booleans.n >= 10, `nur ${booleans.n} Flaggen-Spalten gefunden — greift das Muster noch?`);
      await db.exec(`DROP SCHEMA IF EXISTS schalter_probe CASCADE; CREATE SCHEMA schalter_probe;
        CREATE TABLE schalter_probe.p (is_probe integer NOT NULL DEFAULT 0, CONSTRAINT p_probe_null_eins CHECK (is_probe IN (0, 1)))`);
      try {
        assert.deepEqual(await zahlenFlaggen(db, 'schalter_probe'), ['p.is_probe: integer', 'p_probe_null_eins']);
      } finally {
        await db.exec('DROP SCHEMA schalter_probe CASCADE');
      }
    });

    await t.test('im Schema der Anwendung ist jede davon BOOLEAN', async () => {
      assert.deepEqual(await zahlenFlaggen(db, 'public'), []);
    });
  } finally {
    await db.pool.end();
  }
});
