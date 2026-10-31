/**
 * Auf einer bestehenden Datenbank lässt sich ein Konto mit Teilen löschen.
 *
 * Die Zähler-Trigger legt nur der Erststart an; Migration 0050 bringt die
 * Fassung mit Benutzerfilter auf bestehende Datenbanken. Der Test setzt die
 * alte Fassung ein, lässt 0050 erneut laufen und löscht dann ein Konto.
 *
 * Gegenprobe (am 28.10.2026 gemessen): den Inhalt von
 * 0050-teilezaehler-nur-bestehende-konten.sql durch `SELECT 1;` ersetzt →
 * rot: „das Löschen eines Kontos mit Teilen gelingt" (23503 auf
 * parts_version_user_user_id_fkey).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltTeil } = require('./helpers/bestand');

const ALT = (name, quelle) => `
  CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
  BEGIN
    INSERT INTO parts_version_user (user_id, v)
    SELECT DISTINCT user_id, 1 FROM ${quelle} WHERE user_id IS NOT NULL
    ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
    RETURN NULL;
  END $$ LANGUAGE plpgsql`;

test('Teilezähler und Kontolöschung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const migriere = async () => {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  };
  await migriere();

  // Der Stand einer Datenbank vor diesem Update.
  await db.run(ALT('bump_parts_version_ins', 'neu'));
  await db.run(ALT('bump_parts_version_del', 'alt'));
  await db.run(`DELETE FROM schema_migrations WHERE name = '0050-teilezaehler-nur-bestehende-konten.sql'`);
  await migriere();

  const NAME = `zaehler-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await haeltTeil(db, uid, '3001', { menge: 2, colorId: 4 });

  try {
    await t.test('das Löschen eines Kontos mit Teilen gelingt', async () => {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
      assert.equal(await db.get('SELECT 1 FROM parts WHERE user_id=$1', [uid]), undefined);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
