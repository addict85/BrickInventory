/**
 * Wartet der Start auf den Prozess, der gerade migriert, bricht er nicht am
 * statement_timeout der Pool-Verbindung ab (57014), sondern wartet, bis die
 * Sperre frei ist.
 *
 * Gegenprobe (am 07.11.2026 gemessen): `SET statement_timeout = 0` vor dem
 * pg_advisory_lock in initSchemaOnce() entfernt → rot: „wartet länger als
 * statement_timeout“ (Abbruch mit 57014 nach rund einer Sekunde).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.PG_STMT_MS = '1000';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const db = _req('db/database.js');
const { LOCKS } = _req('src/infra/lockNamespaces.js');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

test('Schema-Sperre: Warten dauert länger als statement_timeout', async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const fremder = new Client({ connectionString: process.env.DATABASE_URL });
  await fremder.connect();
  t.after(async () => {
    await fremder.query('SELECT pg_advisory_unlock_all()').catch(() => {});
    await fremder.end().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('wartet länger als statement_timeout', async () => {
    await fremder.query('SELECT pg_advisory_lock($1)', [LOCKS.SCHEMA_INIT]);
    /** @type {any} */
    let ergebnis = 'offen';
    const start = db.initSchemaOnce().then(
      () => {
        ergebnis = 'fertig';
      },
      e => {
        ergebnis = e;
      },
    );
    // Der Wartende steht seit mehr als dem doppelten statement_timeout an der Sperre.
    const wartet = await bis(
      async () =>
        (
          await fremder.query(
            `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'
             AND query LIKE 'SELECT pg_advisory_lock(%' AND now() - query_start > interval '2 seconds'`,
          )
        ).rowCount > 0,
      8000,
    );
    assert.ok(wartet, `abgebrochen: ${ergebnis?.code ?? ergebnis} ${ergebnis?.message ?? ''}`);
    await fremder.query('SELECT pg_advisory_unlock($1)', [LOCKS.SCHEMA_INIT]);
    await start;
    assert.equal(ergebnis, 'fertig', String(ergebnis?.message ?? ergebnis));
  });

  await t.test('danach gilt das statement_timeout der Pool-Verbindung wieder', async () => {
    const c = await db.pool.connect();
    try {
      const { rows } = await c.query('SHOW statement_timeout');
      assert.equal(rows[0].statement_timeout, '1s');
    } finally {
      c.release();
    }
  });
});
