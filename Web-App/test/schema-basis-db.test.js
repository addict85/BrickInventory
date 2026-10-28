/**
 * Eine leere Datenbank bekommt ihr Schema aus db/basis.sql, eine bestehende
 * wird beim Start nicht angefasst — nur die Migrationen laufen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in initSchema() die Prüfung auf eine leere Datenbank entfernt → rot:
 *      „eine bestehende Datenbank bleibt, wie sie ist“ (die Basis scheitert an
 *      vorhandenen Tabellen)
 *   B  legeAdminAn() nicht aufgerufen → rot: „eine leere Datenbank bekommt
 *      Basis, Vorgaben und einen Administrator“
 *   C  die Abfrage auf LETZTE_STARTSTUFE entfernt → rot: „eine Datenbank vor
 *      0050 wird abgewiesen …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, deren Benutzer Datenbanken
 * anlegen darf.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASIS = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const NAME = `schema_basis_${process.pid}`;
const ziel = new URL(BASIS); ziel.pathname = '/' + NAME;
process.env.DATABASE_URL = ziel.toString();
process.env.WEB_WORKERS = '1';
process.env.ADMIN_PASSWORD = 'Basis-Pruefung-2026';

const _req = require('./helpers/sources').buildAndRequire();
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

test('Erststart über db/basis.sql', { concurrency: 1, timeout: 180_000 }, async (t) => {
  const admin = new Client({ connectionString: BASIS });
  try { await admin.connect(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const db = _req('db/database.js');
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`).catch(() => {});
    await admin.end().catch(() => {});
  });

  await t.test('eine leere Datenbank bekommt Basis, Vorgaben und einen Administrator', async () => {
    await db.initSchemaOnce();
    const konto = await db.get(`SELECT is_admin, is_active FROM users WHERE username = 'admin'`);
    assert.equal(Number(konto?.is_admin), 1, 'kein Administrator angelegt');
    const vorgabe = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`);
    assert.equal(vorgabe?.value, '4000', 'die Vorgabewerte fehlen');
    const rb = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_rebrickable'`);
    assert.equal(rb?.value, '25000', 'das Rebrickable-Tageslimit einer Neuinstallation muss 25000 sein');
    const pk = await db.get(`SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'rate_limit_attempts'::regclass AND i.indisprimary`);
    assert.equal(pk?.attname, 'key', 'die Anmeldezähler brauchen ihren Schlüssel als Primärschlüssel');
    const dateien = fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter(f => f.endsWith('.sql')).sort();
    const angewandt = (await db.all('SELECT name FROM schema_migrations')).map(r => r.name);
    assert.deepEqual(dateien.filter(f => !angewandt.includes(f)), [], 'nicht jede Migration gilt als angewandt');
  });

  await t.test('eine bestehende Datenbank bleibt, wie sie ist', async () => {
    await db.run(`UPDATE users SET is_active = 0 WHERE username = 'admin'`);
    await db.run(`UPDATE global_settings SET value = '123' WHERE key = 'api_limit_bricklink'`);
    assert.equal(await db.initSchema(), false, 'die Basis wurde erneut eingespielt');
    await db.initSchemaOnce();
    assert.equal(Number((await db.get(`SELECT is_active FROM users WHERE username = 'admin'`)).is_active), 0,
      'ein abgeschaltetes Administratorkonto wurde wieder freigeschaltet');
    assert.equal((await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`)).value, '123');
  });

  await t.test('eine Datenbank vor 0050 wird abgewiesen statt halb weitergeführt', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name LIKE '0050-%'`);
    await assert.rejects(db.initSchema(), /älter als 0050/);
  });
});
