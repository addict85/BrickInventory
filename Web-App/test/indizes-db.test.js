/**
 * Kein Index ist der Anfang eines anderen derselben Tabelle, und jeder
 * Fremdschlüssel hat einen Index, der mit seinen Spalten beginnt — geprüft am
 * Katalog der migrierten Datenbank (Migration 0068).
 *
 * Ein Präfix-Doppel bedient keine Suche, die der längere Index nicht auch
 * bedient, kostet aber bei jedem Schreiben. Ein Fremdschlüssel ohne Index
 * lässt jedes Löschen in der Elterntabelle die Kindtabelle durchsuchen
 * (minifigs_set_fk fehlte).
 *
 * Gegenproben (am 29.10.2026 gemessen, je auf frischer Datenbank):
 *   A  `DROP INDEX IF EXISTS idx_sets_user` aus 0068 entfernt → rot: „kein
 *      Index ist der Anfang eines anderen“ (sets: idx_sets_user)
 *   B  `CREATE INDEX idx_minifigs_set` aus 0068 entfernt → rot: „jeder
 *      Fremdschlüssel hat einen Index“ (minifigs_set_fk)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

/** Spalten und Operatorklassen als normale Arrays (int2vector beginnt bei 0). */
const INDIZES = `
  SELECT i.indexrelid, i.indrelid, c.relname AS name, t.relname AS tabelle,
         i.indisunique AS eindeutig, i.indpred IS NOT NULL AS teil, i.indexprs IS NOT NULL AS ausdruck,
         pg_get_expr(i.indpred, i.indrelid) AS bedingung,
         (ARRAY(SELECT unnest(i.indkey::int2[])))[1:i.indnkeyatts] AS spalten,
         ARRAY(SELECT unnest(i.indclass::oid[])) AS klassen, am.amname AS art
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
    JOIN pg_am am ON am.oid = c.relam`;

test('Indizes', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  try {
    await t.test('kein Index ist der Anfang eines anderen', async () => {
      const alle = await db.all(`WITH ix AS (${INDIZES}) SELECT COUNT(*)::int AS n FROM ix`);
      assert.ok(alle[0].n > 100, `nur ${alle[0].n} Indizes gefunden — greift die Abfrage?`);
      const doppel = await db.all(`
        WITH ix AS (${INDIZES})
        SELECT a.tabelle || ': ' || a.name || ' (Anfang von ' || b.name || ')' AS d
          FROM ix a JOIN ix b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
         WHERE NOT a.eindeutig AND NOT a.teil AND NOT a.ausdruck AND NOT b.teil
           AND a.art = 'btree' AND b.art = 'btree'
           AND array_length(a.spalten, 1) <= array_length(b.spalten, 1)
           AND a.spalten = b.spalten[1:array_length(a.spalten, 1)]
           AND a.klassen[1:array_length(a.spalten, 1)] = b.klassen[1:array_length(a.spalten, 1)]
         ORDER BY 1`);
      assert.deepEqual(doppel.map(z => z.d), []);
    });

    await t.test('jeder Fremdschlüssel hat einen Index', async () => {
      const ohne = await db.all(`
        WITH ix AS (${INDIZES})
        SELECT c.conname || ' (' || c.conrelid::regclass || ')' AS d
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
           AND NOT EXISTS (SELECT 1 FROM ix WHERE ix.indrelid = c.conrelid
                             AND ix.spalten[1:array_length(c.conkey, 1)] = c.conkey::int2[]
                             -- Ein Teilindex hilft nur, wenn seine Bedingung aus dem Schlüssel folgt.
                             AND (NOT ix.teil OR ix.bedingung = '(' || (SELECT attname FROM pg_attribute
                                    WHERE attrelid = c.conrelid AND attnum = c.conkey[array_upper(c.conkey, 1)]) || ' IS NOT NULL)'))
         ORDER BY 1`);
      assert.deepEqual(ohne.map(z => z.d), []);
    });
  } finally {
    await db.pool.end().catch(() => {});
  }
});
