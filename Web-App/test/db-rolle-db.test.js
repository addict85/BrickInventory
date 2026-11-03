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
 *   F  PGOPTIONS und `SET search_path` entfernt → rot: „die App-Rolle schiebt
 *      dem Superuser nichts unter“ (Operator der App-Rolle legt eine
 *      Superuser-Rolle an)
 *   G  `ALTER DATABASE … RESET ALL` entfernt → rot: dieselbe Prüfung
 *      (search_path der Datenbank bleibt für spätere Superuser-Sitzungen)
 *   H  `-c role=none` und `SET ROLE NONE` entfernt → rot: dieselbe Prüfung
 *      („untergeschobenes SET role“: die Sitzung läuft als App-Rolle)
 *   I  `password_hash` aus der Sperrliste der Leserolle gestrichen → rot:
 *      „die Leserolle sieht keine Geheimnisse“
 *   J  (03.11.2026) `REVOKE TEMPORARY … FROM PUBLIC` gestrichen → rot:
 *      „die Leserolle legt temporäre Tabellen an“
 *   K  (03.11.2026) `api_tokens_verbraucht` aus der Sperrliste gestrichen →
 *      rot: „SELECT token FROM api_tokens_verbraucht“
 *   L  (03.11.2026, Allowlist) `password_hash` in die Zeile `users:` von
 *      LESEN_SPALTEN aufgenommen → rot: „die Leserolle sieht keine Geheimnisse“
 *      (SELECT password_hash gelingt) und „… liest genau die Allowlist“
 *   M  die Allowlist-Schleife durch die alte Sperrliste ersetzt (alle Spalten
 *      ausser den bekannten Geheimnissen) → rot: „neue Spalten und Tabellen
 *      bleiben unlesbar“ (users.neues_geheimnis lesbar)
 *   N  in app-rolle.sh `aus_datei DB_APP_PASSWORD` gestrichen → rot:
 *      „Passwörter aus Dateien“ (DB_APP_PASSWORD fehlt)
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
const LESEN = `${praefix}_lesen`.toLowerCase();
const BOESE = `${praefix}_boese`.toLowerCase();
const LESEN_PW = `lesen-${process.pid}-geheim`;
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
    DB_APP_USER: ROLLE, DB_APP_PASSWORD: PASSWORT, DB_LESEN_USER: LESEN, PGWEB_DB_PASSWORD: LESEN_PW, ...mehr } });
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
    for (const r of [ROLLE, LESEN, BOESE]) await admin.query(`DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
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

  await t.test('die App-Rolle schiebt dem Superuser nichts unter', async () => {
    const app = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app.connect();
    try {
      // Jede Funktion legt eine Superuser-Rolle an, sobald ein Superuser sie ausführt.
      const nutzlast = `IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${BOESE}') THEN
        EXECUTE 'CREATE ROLE ${id(BOESE)} SUPERUSER'; END IF;`;
      await app.query(`CREATE SCHEMA boese`);
      await app.query(`CREATE FUNCTION boese.set_config(text, text, boolean) RETURNS text LANGUAGE plpgsql AS
        $f$ BEGIN ${nutzlast} RETURN pg_catalog.set_config($1, $2, $3); END $f$`);
      await app.query(`CREATE FUNCTION boese.current_setting(text) RETURNS text LANGUAGE plpgsql AS
        $f$ BEGIN ${nutzlast} RETURN pg_catalog.current_setting($1); END $f$`);
      await app.query(`CREATE FUNCTION boese.gleich(text, name) RETURNS boolean LANGUAGE plpgsql AS
        $f$ BEGIN ${nutzlast} RETURN $1 OPERATOR(pg_catalog.=) $2; END $f$`);
      await app.query(`CREATE OPERATOR boese.= (LEFTARG = text, RIGHTARG = name, FUNCTION = boese.gleich)`);
      await app.query(`ALTER DATABASE ${id(neu)} SET search_path = boese, pg_catalog, public`);
      await app.query(`ALTER ROLE ${id(ROLLE)} IN DATABASE ${id(neu)} SET search_path = boese, pg_catalog`);
    } finally { await app.end(); }
    const r = rolleEinrichten(neu);
    assert.deepEqual((await admin.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [BOESE])).rows, [],
      'Code der App-Rolle lief als Superuser');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual((await admin.query(
      'SELECT setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = $1', [neu])).rows, [],
      'Einstellungen der App-Rolle an der Datenbank bleiben stehen');

    const app2 = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app2.connect();
    try { await app2.query(`ALTER DATABASE ${id(neu)} SET role = ${id(ROLLE)}`); } finally { await app2.end(); }
    const r2 = rolleEinrichten(neu);
    assert.equal(r2.status, 0, `untergeschobenes SET role: ${r2.stderr}`);
    assert.equal((await rechteDerRolle(admin)).rolsuper, false);
  });

  await t.test('die Leserolle sieht keine Geheimnisse', async () => {
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      await c.query(`INSERT INTO users (username, password_hash, reset_token) VALUES ('leseprobe', '$2b$10$geheim', 'rt')`);
      await c.query(`INSERT INTO api_tokens (token, user_id) SELECT 'tok', id FROM users WHERE username = 'leseprobe'`);
    } finally { await c.end(); }
    assert.equal(rolleEinrichten(neu).status, 0, 'Rechte für neue Tabellen');
    const l = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l.connect();
    try {
      assert.deepEqual((await l.query(`SELECT username, is_admin FROM users WHERE username = 'leseprobe'`)).rows, [{ username: 'leseprobe', is_admin: false }]);
      for (const sql of ['SELECT password_hash FROM users', 'SELECT reset_token FROM users', 'SELECT * FROM users',
        'SELECT token FROM api_tokens', 'SELECT token FROM api_tokens_verbraucht', 'SELECT sid FROM user_sessions', 'SELECT geheimnis FROM zweiter_faktor',
        'SELECT value FROM global_settings'])
        await assert.rejects(l.query(sql), /permission denied/, sql);
      await assert.rejects(l.query(`UPDATE users SET is_admin = true`), /read-only|permission denied/);
      await l.query('SET TRANSACTION READ WRITE').catch(() => {});
      await assert.rejects(l.query(`CREATE TABLE public.probe (x int)`), /permission denied|read-only/);
      await assert.rejects(l.query(`COPY (SELECT 1) TO PROGRAM 'true'`), /permission denied|must be superuser|read-only/);
      await l.query('SET default_transaction_read_only = off');
      await assert.rejects(l.query('CREATE TEMP TABLE probe (x int)'), /permission denied/, 'die Leserolle legt temporäre Tabellen an');
    } finally { await l.end(); }
    const app = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app.connect();
    try { await app.query('CREATE TEMP TABLE probe (x int)'); } finally { await app.end(); }
    const ohne = rolleEinrichten(neu, { PGWEB_DB_PASSWORD: '' });
    assert.equal(ohne.status, 0, ohne.stderr);
    assert.equal((await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [LESEN])).rows[0].rolcanlogin, false,
      'ohne PGWEB_DB_PASSWORD meldet sich die Leserolle nicht an');
    const gleich = rolleEinrichten(neu, { PGWEB_DB_PASSWORD: PASSWORT });
    assert.notEqual(gleich.status, 0);
    assert.match(gleich.stderr, /PGWEB_DB_PASSWORD muss sich/);
  });

  await t.test('die Leserolle liest genau die Allowlist', async () => {
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    // Jede Spalte der Allowlist gibt es im aktuellen Schema (sonst meldet das Skript sie).
    assert.doesNotMatch(r.stderr, /fehlt eine der Spalten/, r.stderr);
    const lesbar = async (tabelle) => {
      const c = new Client({ connectionString: url(neu) });
      await c.connect();
      try {
        return (await c.query(`SELECT a.attname::text AS n FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0
          AND NOT a.attisdropped AND has_column_privilege($2, a.attrelid, a.attnum, 'SELECT') ORDER BY a.attnum`, [tabelle, LESEN])).rows.map(z => z.n);
      } finally { await c.end(); }
    };
    assert.deepEqual(await lesbar('users'), ['id', 'username', 'email', 'first_name', 'last_name', 'is_admin', 'is_active',
      'email_verified', 'token_expires', 'reset_token_expires', 'must_change_password', 'created_at', 'sitzungs_version']);
    assert.deepEqual(await lesbar('vouchers'), ['id', 'user_id', 'amount', 'currency', 'pdf_path', 'created_at', 'updated_at', 'guthaben_geprueft_am']);
    for (const t of ['api_tokens', 'api_tokens_verbraucht', 'user_sessions', 'qr_login_tokens', 'webauthn_challenges',
      'zweiter_faktor_codes', 'account_link_invites', 'idempotenz'])
      assert.deepEqual(await lesbar(t), [], `${t} ist für die Leserolle lesbar`);
  });

  await t.test('neue Spalten und Tabellen bleiben unlesbar, bis die Allowlist sie nennt', async () => {
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      await c.query('ALTER TABLE users ADD COLUMN neues_geheimnis text');
      await c.query(`UPDATE users SET neues_geheimnis = 'streng geheim'`);
      await c.query('CREATE TABLE neue_tabelle (id int, geheim text)');
      await c.query(`INSERT INTO neue_tabelle VALUES (1, 'streng geheim')`);
    } finally { await c.end(); }
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    const l = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l.connect();
    try {
      assert.ok((await l.query(`SELECT username FROM users WHERE username = 'leseprobe'`)).rowCount, 'Vorbedingung: users ist lesbar');
      await assert.rejects(l.query('SELECT neues_geheimnis FROM users'), /permission denied/, 'neue Spalte lesbar');
      await assert.rejects(l.query('SELECT * FROM neue_tabelle'), /permission denied/, 'neue Tabelle lesbar');
    } finally { await l.end(); }
    // Erst ein Eintrag in der Allowlist gibt die Spalte frei (Kopie des Skripts mit erweiterter Zeile).
    const fsm = require('node:fs'), osm = require('node:os');
    const kopie = path.join(fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-liste-')), 'app-rolle.sh');
    const quelle = fsm.readFileSync(SKRIPT, 'utf8');
    assert.match(quelle, /^users: id, username, /m);
    fsm.writeFileSync(kopie, quelle.replace(/^(users: .*)$/m, '$1, neues_geheimnis'));
    const mit = spawnSync('sh', [kopie], { encoding: 'utf8', env: { ...process.env,
      PGHOST: BASIS.hostname, PGPORT: BASIS.port || '5432', PGUSER: decodeURIComponent(BASIS.username),
      PGPASSWORD: decodeURIComponent(BASIS.password), PGDATABASE: neu,
      DB_APP_USER: ROLLE, DB_APP_PASSWORD: PASSWORT, DB_LESEN_USER: LESEN, PGWEB_DB_PASSWORD: LESEN_PW } });
    fsm.rmSync(path.dirname(kopie), { recursive: true, force: true });
    assert.equal(mit.status, 0, mit.stderr);
    const l2 = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l2.connect();
    try {
      assert.deepEqual((await l2.query(`SELECT neues_geheimnis FROM users WHERE username = 'leseprobe'`)).rows, [{ neues_geheimnis: 'streng geheim' }]);
      await assert.rejects(l2.query('SELECT * FROM neue_tabelle'), /permission denied/, 'neue Tabelle lesbar');
    } finally { await l2.end(); }
    const c2 = new Client({ connectionString: url(neu) });
    await c2.connect();
    try { await c2.query('ALTER TABLE users DROP COLUMN neues_geheimnis'); await c2.query('DROP TABLE neue_tabelle'); } finally { await c2.end(); }
    assert.equal(rolleEinrichten(neu).status, 0);
  });

  await t.test('Passwörter aus Dateien (Docker-Secrets)', async (tt) => {
    const fsm = require('node:fs'), osm = require('node:os');
    const ordner = fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-geheim-'));
    tt.after(() => fsm.rmSync(ordner, { recursive: true, force: true }));
    const datei = (name, wert) => { const f = path.join(ordner, name); fsm.writeFileSync(f, wert + '\n'); return f; };
    const umgebung = { DB_APP_PASSWORD_FILE: datei('app', PASSWORT), PGWEB_DB_PASSWORD_FILE: datei('lesen', LESEN_PW),
      PGPASSWORD_FILE: datei('su', decodeURIComponent(BASIS.password)) };
    const ohneWerte = (mehr) => {
      const env = { ...process.env, PGHOST: BASIS.hostname, PGPORT: BASIS.port || '5432', PGUSER: decodeURIComponent(BASIS.username),
        PGDATABASE: neu, DB_APP_USER: ROLLE, DB_LESEN_USER: LESEN, ...umgebung, ...mehr };
      for (const k of ['PGPASSWORD', 'DB_APP_PASSWORD', 'PGWEB_DB_PASSWORD']) if (!(k in mehr)) delete env[k];
      return spawnSync('sh', [SKRIPT], { encoding: 'utf8', env });
    };
    const r = ohneWerte({});
    assert.equal(r.status, 0, r.stderr);
    const l = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l.connect();
    await l.end();
    const app = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app.connect();
    await app.end();
    const beide = ohneWerte({ DB_APP_PASSWORD: PASSWORT });
    assert.notEqual(beide.status, 0);
    assert.match(beide.stderr, /DB_APP_PASSWORD und DB_APP_PASSWORD_FILE sind beide gesetzt/);
    const fehlt = ohneWerte({ DB_APP_PASSWORD_FILE: path.join(ordner, 'gibt-es-nicht') });
    assert.notEqual(fehlt.status, 0);
    assert.match(fehlt.stderr, /DB_APP_PASSWORD_FILE=.* ist nicht lesbar/);
  });

  await t.test('ein gleiches Passwort wird abgewiesen', () => {
    const r = rolleEinrichten(neu, { DB_APP_PASSWORD: decodeURIComponent(BASIS.password) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden/);
  });
});
