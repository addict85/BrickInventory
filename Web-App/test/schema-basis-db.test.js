/**
 * Eine leere Datenbank bekommt ihr Schema aus db/basis.sql, eine bestehende
 * wird beim Start nicht angefasst — nur die Migrationen laufen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in initSchema() die Prüfung auf eine leere Datenbank entfernt → rot:
 *      „eine bestehende Datenbank bleibt, wie sie ist“ (die Basis scheitert an
 *      vorhandenen Tabellen)
 *   B  (10.11.) den Erststart aus erzeugeDb(…, { erststart }) nicht aufgerufen → rot:
 *      „eine leere Datenbank bekommt Basis, Vorgaben und einen Administrator“
 *   D  (29.10.) in initSchema() wieder die Sperre „älter als 0050“ → rot:
 *      „eine Datenbank mit 0045, aber ohne 0050 startet …“ (der Stand von
 *      main bis 1ad80a5).
 *   F  (09.11.) in db/basis.sql eine Zeile `ALTER TABLE ONLY public.users ALTER COLUMN …` von Hand
 *      ergänzt → rot: „db/basis.sql ist ein unverändertes Abbild …“; ebenso eine Migration, die
 *      in basis.sql als angewandt steht, deren Datei es nicht gibt → rot: „… eine lückenlose Folge …“
 *   E  (08.11.) in initSchemaOnce() den Aufruf pruefeMindeststand() entfernt
 *      → rot: „eine Datenbank älter als 0050 hält den Start an …“ (der Start
 *      lief durch und spielte die offenen Migrationen ein)
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
const { testName, raeumeReste, id } = require('./helpers/testnamen');
const NAME = testName('schema_basis');
const ziel = new URL(BASIS);
ziel.pathname = '/' + NAME;
process.env.DATABASE_URL = ziel.toString();
process.env.ADMIN_PASSWORD = 'Basis-Pruefung-2026';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

test('Erststart über db/basis.sql', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await raeumeReste(admin, 'schema_basis');
  await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)}`);
  await admin.query(`CREATE DATABASE ${id(NAME)}`);
  // Wie server.ts: Der Zugang bekommt den Erststart mit, der das erste Konto anlegt.
  const modul = _req('db/database.js');
  const db = modul.erzeugeDb(modul.dbKonfigAusUmgebung(), {
    erststart: () => _req('startup/verdrahtung.js').baueVerdrahtung().erststart(),
  });
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await modul.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)} WITH (FORCE)`).catch(() => {});
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
    const dateien = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    const angewandt = (await db.all('SELECT name FROM schema_migrations')).map(r => r.name);
    assert.deepEqual(
      dateien.filter(f => !angewandt.includes(f)),
      [],
      'nicht jede Migration gilt als angewandt',
    );
  });

  await t.test('eine bestehende Datenbank bleibt, wie sie ist', async () => {
    await db.run(`UPDATE users SET is_active = false WHERE username = 'admin'`);
    await db.run(`UPDATE global_settings SET value = '123' WHERE key = 'api_limit_bricklink'`);
    assert.equal(await db.initSchema(), false, 'die Basis wurde erneut eingespielt');
    await db.initSchemaOnce();
    assert.equal(
      Number((await db.get(`SELECT is_active FROM users WHERE username = 'admin'`)).is_active),
      0,
      'ein abgeschaltetes Administratorkonto wurde wieder freigeschaltet',
    );
    assert.equal((await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`)).value, '123');
  });

  // Der Stand von main bis 1ad80a5: 0045 da, 0050 noch nicht.
  await t.test('eine Datenbank mit 0045, aber ohne 0050 startet und holt 0050 nach', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name LIKE '0050-%'`);
    assert.equal(await db.initSchema(), false);
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
    assert.ok(await db.get(`SELECT 1 FROM schema_migrations WHERE name LIKE '0050-%'`), '0050 nicht nachgeholt');
  });

  // Ein Stand vor 0050 müsste die entfernten Startstufen nachholen; der Start
  // sagt das, statt die jüngeren Migrationen auf ein fremdes Schema zu setzen.
  await t.test('eine Datenbank älter als 0050 hält den Start an und bleibt unberührt', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name >= '0050'`);
    const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n;
    assert.ok(vorher > 0, 'die Probe braucht Migrationen vor 0050');
    await assert.rejects(db.initSchemaOnce(), /älter als Migration 0050.*UPGRADE\.md/s);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n,
      vorher,
      'auf dem zu alten Stand lief eine Migration',
    );
    await db.run('DROP TABLE schema_migrations');
    await assert.rejects(
      db.initSchemaOnce(),
      /älter als Migration 0050/,
      'ohne Migrationstabelle gilt die Datenbank als zu alt',
    );
  });
});

test('db/basis.sql ist erzeugt, nicht geschrieben', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const NAME2 = testName('schema_abbild');
  await raeumeReste(admin, 'schema_abbild');
  await admin.query(`CREATE DATABASE ${id(NAME2)}`);
  const ziel2 = new URL(BASIS);
  ziel2.pathname = '/' + NAME2;
  const c = new Client({ connectionString: ziel2.toString() });
  t.after(async () => {
    await c.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME2)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });
  await c.connect();
  const datei = fs.readFileSync(path.join(ROOT, 'db/basis.sql'), 'utf8');
  await c.query(datei);

  await t.test('die Basis nennt eine lückenlose Folge vorhandener Migrationen', async () => {
    const inBasis = (await c.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    const dateien = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    assert.ok(inBasis.length > 50, `nur ${inBasis.length} Migrationen in der Basis`);
    assert.deepEqual(
      inBasis,
      dateien.slice(0, inBasis.length),
      'Die Basis ist ein Abbild der ersten N Migrationsdateien',
    );
  });

  await t.test('db/basis.sql ist ein unverändertes Abbild der Datenbank, die es erzeugt', async tt => {
    const sk = require(path.join(ROOT, 'scripts', 'schema-stand.js'));
    const erzeugtMit = Number((datei.match(/^-- Erzeugt mit pg_dump (\d+)\./m) || [])[1]);
    let jetzt = null;
    try {
      jetzt = sk.pgDumpVersion();
    } catch {
      /* kein pg_dump im Pfad */
    }
    // pg_dump schreibt je Hauptversion anders; verglichen wird nur mit derselben.
    if (jetzt !== erzeugtMit) {
      tt.skip(`pg_dump ${jetzt ?? 'fehlt'}, die Basis ist mit ${erzeugtMit} erzeugt`);
      return;
    }
    assert.equal(
      sk.basisText(ziel2.toString()),
      datei,
      'db/basis.sql weicht vom Erzeugnis ab — nicht von Hand ändern, neu erzeugen: npm run build && npm run schema:stand',
    );
  });
});
