'use strict';
/**
 * Die Test-Datenbank eines Tests: Schema, auf Wunsch Migrationen. Ohne
 * Datenbank wird der Test übersprungen — unter REQUIRE_DB=1 (CI) ist das
 * ein Fehler, sonst wäre die Suite dort grün, wo niemand hinschaut.
 *
 *   if (!await dbOderSkip(t, _req)) return;
 *
 * @param {import('node:test').TestContext} t
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 * @param {{ migrieren?: boolean }} [o]
 * @returns {Promise<any>} das db-Modul, oder null, wenn übersprungen
 */
async function dbOderSkip(t, _req, { migrieren = true } = {}) {
  const db = _req('db/database.js');
  try { await db.initSchema(); }
  catch (e) {
    keineDb(t, e);
    return null;
  }
  if (migrieren) {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }
  return db;
}

/** Für Tests, die die Erreichbarkeit selbst prüfen. @param {any} t @param {unknown} [e] */
function keineDb(t, e) {
  const grund = e === undefined ? '' : `: ${e instanceof Error ? e.message : e}`;
  fehltVoraussetzung(t, 'Test-DB nicht erreichbar', `die Test-DB ist nicht erreichbar${grund}`);
}

/**
 * Was ohne Datenbank (oder pg_dump, Superuser …) nicht prüfbar ist, wird
 * übersprungen — unter REQUIRE_DB=1 ist es ein Fehler, damit die CI nicht
 * dort grün ist, wo sie nichts geprüft hat.
 * @param {any} t @param {string} grund @param {string} [meldung]
 */
function fehltVoraussetzung(t, grund, meldung = grund) {
  if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber ${meldung}`);
  t.skip(grund);
}

module.exports = { dbOderSkip, keineDb, fehltVoraussetzung };
