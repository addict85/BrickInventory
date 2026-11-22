/**
 * npm test separates the roles as in production (helpers/own-db.js): the app asks as the
 * runtime role (no superuser, no BYPASSRLS, no table belongs to it), the
 * system frame as the system role, the owner role writes test data. Only this way does an
 * ordinary test show a missing system frame. Files that still bypass this
 * (superuser marker in the header, helpers/system-frame.js loaded) become fewer, never more.
 *
 * Counter-checks (measured on 13.11.2026, each on its own):
 *   A  in helpers/own-db.js TEST_DATABASE_URL always to the superuser → red:
 *      „die App fragt als Laufzeitrolle“
 *   B  the marker `@superuser` put into this file → red (limit and role)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { asSuperuser, inSystemFrame } = require('./helpers/roles');
const { createDb, dbConfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));

const ROLE = `SELECT r.rolsuper AS super, r.rolbypassrls AS bypass,
                      pg_has_role(current_user, c.relowner, 'USAGE') AS eigentum
                 FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.sets'::regclass`;

test('the suite separates the roles as in production, exceptions become fewer', async t => {
  const zugang = await accessOrSkip(t, _req);
  if (!zugang) return;
  t.after(() => zugang.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_VORLAGE) return missingPrecondition(t, 'nur npm test trennt Rollen');

  assert.deepEqual(
    (await zugang.pool.query(ROLE)).rows[0],
    { super: false, bypass: false, eigentum: false },
    'die App fragt als Laufzeitrolle',
  );
  assert.deepEqual(
    (await zugang.systemPool.query(ROLE)).rows[0],
    { super: false, bypass: true, eigentum: false },
    'der Systemrahmen fragt als Systemrolle',
  );
  const k = dbConfigFromEnvironment();
  const eigen = createDb({ ...k, verbindung: { connectionString: process.env.TEST_DB_EIGEN_URL }, system: null });
  try {
    assert.deepEqual(
      (await eigen.pool.query(ROLE)).rows[0],
      { super: false, bypass: false, eigentum: true },
      'Testdaten schreibt die Eigentümerin',
    );
  } finally {
    await eigen.pool.end();
  }

  const LIMIT = { superuser: 21, systemFrame: 129 };
  const dateien = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js'));
  const source = (/** @type {string} */ n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
  /** @type {Record<string, number>} */
  const ist = {
    superuser: dateien.filter(n => asSuperuser(source(n))).length,
    systemFrame: dateien.filter(n => !asSuperuser(source(n)) && inSystemFrame(source(n))).length,
  };
  assert.ok(dateien.length > 500, `nur ${dateien.length} Testdateien — greift die Suche noch?`);
  for (const [kind, s] of Object.entries(LIMIT)) {
    assert.ok((ist[kind] ?? 0) <= s, `${ist[kind]} Testdateien mit ${kind}, erlaubt sind ${s}`);
    if ((ist[kind] ?? 0) < s) console.log(`  ℹ Testdateien mit ${kind}: ${ist[kind]} (Schranke ${s}) — nachziehen`);
  }
});
