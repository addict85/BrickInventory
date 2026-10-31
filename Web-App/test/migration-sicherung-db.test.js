/**
 * Vor offenen Migrationen: Nutzerdaten sichern, ohne Zeitgrenze migrieren.
 * @einzeln: legt eine Probe-Migration in dist/db/migrations, die jede parallel
 * startende Datei beim Migrieren sähe.
 *
 * Eine Probe-Migration in dist/db/migrations bricht ab, wenn
 * statement_timeout nicht 0 ist; der Pool setzt 30 s für jede Verbindung.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  `SET LOCAL statement_timeout = 0` entfernt → rot: „offene Migration:
 *      erst gesichert, dann ohne Zeitgrenze angewandt"
 *   B  in runMigrations den Aufruf von sichereNutzerdaten entfernt → rot:
 *      dieselbe Prüfung (keine Sicherung)
 *   C  OFFSET der Aufräumabfrage entfernt (alle löschen) → rot: „die drei
 *      jüngsten Sicherungen bleiben"
 *   D  (28.10.) die UNION über Fremdschlüssel auf users entfernt → rot:
 *      „offene Migration …" (account_links fehlt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { DIST } = require('./helpers/sources');
const db = _req('db/database.js');
const { runMigrations, sichereNutzerdaten } = _req('db/migrate.js');
const NAME = `migsich_${process.pid}`, ZWEIT = `migsich2_${process.pid}`;
const PROBE = `9999-probe-${process.pid}.sql`;

const sicherungen = async () => (await db.all(
  `SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$' ORDER BY nspname`)).map(r => r.nspname);

test('Migrationen: Sicherung und Zeitgrenze', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  await runMigrations(client);
  const vorher = new Set(await sicherungen());
  const probe = path.join(DIST, 'db/migrations', PROBE);

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ZWEIT]]);
  const anlegen = async (n) => (await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', 1, 1) RETURNING id`, [n])).id;
  const haupt = await anlegen(NAME), kind = await anlegen(ZWEIT);
  // Eine Haushaltsverknüpfung: Die Tabelle hat keine Spalte user_id, nur Fremdschlüssel auf users.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    fs.rmSync(probe, { force: true });
    await db.run('DELETE FROM schema_migrations WHERE name = $1', [PROBE]).catch(() => {});
    for (const s of await sicherungen())
      if (!vorher.has(s)) await db.run(`DROP SCHEMA ${s} CASCADE`).catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ZWEIT]]).catch(() => {});
    client.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('ohne offene Migration keine Sicherung', async () => {
    await runMigrations(client, { sichern: true });
    assert.deepEqual(new Set(await sicherungen()), vorher);
  });

  await t.test('offene Migration: erst gesichert, dann ohne Zeitgrenze angewandt', async () => {
    fs.writeFileSync(probe, `DO $$ BEGIN
      IF current_setting('statement_timeout') <> '0' THEN
        RAISE EXCEPTION 'statement_timeout ist %', current_setting('statement_timeout');
      END IF; END $$;`);
    assert.notEqual((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '0',
      'Die Verbindung hat keine Zeitgrenze — dann prüft die Probe nichts');
    const angewandt = await runMigrations(client, { sichern: true });
    assert.deepEqual(angewandt, [PROBE]);
    const neu = (await sicherungen()).filter(s => !vorher.has(s));
    assert.equal(neu.length, 1, 'keine Sicherung vor der Migration');
    const kopie = await db.get(`SELECT username FROM ${neu[0]}.users WHERE username = $1`, [NAME]);
    assert.ok(kopie, 'Die Sicherung enthält die Konten nicht');
    const tabellen = (await db.all(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [neu[0]]))
      .map(r => r.table_name);
    assert.ok(tabellen.includes('set_acquisitions'), `Tabellen mit user_id fehlen: ${tabellen.join(', ')}`);
    assert.ok(!tabellen.includes('set_catalog'), 'Der Katalog gehört nicht in die Sicherung');
    for (const n of ['account_links', 'account_link_invites', 'household_former_links', 'verwaltungsprotokoll'])
      assert.ok(tabellen.includes(n), `${n} fehlt in der Sicherung`);
    assert.ok(await db.get(`SELECT 1 FROM ${neu[0]}.account_links WHERE main_user_id = $1 AND sub_user_id = $2`, [haupt, kind]),
      'Die Haushaltsverknüpfung fehlt in der Sicherung');
  });

  await t.test('die drei jüngsten Sicherungen bleiben', async () => {
    for (let i = 0; i < 4; i++) { await sichereNutzerdaten(client, ['probe']); await new Promise(r => setTimeout(r, 5)); }
    assert.equal((await sicherungen()).length, 3);
  });
});
