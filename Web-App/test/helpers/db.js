'use strict';
/**
 * Die Test-Datenbank eines Tests: Schema, auf Wunsch Migrationen. Ohne
 * Datenbank wird der Test übersprungen — unter REQUIRE_DB=1 (CI) ist das
 * ein Fehler, sonst wäre die Suite dort grün, wo niemand hinschaut.
 *
 *   const db = await dataOrSkip(t, _req);
 *   if (!db) return;
 *
 * @param {import('node:test').TestContext} t
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 * @param {{ migrieren?: boolean }} [o]
 * @returns {Promise<any>} der Zugang für Testdaten (sources testData()), oder null, wenn übersprungen
 */
async function dataOrSkip(t, _req, { migrieren = true } = {}) {
  const db = require('./sources').testData();
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return null;
  }
  if (migrieren) {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  return db;
}

/** Wie dataOrSkip, liefert aber den Zugang des Codes unter Test (helpers/sources
 * testAccess), der als Laufzeitrolle fragt; dieselben Methoden (all, get, run, transaction, pool).
 * @param {import('node:test').TestContext} t @param {(pfad: string) => any} _req
 * @param {{ migrieren?: boolean }} [o] */
async function accessOrSkip(t, _req, o) {
  if (!(await dataOrSkip(t, _req, o))) return null;
  return require('./sources').testAccess();
}

/** Für Tests, die die Erreichbarkeit selbst prüfen. @param {any} t @param {unknown} [e] */
function keineDb(t, e) {
  const grund = e === undefined ? '' : `: ${e instanceof Error ? e.message : e}`;
  missingPrecondition(t, 'Test-DB nicht erreichbar', `die Test-DB ist nicht erreichbar${grund}`);
}

/**
 * Was ohne Datenbank (oder pg_dump, Superuser …) nicht prüfbar ist, wird
 * übersprungen — unter REQUIRE_DB=1 ist es ein Fehler, damit die CI nicht
 * dort grün ist, wo sie nichts geprüft hat.
 * @param {any} t @param {string} grund @param {string} [meldung]
 */
function missingPrecondition(t, grund, meldung = grund) {
  if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber ${meldung}`);
  t.skip(grund);
}

module.exports = { dataOrSkip, accessOrSkip, keineDb, missingPrecondition };
