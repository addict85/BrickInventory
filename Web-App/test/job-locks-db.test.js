/**
 * Prozessübergreifende Job-Sperren gegen eine ECHTE Datenbank.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

/** Sperre auf einer eigenen Verbindung halten — spielt den zweiten Worker. */
async function haltenAls(fremder, ns) {
  const client = await db.pool.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [ns]);
  assert.equal(rows[0].ok, true, `${fremder}: Sperre ${ns} war schon belegt`);
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1, 0)', [ns]).catch(() => {});
    client.release();
  };
}

const REDL_LOCK  = 57;

test('Job-Sperren wirken über Prozessgrenzen', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }

  await t.test('der Bilder-Nachlauf startet nicht zweimal', async () => {
    const enrich = _req('src/katalog/teileAnreicherung.js');
    // Gegenprobe: ohne fremde Sperre läuft er durch (leerer Katalog → 0 fehlende).
    const frei = await enrich.redownloadMissingImages();
    assert.equal(frei.alreadyRunning, undefined,
      'Lauf wurde ohne fremde Sperre abgewiesen');

    const freigeben = await haltenAls('zweiter Worker', REDL_LOCK);
    try {
      const gesperrt = await enrich.redownloadMissingImages();
      assert.equal(gesperrt.alreadyRunning, true,
        'zweiter Lauf gestartet — dieselben Bilder würden doppelt vom CDN geladen');
    } finally { await freigeben(); }
  });

  await db.pool.end().catch(() => {});
});
