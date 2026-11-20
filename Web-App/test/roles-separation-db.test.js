/**
 * npm test trennt die Rollen wie im Betrieb (helpers/own-db.js): Die App fragt als
 * Laufzeitrolle (kein Superuser, kein BYPASSRLS, keine Tabelle gehört ihr), der
 * Systemrahmen als Systemrolle, Testdaten schreibt die Eigentümerin. Nur so zeigt ein
 * gewöhnlicher Test einen fehlenden Systemrahmen. Dateien, die das noch umgehen
 * (Marke superuser im Kopf, helpers/system-frame.js geladen), werden weniger, nie mehr.
 *
 * Gegenproben (am 13.11.2026 gemessen, je einzeln):
 *   A  in helpers/own-db.js TEST_DATABASE_URL immer auf den Superuser → rot:
 *      „die App fragt als Laufzeitrolle“
 *   B  die Marke `@superuser` in diese Datei gesetzt → rot (Schranke und Rolle)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { asSuperuser, imSystemrahmen } = require('./helpers/roles');
const { createDb, dbKonfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));

const ROLLE = `SELECT r.rolsuper AS super, r.rolbypassrls AS bypass,
                      pg_has_role(current_user, c.relowner, 'USAGE') AS eigentum
                 FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.sets'::regclass`;

test('the suite separates the roles as in production, exceptions become fewer', async t => {
  const zugang = await accessOrSkip(t, _req);
  if (!zugang) return;
  t.after(() => zugang.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_VORLAGE) return missingPrecondition(t, 'nur npm test trennt Rollen');

  assert.deepEqual(
    (await zugang.pool.query(ROLLE)).rows[0],
    { super: false, bypass: false, eigentum: false },
    'die App fragt als Laufzeitrolle',
  );
  assert.deepEqual(
    (await zugang.systemPool.query(ROLLE)).rows[0],
    { super: false, bypass: true, eigentum: false },
    'der Systemrahmen fragt als Systemrolle',
  );
  const k = dbKonfigFromEnvironment();
  const eigen = createDb({ ...k, verbindung: { connectionString: process.env.TEST_DB_EIGEN_URL }, system: null });
  try {
    assert.deepEqual(
      (await eigen.pool.query(ROLLE)).rows[0],
      { super: false, bypass: false, eigentum: true },
      'Testdaten schreibt die Eigentümerin',
    );
  } finally {
    await eigen.pool.end();
  }

  const LIMIT = { superuser: 21, systemrahmen: 129 };
  const dateien = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js'));
  const quelle = (/** @type {string} */ n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
  /** @type {Record<string, number>} */
  const ist = {
    superuser: dateien.filter(n => asSuperuser(quelle(n))).length,
    systemrahmen: dateien.filter(n => !asSuperuser(quelle(n)) && imSystemrahmen(quelle(n))).length,
  };
  assert.ok(dateien.length > 500, `nur ${dateien.length} Testdateien — greift die Suche noch?`);
  for (const [art, s] of Object.entries(LIMIT)) {
    assert.ok((ist[art] ?? 0) <= s, `${ist[art]} Testdateien mit ${art}, erlaubt sind ${s}`);
    if ((ist[art] ?? 0) < s) console.log(`  ℹ Testdateien mit ${art}: ${ist[art]} (Schranke ${s}) — nachziehen`);
  }
});
