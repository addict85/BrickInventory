/**
 * postgres/app-rolle.sh: App und Jobs verbinden sich mit einer Rolle ohne
 * Superuser-Rechte, die Datenbank, Tabellen und Funktionen besitzt. Geprüft an
 * einer bestehenden Installation (alles gehört dem Superuser, die Rolle hat
 * zu viele Rechte) und an einer neuen; danach laufen die Migrationen als App.
 *
 * Gegenproben (am 02.11.2026 gemessen):
 *   A  im Skript die Schleife über pg_class entfernt → rot: „bestehende
 *      Installation“ (Tabellen gehören weiter dem Superuser, ALTER TABLE als
 *      App scheitert)
 *   B  NOSUPERUSER durch SUPERUSER ersetzt → rot: „bestehende Installation“
 *      und „neue Installation“ (rolsuper)
 *   C  die REVOKE-Schleife entfernt → rot: „bestehende Installation“
 *      (pg_execute_server_program bleibt, COPY … PROGRAM geht)
 *   D  den Vergleich mit dem Superuser-Passwort entfernt → rot: „ein gleiches
 *      Passwort wird abgewiesen“
 *   E  in warneBeiSuperuser() rolsuper nicht mehr beachtet → rot:
 *      „bestehende Installation“ (der Start warnt auch als App-Rolle)
 *
 * Voraussetzung: TEST_DATABASE_URL mit Superuser (legt Datenbanken und eine
 * Rolle an) und psql ab Version 15 (\getenv).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKRIPT = path.join(ROOT, 'postgres', 'app-rolle.sh');
const BASIS = new URL(process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
require('./helpers/sources').buildAndRequire();

const praefix = `${decodeURIComponent(BASIS.pathname.slice(1))}_rolle_${process.pid}`;
const ROLLE = `${praefix}_app`.toLowerCase();
const PASSWORT = `app-${process.pid}-geheim`;
const id = (s) => `"${s.replace(/"/g, '""')}"`;
const url = (db, nutzer, pw) => {
  const u = new URL(BASIS); u.pathname = '/' + db;
  if (nutzer) { u.username = nutzer; u.password = pw; }
  return u.toString();
};

function rolleEinrichten(db, mehr = {}) {
  return spawnSync('sh', [SKRIPT], { encoding: 'utf8', env: { ...process.env,
    PGHOST: BASIS.hostname, PGPORT: BASIS.port || '5432', PGUSER: decodeURIComponent(BASIS.username),
    PGPASSWORD: decodeURIComponent(BASIS.password), PGDATABASE: db,
    DB_APP_USER: ROLLE, DB_APP_PASSWORD: PASSWORT, ...mehr } });
}

/** Schema und Migrationen in einem eigenen Prozess, wie beim Start. */
function schemaAlsKonto(dbUrl, aufruf = 'initSchemaOnce') {
  return spawnSync(process.execPath, ['-e',
    `const db = require('./dist/db/database.js'); db.${aufruf}().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); })`],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl } });
}

async function fremdBesessen(c) {
  return (await c.query(`
    SELECT 'relation ' || oid::regclass AS was FROM pg_class c
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','v','m','S') AND relowner <> $1::regrole
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'funktion ' || oid::regprocedure FROM pg_proc p
     WHERE pronamespace = 'public'::regnamespace AND proowner <> $1::regrole
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`, [ROLLE])).rows.map(z => z.was);
}

async function rechteDerRolle(c) {
  const z = (await c.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
      (SELECT count(*)::int FROM pg_auth_members WHERE member = r.oid) AS mitglied
      FROM pg_roles r WHERE rolname = $1`, [ROLLE])).rows[0];
  return z;
}

test('Datenbankrolle der App', { concurrency: 1, timeout: 180_000 }, async (t) => {
  const admin = new Client({ connectionString: BASIS.toString() });
  try { await admin.connect(); } catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]?.rolsuper;
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  const fassung = Number(psql.stdout?.match(/(\d+)\./)?.[1] ?? 0);
  if (!su || fassung < 15) {
    await admin.end();
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber Superuser=${su} und psql ${fassung || 'fehlt'}`);
    t.skip('kein Superuser oder psql unter 15'); return;
  }
  const alt = `${praefix}_alt`, neu = `${praefix}_neu`;
  t.after(async () => {
    for (const db of [alt, neu]) await admin.query(`DROP DATABASE IF EXISTS ${id(db)} WITH (FORCE)`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${id(ROLLE)}`).catch(() => {});
    await admin.end();
  });

  await t.test('bestehende Installation', async () => {
    await admin.query(`CREATE DATABASE ${id(alt)}`);
    const s = schemaAlsKonto(url(alt));
    assert.equal(s.status, 0, s.stderr);
    await admin.query(`CREATE ROLE ${id(ROLLE)} LOGIN SUPERUSER CREATEROLE`);
    await admin.query(`GRANT pg_execute_server_program TO ${id(ROLLE)}`);

    const r = rolleEinrichten(alt);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(await rechteDerRolle(admin),
      { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, mitglied: 0 });
    const c = new Client({ connectionString: url(alt) });
    await c.connect();
    try {
      assert.deepEqual(await fremdBesessen(c), []);
      assert.ok((await c.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")).rows[0].n > 50);
      assert.equal((await c.query('SELECT pg_get_userbyid(datdba) AS e FROM pg_database WHERE datname = current_database()')).rows[0].e, ROLLE);
    } finally { await c.end(); }

    const app = new Client({ connectionString: url(alt, ROLLE, PASSWORT) });
    await app.connect();
    try {
      await app.query('ALTER TABLE users ADD COLUMN rollenprobe int');
      await app.query('ALTER TABLE users DROP COLUMN rollenprobe');
      await assert.rejects(app.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|must be superuser/);
    } finally { await app.end(); }
    const m = schemaAlsKonto(url(alt, ROLLE, PASSWORT), 'initSchema');
    assert.equal(m.status, 0, `Schema und Migrationen als App: ${m.stderr}`);
    assert.equal(rolleEinrichten(alt).status, 0, 'ein zweiter Lauf scheitert');

    const warnung = (dbUrl) => spawnSync(process.execPath, ['-e',
      "require('./dist/startup/datenbank.js').warneBeiSuperuser().then(w => { console.log('WARNUNG=' + w); return require('./dist/db/database.js').pool.end(); })"],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: dbUrl } }).stdout;
    assert.match(warnung(url(alt)), /WARNUNG=true/, 'als Superuser warnt der Start nicht');
    assert.match(warnung(url(alt, ROLLE, PASSWORT)), /WARNUNG=false/);
  });

  await t.test('neue Installation', async () => {
    await admin.query(`CREATE DATABASE ${id(neu)}`);
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    const s = schemaAlsKonto(url(neu, ROLLE, PASSWORT));
    assert.equal(s.status, 0, `das erste Schema als App: ${s.stderr}`);
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      assert.deepEqual(await fremdBesessen(c), []);
      assert.ok((await c.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rowCount, 'pg_trgm fehlt');
    } finally { await c.end(); }
    assert.equal((await rechteDerRolle(admin)).rolsuper, false);
  });

  await t.test('ein gleiches Passwort wird abgewiesen', () => {
    const r = rolleEinrichten(neu, { DB_APP_PASSWORD: decodeURIComponent(BASIS.password) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden/);
  });
});
