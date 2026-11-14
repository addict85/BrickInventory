/**
 * postgres/app-rolle.sh: Die Migrationsrolle besitzt alles, die Laufzeitrolle
 * von App und Jobs liest und schreibt nur Zeilen; beide ohne Superuser-Rechte.
 * Geprüft an einer bestehenden Installation (Objekte gehören dem Superuser oder
 * noch der Laufzeitrolle mit zu vielen Rechten) und an einer neuen; migriert
 * wird als Migrationsrolle, die Laufzeitrolle prüft nur den Stand.
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
 *   O  (04.11.2026) in warneBeiSuperuser() das Startverbot ohne
 *      DB_SUPERUSER_ERLAUBT gestrichen → rot: „bestehende Installation“
 *      (als Superuser startet die Produktion)
 *   F  PGOPTIONS und `SET search_path` entfernt → rot: „die Migrationsrolle
 *      schiebt dem Superuser nichts unter“ (Operator der Rolle legt eine
 *      Superuser-Rolle an)
 *   G  `ALTER DATABASE … RESET ALL` entfernt → rot: dieselbe Prüfung
 *      (search_path der Datenbank bleibt für spätere Superuser-Sitzungen)
 *   H  `-c role=none` und `SET ROLE NONE` entfernt → rot: dieselbe Prüfung
 *      („untergeschobenes SET role“: die Sitzung läuft als Migrationsrolle)
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
 *   P  (06.11.2026) die Schleife über vor_migration_* entfernt → rot:
 *      „bestehende Installation“ (permission denied for schema vor_migration_…)
 *   Getrennte Migrationsrolle (11.11.2026, je einzeln; F–H am selben Tag
 *   gegen die Migrationsrolle wiederholt, die jetzt Funktionen anlegen kann):
 *   Q  die Default Privileges für Tabellen gestrichen → rot: „neue Installation“
 *      (permission denied for table schema_migrations) und „was die
 *      Migrationsrolle später anlegt …“ (permission denied for table spaeter)
 *   R  `GRANT CONNECT, TEMPORARY` → nur CONNECT → rot: „… darf kein DROP …“,
 *      „der Katalog-Import tauscht als Laufzeitrolle“ (temporary tables)
 *   S  csvTausch.ts wieder `CREATE UNLOGGED TABLE` → rot: „der Katalog-Import
 *      tauscht als Laufzeitrolle“ (permission denied for schema public)
 *   T  die Datenbank wieder der Laufzeitrolle übergeben → rot: „bestehende
 *      Installation“, „neue Installation“, „… darf kein DROP …“
 *   U  in initSchemaOnce den Zweig für Rollen ohne CREATE gestrichen → rot:
 *      „neue Installation“ (keine Meldung „Die Datenbank ist leer …“)
 *   V  in startup/migrieren.ts die Prüfung darfSchemaAendern() gestrichen →
 *      rot: „… offenen Migrationen“ (der Dienst meldet als Laufzeitrolle Erfolg)
 *   W  in scripts/rollen-trennen.sh `docker compose run --rm db-rolle`
 *      gestrichen → rot: „scripts/rollen-trennen.sh stellt … um“
 *   X  der Laufzeitrolle TRUNCATE dazugegeben → rot: „… darf kein DROP …“
 *      (Missing expected rejection: TRUNCATE wanted)
 *   Y  in raeumeAlteSicherungenAuf das Leeren für fremde Kopien gestrichen →
 *      rot: „was die Migrationsrolle später anlegt …“ (0 statt 1 geleert)
 *   Z  (13.11.2026) die Leserolle wieder NOBYPASSRLS → rot: „der Zeilenschutz
 *      gilt für die Laufzeitrolle …“ (pgweb sieht 0 Zeilen); ebenso mit
 *      `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` vor der Prüfung (die
 *      Laufzeitrolle sieht ohne Konto 1 Zeile)
 *   Systemrolle (13.11.2026, je einzeln):
 *   AA die Systemrolle NOBYPASSRLS → rot: „bestehende Installation“
 *      (rolbypassrls) und „der Zeilenschutz gilt …“ (Systemrolle sieht 0)
 *   AB `aus_datei DB_SYSTEM_PASSWORD` gestrichen → rot: „Passwörter aus
 *      Dateien“ und „scripts/rollen-trennen.sh …“ (DB_SYSTEM_PASSWORD fehlt)
 *   AC die Rechte nur noch für die Laufzeitrolle vergeben → rot: „Laufzeit-
 *      und Systemrolle dürfen …“ und „der Zeilenschutz gilt …“ (permission denied)
 *
 *   Kontotabellen (14.11.2026, je einzeln):
 *   AD in 0115 die Schleife über die Rollen gestrichen → rot: „… schon nach der
 *      Migration“ (SELECT password_hash gelingt der Laufzeitrolle)
 *   AE in app-rolle.sh den Block für users/user_sessions gestrichen → rot: „… und
 *      nach jedem Lauf von app-rolle.sh …“ (GRANT ON ALL TABLES gibt beides zurück)
 *   AF die Policy `lesen` auf account_links für alle Befehle (ohne `FOR SELECT`) →
 *      rot: beide (das INSERT in den fremden Haushalt gelingt)
 *   AG in app-rolle.sh die Schleife über vor_migration_* für RLS gestrichen → rot:
 *      „… Kopien vor Migrationen …“ (die Laufzeitrolle liest den Hash der Kopie)
 *
 * Voraussetzung: TEST_DATABASE_URL mit Superuser (legt Datenbanken und eine
 * Rolle an) und psql ab Version 15 (\getenv).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { keineDb, fehltVoraussetzung } = require('./helpers/db');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKRIPT = path.join(ROOT, 'postgres', 'app-rolle.sh');
const BASIS = new URL(
  process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest',
);
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
require('./helpers/sources').buildAndRequire();

const { testName, raeumeReste } = require('./helpers/testnamen');
const praefix = testName('rolle');
const ROLLE = `${praefix}_app`.toLowerCase();
const MIG = `${praefix}_mig`.toLowerCase();
const LESEN = `${praefix}_lesen`.toLowerCase();
const BOESE = `${praefix}_boese`.toLowerCase();
const SYS = `${praefix}_sys`.toLowerCase();
const SYS_PW = `sys-${process.pid}-geheim`;
const LESEN_PW = `lesen-${process.pid}-geheim`;
const PASSWORT = `app-${process.pid}-geheim`;
const MIG_PW = `mig-${process.pid}-geheim`;
const id = s => `"${s.replace(/"/g, '""')}"`;
const url = (db, nutzer, pw) => {
  const u = new URL(BASIS);
  u.pathname = '/' + db;
  if (nutzer) {
    u.username = nutzer;
    u.password = pw;
  }
  return u.toString();
};

function rolleEinrichten(db, mehr = {}) {
  return spawnSync('sh', [SKRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: BASIS.hostname,
      PGPORT: BASIS.port || '5432',
      PGUSER: decodeURIComponent(BASIS.username),
      PGPASSWORD: decodeURIComponent(BASIS.password),
      PGDATABASE: db,
      DB_APP_USER: ROLLE,
      DB_APP_PASSWORD: PASSWORT,
      DB_MIGRATION_USER: MIG,
      DB_MIGRATION_PASSWORD: MIG_PW,
      DB_LESEN_USER: LESEN,
      PGWEB_DB_PASSWORD: LESEN_PW,
      DB_SYSTEM_USER: SYS,
      DB_SYSTEM_PASSWORD: SYS_PW,
      ...mehr,
    },
  });
}

/** Schema und Migrationen in einem eigenen Prozess, wie beim Start. */
function schemaAlsKonto(dbUrl, aufruf = 'initSchemaOnce') {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const m = require('./dist/db/database.js'); const db = m.erzeugeDb(m.dbKonfigAusUmgebung()); db.${aufruf}().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); })`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl } },
  );
}

async function fremdBesessen(c) {
  return (
    await c.query(
      `
    SELECT 'relation ' || oid::regclass AS was FROM pg_class c
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','v','m','S') AND relowner <> $1::regrole
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'funktion ' || oid::regprocedure FROM pg_proc p
     WHERE pronamespace = 'public'::regnamespace AND proowner <> $1::regrole
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
      [MIG],
    )
  ).rows.map(z => z.was);
}

async function rechteDerRolle(c, rolle = ROLLE) {
  const z = (
    await c.query(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
      (SELECT count(*)::int FROM pg_auth_members WHERE member = r.oid) AS mitglied
      FROM pg_roles r WHERE rolname = $1`,
      [rolle],
    )
  ).rows[0];
  return z;
}

/** Eine Verbindung als `nutzer`, für einen Block. */
async function als(db, nutzer, pw, fn) {
  const c = new Client({ connectionString: url(db, nutzer, pw) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

test('Datenbankrolle der App', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS.toString() });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]?.rolsuper;
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  const fassung = Number(psql.stdout?.match(/(\d+)\./)?.[1] ?? 0);
  if (!su || fassung < 15) {
    await admin.end();
    fehltVoraussetzung(t, 'kein Superuser oder psql unter 15');
    return;
  }
  await raeumeReste(admin, 'rolle');
  const alt = `${praefix}_alt`,
    neu = `${praefix}_neu`,
    umstieg = `${praefix}_umstieg`;
  t.after(async () => {
    for (const db of [alt, neu, umstieg])
      await admin.query(`DROP DATABASE IF EXISTS ${id(db)} WITH (FORCE)`).catch(() => {});
    for (const r of [ROLLE, MIG, LESEN, BOESE, SYS]) await admin.query(`DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
    await admin.end();
  });

  await t.test('bestehende Installation', async () => {
    await admin.query(`CREATE DATABASE ${id(alt)}`);
    const s = schemaAlsKonto(url(alt));
    assert.equal(s.status, 0, s.stderr);
    // NOLOGIN: app-rolle.sh schaltet die Anmeldung selbst ein; ein Rest nach
    // einem Abbruch ist so kein anmeldbarer Superuser.
    await admin.query(`CREATE ROLE ${id(ROLLE)} NOLOGIN SUPERUSER CREATEROLE`);
    await admin.query(`GRANT pg_execute_server_program TO ${id(ROLLE)}`);
    // Stand bis Runde 17: Datenbank und Tabellen gehörten der Laufzeitrolle.
    await admin.query(`ALTER DATABASE ${id(alt)} OWNER TO ${id(ROLLE)}`);
    await als(alt, null, null, c =>
      c.query(`ALTER TABLE users OWNER TO ${id(ROLLE)}; ALTER TABLE sets OWNER TO ${id(ROLLE)}`),
    );
    // Eine Kopie vor Migrationen, die noch der Superuser angelegt hat.
    const kopie = new Client({ connectionString: url(alt) });
    await kopie.connect();
    try {
      await kopie.query('CREATE SCHEMA vor_migration_20261029195422666');
      await kopie.query('CREATE TABLE vor_migration_20261029195422666.users AS TABLE public.users');
    } finally {
      await kopie.end();
    }

    const r = rolleEinrichten(alt);
    assert.equal(r.status, 0, r.stderr);
    const ohneRechte = { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, mitglied: 0 };
    assert.deepEqual(await rechteDerRolle(admin), ohneRechte);
    assert.deepEqual(await rechteDerRolle(admin, MIG), ohneRechte);
    assert.deepEqual(await rechteDerRolle(admin, SYS), { ...ohneRechte, rolbypassrls: true });
    const c = new Client({ connectionString: url(alt) });
    await c.connect();
    try {
      assert.deepEqual(await fremdBesessen(c), []);
      assert.ok(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'",
          )
        ).rows[0].n > 50,
      );
      assert.equal(
        (await c.query('SELECT pg_get_userbyid(datdba) AS e FROM pg_database WHERE datname = current_database()'))
          .rows[0].e,
        MIG,
      );
      assert.equal(
        (
          await c.query(
            `SELECT pg_get_userbyid(nspowner) AS e FROM pg_namespace WHERE nspname = 'vor_migration_20261029195422666'`,
          )
        ).rows[0].e,
        MIG,
      );
    } finally {
      await c.end();
    }

    await als(alt, MIG, MIG_PW, async mig => {
      await mig.query('ALTER TABLE users ADD COLUMN rollenprobe int');
      await mig.query('ALTER TABLE users DROP COLUMN rollenprobe');
      await assert.rejects(mig.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|must be superuser/);
    });
    await als(alt, ROLLE, PASSWORT, async app => {
      await assert.rejects(
        app.query('ALTER TABLE users ADD COLUMN rollenprobe int'),
        /must be owner/,
        'die frühere Eigentümerin ändert noch Tabellen',
      );
      await assert.rejects(app.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|must be superuser/);
      // Gelöschte Konten verschwinden auch aus den Kopien; wegräumen darf sie nur die Migrationsrolle.
      await app.query('DELETE FROM vor_migration_20261029195422666.users WHERE id = -1');
      await assert.rejects(app.query('DROP SCHEMA vor_migration_20261029195422666 CASCADE'), /must be owner/);
    });
    await als(alt, MIG, MIG_PW, mig => mig.query('DROP SCHEMA vor_migration_20261029195422666 CASCADE'));
    const m = schemaAlsKonto(url(alt, MIG, MIG_PW), 'initSchema');
    assert.equal(m.status, 0, `Schema und Migrationen als Migrationsrolle: ${m.stderr}`);
    assert.equal(rolleEinrichten(alt).status, 0, 'ein zweiter Lauf scheitert');

    const warnung = (dbUrl, env = {}) =>
      spawnSync(
        process.execPath,
        [
          '-e',
          "const m = require('./dist/db/database.js'); const db = m.erzeugeDb(m.dbKonfigAusUmgebung()); require('./dist/startup/datenbank.js').warneBeiSuperuser(db).then(w => { console.log('WARNUNG=' + w); return db.pool.end(); })",
        ],
        { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: dbUrl, ...env } },
      );
    const verbot = warnung(url(alt));
    assert.equal(verbot.status, 1, `als Superuser startet die Produktion: ${verbot.stdout}`);
    assert.match(verbot.stderr, /Superuser — Start verweigert.*DB_SUPERUSER_ERLAUBT=1/);
    assert.match(
      warnung(url(alt), { DB_SUPERUSER_ERLAUBT: '1' }).stdout,
      /WARNUNG=true/,
      'mit Ausweg warnt der Start nicht',
    );
    assert.match(warnung(url(alt, ROLLE, PASSWORT)).stdout, /WARNUNG=false/);
    assert.match(warnung(url(alt, MIG, MIG_PW)).stdout, /WARNUNG=false/);
  });

  await t.test('neue Installation', async () => {
    await admin.query(`CREATE DATABASE ${id(neu)}`);
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    const vorher = schemaAlsKonto(url(neu, ROLLE, PASSWORT));
    assert.notEqual(vorher.status, 0, 'die Laufzeitrolle startet auf einer leeren Datenbank');
    assert.match(vorher.stderr, /Die Datenbank ist leer\. Diese Rolle darf das Schema nicht ändern/);
    const s = schemaAlsKonto(url(neu, MIG, MIG_PW));
    assert.equal(s.status, 0, `das erste Schema als Migrationsrolle: ${s.stderr}`);
    const app = schemaAlsKonto(url(neu, ROLLE, PASSWORT));
    assert.equal(app.status, 0, `die Laufzeitrolle startet auf dem migrierten Schema: ${app.stderr}`);
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      assert.deepEqual(await fremdBesessen(c), []);
      assert.ok((await c.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rowCount, 'pg_trgm fehlt');
    } finally {
      await c.end();
    }
    assert.equal((await rechteDerRolle(admin)).rolsuper, false);
  });

  /** Was die Laufzeitrolle an Kontotabellen darf; die Systemrolle liest alles. */
  const kontotabellenPruefen = async db => {
    await als(db, null, null, async c => {
      await c.query(`DELETE FROM user_sessions WHERE sid = 'kt-sid'; DELETE FROM users WHERE username LIKE 'kt\\_%'`);
      const ids = [];
      for (const n of ['kt_a', 'kt_b', 'kt_c'])
        ids.push(
          (await c.query(`INSERT INTO users (username, password_hash) VALUES ($1, '$2b$10$geheim') RETURNING id`, [n]))
            .rows[0].id,
        );
      await c.query('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', ids.slice(0, 2));
      await c.query(
        `INSERT INTO account_link_invites (token_hash, main_user_id, expires_at) VALUES ('kt-einl', $1, NOW() + INTERVAL '1 day')`,
        [ids[2]],
      );
      await c.query(`INSERT INTO user_sessions (sid, sess, expire) VALUES ('kt-sid', '{}', NOW() + INTERVAL '1 day')`);
    });
    const [A, B, C] = (
      await als(db, null, null, c => c.query(`SELECT id FROM users WHERE username LIKE 'kt\\_%' ORDER BY username`))
    ).rows.map(z => z.id);
    await als(db, ROLLE, PASSWORT, async app => {
      for (const sql of ['SELECT password_hash FROM users', 'SELECT * FROM users', 'SELECT sid FROM user_sessions'])
        await assert.rejects(app.query(sql), /permission denied/, `Laufzeitrolle: ${sql}`);
      await assert.rejects(app.query(`DELETE FROM user_sessions`), /permission denied/);
      assert.equal((await app.query('SELECT username FROM users WHERE id = $1', [A])).rows[0].username, 'kt_a');
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.konto', $1, true)`, [String(C)]);
        // Sich selbst in einen fremden Haushalt eintragen hiesse dessen Zeilen sehen.
        await assert.rejects(
          app.query('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [C, A]),
          /row-level security/,
        );
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.konto', $1, true)`, [String(C)]);
        assert.equal((await app.query('DELETE FROM account_links WHERE main_user_id = $1', [A])).rowCount, 0);
        assert.equal((await app.query('SELECT 1 FROM account_links WHERE main_user_id = $1', [A])).rowCount, 1);
        assert.equal((await app.query('SELECT 1 FROM account_link_invites')).rowCount, 1, 'eigene Einladung');
        await app.query(`SELECT set_config('app.konto', $1, true)`, [String(A)]);
        assert.equal((await app.query('SELECT 1 FROM account_link_invites')).rowCount, 0, 'fremde Einladung');
        assert.equal((await app.query('DELETE FROM account_links WHERE sub_user_id = $1', [B])).rowCount, 1);
      } finally {
        await app.query('ROLLBACK');
      }
    });
    await als(db, SYS, SYS_PW, async sys => {
      assert.equal(
        (await sys.query(`SELECT password_hash FROM users WHERE id = $1`, [A])).rows[0].password_hash,
        '$2b$10$geheim',
      );
      assert.equal((await sys.query(`SELECT 1 FROM user_sessions WHERE sid = 'kt-sid'`)).rowCount, 1);
    });
    await als(db, null, null, c =>
      c.query(`DELETE FROM user_sessions WHERE sid = 'kt-sid'; DELETE FROM users WHERE username LIKE 'kt\\_%'`),
    );
  };

  await t.test('Passwort-Hashes und Sitzungen liest nur die Systemrolle, schon nach der Migration', async () => {
    // „neue Installation“ hat migriert, ohne app-rolle.sh danach: Das leistet Migration 0115 allein.
    await kontotabellenPruefen(neu);
  });

  await t.test('… und nach jedem Lauf von app-rolle.sh; Kopien vor Migrationen nur für die Systemrolle', async () => {
    await als(neu, MIG, MIG_PW, mig =>
      mig.query(`CREATE SCHEMA vor_migration_20261114000000000;
        CREATE TABLE vor_migration_20261114000000000.users AS SELECT 7 AS id, 'x' AS password_hash`),
    );
    try {
      assert.equal(rolleEinrichten(neu).status, 0);
      await kontotabellenPruefen(neu);
      const kopie = 'SELECT password_hash FROM vor_migration_20261114000000000.users';
      assert.equal((await als(neu, ROLLE, PASSWORT, app => app.query(kopie))).rowCount, 0);
      assert.equal((await als(neu, SYS, SYS_PW, sys => sys.query(kopie))).rowCount, 1);
    } finally {
      await als(neu, MIG, MIG_PW, mig => mig.query('DROP SCHEMA vor_migration_20261114000000000 CASCADE'));
    }
  });

  await t.test('die Migrationsrolle schiebt dem Superuser nichts unter', async () => {
    const app = new Client({ connectionString: url(neu, MIG, MIG_PW) });
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
      await app.query(`ALTER ROLE ${id(MIG)} IN DATABASE ${id(neu)} SET search_path = boese, pg_catalog`);
    } finally {
      await app.end();
    }
    const r = rolleEinrichten(neu);
    assert.deepEqual(
      (await admin.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [BOESE])).rows,
      [],
      'Code der Migrationsrolle lief als Superuser',
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      (
        await admin.query(
          'SELECT setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = $1',
          [neu],
        )
      ).rows,
      [],
      'Einstellungen der Migrationsrolle an der Datenbank bleiben stehen',
    );

    const app2 = new Client({ connectionString: url(neu, MIG, MIG_PW) });
    await app2.connect();
    try {
      await app2.query(`ALTER DATABASE ${id(neu)} SET role = ${id(MIG)}`);
    } finally {
      await app2.end();
    }
    const r2 = rolleEinrichten(neu);
    assert.equal(r2.status, 0, `untergeschobenes SET role: ${r2.stderr}`);
    assert.equal((await rechteDerRolle(admin, MIG)).rolsuper, false);
  });

  await t.test('Laufzeit- und Systemrolle dürfen kein DROP, ALTER oder CREATE, nur Zeilen', async () => {
    assert.equal(rolleEinrichten(neu).status, 0);
    for (const [nutzer, pw] of [
      [ROLLE, PASSWORT],
      [SYS, SYS_PW],
    ])
      await als(neu, nutzer, pw, async app => {
        for (const sql of [
          'DROP TABLE wanted',
          'ALTER TABLE users ADD COLUMN probe int',
          'ALTER TABLE users RENAME TO users2',
          'CREATE TABLE public.probe (x int)',
          'CREATE SCHEMA probe',
          'CREATE INDEX probe ON users (email)',
          'TRUNCATE wanted',
          "COMMENT ON TABLE users IS 'x'",
          'CREATE VIEW public.probe AS SELECT 1 AS x',
          'CREATE FUNCTION public.probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
          `ALTER DATABASE ${id(neu)} SET search_path = public`,
          'DROP FUNCTION IF EXISTS public.erfassung_tag() CASCADE',
          'ALTER TABLE users DISABLE TRIGGER ALL',
          'CREATE TRIGGER probe BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()',
        ])
          await assert.rejects(app.query(sql), /permission denied|must be owner/, `${nutzer} darf: ${sql}`);
        // Zeilen schreiben, Sequenzen weiterzählen, temporär anlegen: alles, was die App braucht.
        const { id: uid } = (
          await app.query(`INSERT INTO users (username, password_hash) VALUES ('laufzeitprobe', 'x') RETURNING id`)
        ).rows[0];
        await app.query(`UPDATE users SET first_name = 'L' WHERE id = $1`, [uid]);
        assert.equal((await app.query('SELECT first_name FROM users WHERE id = $1', [uid])).rows[0].first_name, 'L');
        await app.query('DELETE FROM users WHERE id = $1', [uid]);
        await app.query('CREATE TEMP TABLE probe (x int)');
      });
  });

  await t.test('der Katalog-Import tauscht als Laufzeitrolle', async () => {
    const tausch = require(path.join(ROOT, 'dist', 'src', 'katalog', 'repository', 'csvTausch.js'));
    await als(neu, ROLLE, PASSWORT, async app => {
      await tausch.sperreTabelle(app, 'rb_colors');
      try {
        await tausch.legeSchattenAn(app, 'rb_colors', 'rb_colors_import');
        await tausch.fuegeBlockEin(
          app,
          'rb_colors_import',
          ['id', 'name', 'rgb', 'is_trans'],
          [
            [9001, 'Probe-Rot', 'C91A09', false],
            [9002, 'Probe-Blau', '0055BF', false],
          ],
          ['id'],
        );
        await tausch.tausche(app, 'rb_colors', 'rb_colors_import', ['id', 'name', 'rgb', 'is_trans']);
        await tausch.entferneSchatten(app, 'rb_colors_import');
        assert.equal(await tausch.pflege(app, 'rb_colors'), true, 'VACUUM (ANALYZE) bricht ab');
      } finally {
        await tausch.gibTabelleFrei(app, 'rb_colors');
      }
      assert.deepEqual((await app.query('SELECT id, name FROM rb_colors ORDER BY id')).rows, [
        { id: 9001, name: 'Probe-Rot' },
        { id: 9002, name: 'Probe-Blau' },
      ]);
    });
    await als(neu, null, null, c => c.query('DELETE FROM rb_colors'));
  });

  await t.test('was die Migrationsrolle später anlegt, erreicht die Laufzeitrolle ohne neuen Lauf', async () => {
    await als(neu, MIG, MIG_PW, async mig => {
      await mig.query('CREATE TABLE spaeter (id serial PRIMARY KEY, x int)');
      await mig.query('CREATE SCHEMA vor_migration_20261111000000000');
      await mig.query('CREATE TABLE vor_migration_20261111000000000.users AS SELECT 7 AS id');
    });
    await als(neu, ROLLE, PASSWORT, async app => {
      assert.deepEqual((await app.query('INSERT INTO spaeter (x) VALUES (1) RETURNING id, x')).rows, [{ id: 1, x: 1 }]);
      assert.equal((await app.query('DELETE FROM vor_migration_20261111000000000.users WHERE id = 7')).rowCount, 1);
      await assert.rejects(app.query('DROP TABLE spaeter'), /must be owner/);
    });
    await als(neu, MIG, MIG_PW, mig =>
      mig.query('DROP TABLE spaeter; DROP SCHEMA vor_migration_20261111000000000 CASCADE'),
    );

    // Eine abgelaufene Kopie: Die Laufzeitrolle leert sie, wegräumen kann sie erst die Migrationsrolle.
    const { raeumeAlteSicherungenAuf } = require(path.join(ROOT, 'dist', 'db', 'migrate.js'));
    const abfrager = c => ({
      all: async (q, p) => (await c.query(q, p)).rows,
      run: async (q, p) => ({ changes: (await c.query(q, p)).rowCount }),
    });
    const ALT = 'vor_migration_20200101000000000';
    await als(neu, MIG, MIG_PW, mig => mig.query(`CREATE SCHEMA ${ALT}; CREATE TABLE ${ALT}.users AS SELECT 7 AS id`));
    assert.equal(await als(neu, ROLLE, PASSWORT, app => raeumeAlteSicherungenAuf(abfrager(app))), 1);
    assert.deepEqual(
      (await als(neu, null, null, c => c.query(`SELECT count(*)::int AS n FROM ${ALT}.users`))).rows,
      [{ n: 0 }],
      'ein gelöschtes Konto lebt in der abgelaufenen Kopie weiter',
    );
    assert.equal(await als(neu, MIG, MIG_PW, mig => raeumeAlteSicherungenAuf(abfrager(mig))), 1);
    assert.equal(
      (await als(neu, null, null, c => c.query(`SELECT 1 FROM pg_namespace WHERE nspname = '${ALT}'`))).rowCount,
      0,
    );
  });

  await t.test('die Laufzeitrolle startet nicht auf einem Schema mit offenen Migrationen', async () => {
    const letzte = (await als(neu, MIG, MIG_PW, mig => mig.query('SELECT max(name) AS n FROM schema_migrations')))
      .rows[0].n;
    await als(neu, MIG, MIG_PW, mig =>
      mig.query(`UPDATE schema_migrations SET name = name || '.weg' WHERE name = $1`, [letzte]),
    );
    try {
      const r = schemaAlsKonto(url(neu, ROLLE, PASSWORT));
      assert.notEqual(r.status, 0, 'gestartet trotz offener Migration');
      assert.match(r.stderr, new RegExp(`Migrationen offen: ${letzte.replace(/\./g, '\\.')}\\..*Dienst migration`));
    } finally {
      await als(neu, MIG, MIG_PW, mig =>
        mig.query(`UPDATE schema_migrations SET name = $1 WHERE name = $1 || '.weg'`, [letzte]),
      );
    }
    const m = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'startup', 'migrieren.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url(neu, ROLLE, PASSWORT) },
    });
    assert.notEqual(m.status, 0, 'der Dienst migration meldet als Laufzeitrolle Erfolg');
    assert.match(m.stderr, /PGUSER muss die Migrationsrolle sein/);
    const ok = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'startup', 'migrieren.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url(neu, MIG, MIG_PW) },
    });
    assert.equal(ok.status, 0, ok.stderr);
  });

  await t.test('die Leserolle sieht keine Geheimnisse', async () => {
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      await c.query(
        `INSERT INTO users (username, password_hash, reset_token) VALUES ('leseprobe', '$2b$10$geheim', 'rt')`,
      );
      await c.query(`INSERT INTO api_tokens (token, user_id) SELECT 'tok', id FROM users WHERE username = 'leseprobe'`);
    } finally {
      await c.end();
    }
    assert.equal(rolleEinrichten(neu).status, 0, 'Rechte für neue Tabellen');
    const l = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l.connect();
    try {
      assert.deepEqual((await l.query(`SELECT username, is_admin FROM users WHERE username = 'leseprobe'`)).rows, [
        { username: 'leseprobe', is_admin: false },
      ]);
      for (const sql of [
        'SELECT password_hash FROM users',
        'SELECT reset_token FROM users',
        'SELECT * FROM users',
        'SELECT token FROM api_tokens',
        'SELECT token FROM api_tokens_verbraucht',
        'SELECT sid FROM user_sessions',
        'SELECT geheimnis FROM zweiter_faktor',
        'SELECT value FROM global_settings',
      ])
        await assert.rejects(l.query(sql), /permission denied/, sql);
      await assert.rejects(l.query(`UPDATE users SET is_admin = true`), /read-only|permission denied/);
      await l.query('SET TRANSACTION READ WRITE').catch(() => {});
      await assert.rejects(l.query(`CREATE TABLE public.probe (x int)`), /permission denied|read-only/);
      await assert.rejects(
        l.query(`COPY (SELECT 1) TO PROGRAM 'true'`),
        /permission denied|must be superuser|read-only/,
      );
      await l.query('SET default_transaction_read_only = off');
      await assert.rejects(
        l.query('CREATE TEMP TABLE probe (x int)'),
        /permission denied/,
        'die Leserolle legt temporäre Tabellen an',
      );
    } finally {
      await l.end();
    }
    const app = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app.connect();
    try {
      await app.query('CREATE TEMP TABLE probe (x int)');
    } finally {
      await app.end();
    }
    const ohne = rolleEinrichten(neu, { PGWEB_DB_PASSWORD: '' });
    assert.equal(ohne.status, 0, ohne.stderr);
    assert.equal(
      (await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [LESEN])).rows[0].rolcanlogin,
      false,
      'ohne PGWEB_DB_PASSWORD meldet sich die Leserolle nicht an',
    );
    const gleich = rolleEinrichten(neu, { PGWEB_DB_PASSWORD: PASSWORT });
    assert.notEqual(gleich.status, 0);
    assert.match(gleich.stderr, /PGWEB_DB_PASSWORD muss sich/);
  });

  await t.test('die Leserolle liest genau die Allowlist', async () => {
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    // Jede Spalte der Allowlist gibt es im aktuellen Schema (sonst meldet das Skript sie).
    assert.doesNotMatch(r.stderr, /fehlt eine der Spalten/, r.stderr);
    const lesbar = async tabelle => {
      const c = new Client({ connectionString: url(neu) });
      await c.connect();
      try {
        return (
          await c.query(
            `SELECT a.attname::text AS n FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0
          AND NOT a.attisdropped AND has_column_privilege($2, a.attrelid, a.attnum, 'SELECT') ORDER BY a.attnum`,
            [tabelle, LESEN],
          )
        ).rows.map(z => z.n);
      } finally {
        await c.end();
      }
    };
    assert.deepEqual(await lesbar('users'), [
      'id',
      'username',
      'email',
      'first_name',
      'last_name',
      'is_admin',
      'is_active',
      'email_verified',
      'token_expires',
      'reset_token_expires',
      'must_change_password',
      'created_at',
      'sitzungs_version',
    ]);
    assert.deepEqual(await lesbar('vouchers'), [
      'id',
      'user_id',
      'amount',
      'currency',
      'pdf_path',
      'created_at',
      'updated_at',
      'guthaben_geprueft_am',
    ]);
    for (const t of [
      'api_tokens',
      'api_tokens_verbraucht',
      'user_sessions',
      'qr_login_tokens',
      'webauthn_challenges',
      'zweiter_faktor_codes',
      'account_link_invites',
      'idempotenz',
    ])
      assert.deepEqual(await lesbar(t), [], `${t} ist für die Leserolle lesbar`);
  });

  await t.test('der Zeilenschutz gilt für die Laufzeitrolle, nicht für System- und Leserolle', async () => {
    await als(neu, null, null, c =>
      c.query(`INSERT INTO sets (user_id, set_number) SELECT id, '10001-1' FROM users WHERE username = 'leseprobe'`),
    );
    const zaehle = c => c.query('SELECT count(id)::int AS n FROM sets').then(r => r.rows[0].n);
    await als(neu, ROLLE, PASSWORT, async app => {
      assert.equal(await zaehle(app), 0, 'ohne Konto sieht die Laufzeitrolle keine Zeile');
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.konto', (SELECT id FROM users WHERE username = 'leseprobe')::text, true)`,
      );
      assert.equal(await zaehle(app), 1, 'mit Konto sieht sie dessen Zeile');
      await app.query('COMMIT');
    });
    await als(neu, ROLLE, PASSWORT, async app => {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.system', 'an', true)`);
      assert.equal(await zaehle(app), 0, 'app.system schaltet den Zeilenschutz nicht mehr ab');
      await app.query('COMMIT');
    });
    await als(neu, SYS, SYS_PW, async s => assert.equal(await zaehle(s), 1, 'die Systemrolle sieht alle Zeilen'));
    await als(neu, LESEN, LESEN_PW, async l => assert.equal(await zaehle(l), 1, 'pgweb sieht alle Zeilen'));
  });

  await t.test('neue Spalten und Tabellen bleiben unlesbar, bis die Allowlist sie nennt', async () => {
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      await c.query('ALTER TABLE users ADD COLUMN neues_geheimnis text');
      await c.query(`UPDATE users SET neues_geheimnis = 'streng geheim'`);
      await c.query('CREATE TABLE neue_tabelle (id int, geheim text)');
      await c.query(`INSERT INTO neue_tabelle VALUES (1, 'streng geheim')`);
    } finally {
      await c.end();
    }
    const r = rolleEinrichten(neu);
    assert.equal(r.status, 0, r.stderr);
    const l = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l.connect();
    try {
      assert.ok(
        (await l.query(`SELECT username FROM users WHERE username = 'leseprobe'`)).rowCount,
        'Vorbedingung: users ist lesbar',
      );
      await assert.rejects(l.query('SELECT neues_geheimnis FROM users'), /permission denied/, 'neue Spalte lesbar');
      await assert.rejects(l.query('SELECT * FROM neue_tabelle'), /permission denied/, 'neue Tabelle lesbar');
    } finally {
      await l.end();
    }
    // Erst ein Eintrag in der Allowlist gibt die Spalte frei (Kopie des Skripts mit erweiterter Zeile).
    const fsm = require('node:fs'),
      osm = require('node:os');
    const kopie = path.join(fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-liste-')), 'app-rolle.sh');
    const quelle = fsm.readFileSync(SKRIPT, 'utf8');
    assert.match(quelle, /^users: id, username, /m);
    fsm.writeFileSync(kopie, quelle.replace(/^(users: .*)$/m, '$1, neues_geheimnis'));
    const mit = spawnSync('sh', [kopie], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGHOST: BASIS.hostname,
        PGPORT: BASIS.port || '5432',
        PGUSER: decodeURIComponent(BASIS.username),
        PGPASSWORD: decodeURIComponent(BASIS.password),
        PGDATABASE: neu,
        DB_APP_USER: ROLLE,
        DB_APP_PASSWORD: PASSWORT,
        DB_MIGRATION_USER: MIG,
        DB_MIGRATION_PASSWORD: MIG_PW,
        DB_LESEN_USER: LESEN,
        PGWEB_DB_PASSWORD: LESEN_PW,
        DB_SYSTEM_USER: SYS,
        DB_SYSTEM_PASSWORD: SYS_PW,
      },
    });
    fsm.rmSync(path.dirname(kopie), { recursive: true, force: true });
    assert.equal(mit.status, 0, mit.stderr);
    const l2 = new Client({ connectionString: url(neu, LESEN, LESEN_PW) });
    await l2.connect();
    try {
      assert.deepEqual((await l2.query(`SELECT neues_geheimnis FROM users WHERE username = 'leseprobe'`)).rows, [
        { neues_geheimnis: 'streng geheim' },
      ]);
      await assert.rejects(l2.query('SELECT * FROM neue_tabelle'), /permission denied/, 'neue Tabelle lesbar');
    } finally {
      await l2.end();
    }
    const c2 = new Client({ connectionString: url(neu) });
    await c2.connect();
    try {
      await c2.query('ALTER TABLE users DROP COLUMN neues_geheimnis');
      await c2.query('DROP TABLE neue_tabelle');
    } finally {
      await c2.end();
    }
    assert.equal(rolleEinrichten(neu).status, 0);
  });

  await t.test('Passwörter aus Dateien (Docker-Secrets)', async tt => {
    const fsm = require('node:fs'),
      osm = require('node:os');
    const ordner = fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-geheim-'));
    tt.after(() => fsm.rmSync(ordner, { recursive: true, force: true }));
    const datei = (name, wert) => {
      const f = path.join(ordner, name);
      fsm.writeFileSync(f, wert + '\n');
      return f;
    };
    const umgebung = {
      DB_APP_PASSWORD_FILE: datei('app', PASSWORT),
      PGWEB_DB_PASSWORD_FILE: datei('lesen', LESEN_PW),
      DB_MIGRATION_PASSWORD_FILE: datei('mig', MIG_PW),
      DB_SYSTEM_PASSWORD_FILE: datei('sys', SYS_PW),
      PGPASSWORD_FILE: datei('su', decodeURIComponent(BASIS.password)),
    };
    const ohneWerte = mehr => {
      const env = {
        ...process.env,
        PGHOST: BASIS.hostname,
        PGPORT: BASIS.port || '5432',
        PGUSER: decodeURIComponent(BASIS.username),
        PGDATABASE: neu,
        DB_APP_USER: ROLLE,
        DB_MIGRATION_USER: MIG,
        DB_LESEN_USER: LESEN,
        DB_SYSTEM_USER: SYS,
        ...umgebung,
        ...mehr,
      };
      for (const k of [
        'PGPASSWORD',
        'DB_APP_PASSWORD',
        'DB_MIGRATION_PASSWORD',
        'PGWEB_DB_PASSWORD',
        'DB_SYSTEM_PASSWORD',
      ])
        if (!(k in mehr)) delete env[k];
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
    await als(neu, MIG, MIG_PW, () => {});
    await als(neu, SYS, SYS_PW, () => {});
    const ohneSys = ohneWerte({ DB_SYSTEM_PASSWORD_FILE: '' });
    assert.notEqual(ohneSys.status, 0);
    assert.match(ohneSys.stderr, /DB_SYSTEM_PASSWORD fehlt/);
    const ohneMig = ohneWerte({ DB_MIGRATION_PASSWORD_FILE: '' });
    assert.notEqual(ohneMig.status, 0);
    assert.match(ohneMig.stderr, /DB_MIGRATION_PASSWORD fehlt/);
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
    const m = rolleEinrichten(neu, { DB_MIGRATION_PASSWORD: PASSWORT });
    assert.notEqual(m.status, 0);
    assert.match(m.stderr, /DB_MIGRATION_PASSWORD muss sich von DB_PASSWORD und DB_APP_PASSWORD unterscheiden/);
    const sys = rolleEinrichten(neu, { DB_SYSTEM_PASSWORD: PASSWORT });
    assert.notEqual(sys.status, 0);
    assert.match(sys.stderr, /DB_SYSTEM_PASSWORD muss sich von DB_PASSWORD, DB_APP_PASSWORD und DB_MIGRATION_PASSWORD/);
  });

  // `docker` ist ein Stellvertreter: db-rolle und migration laufen wirklich gegen die Test-DB.
  await t.test(
    'scripts/rollen-trennen.sh stellt eine Installation mit App-Rolle als Eigentümerin um, wiederholbar',
    async tt => {
      const fsm = require('node:fs'),
        osm = require('node:os');
      const ort = fsm.mkdtempSync(path.join(osm.tmpdir(), 'rollen-trennen-'));
      tt.after(() => fsm.rmSync(ort, { recursive: true, force: true }));
      await admin.query(`CREATE DATABASE ${id(umstieg)}`);
      const s = schemaAlsKonto(url(umstieg));
      assert.equal(s.status, 0, s.stderr);
      // Stand bis Runde 17: Datenbank und Tabellen gehören der Laufzeitrolle.
      await admin.query(`ALTER DATABASE ${id(umstieg)} OWNER TO ${id(ROLLE)}`);
      await als(umstieg, null, null, c =>
        c.query(`ALTER TABLE users OWNER TO ${id(ROLLE)}; ALTER TABLE sets OWNER TO ${id(ROLLE)}`),
      );

      fsm.mkdirSync(path.join(ort, 'geheimnisse'), { mode: 0o700 });
      for (const [n, w] of [
        ['db_password', decodeURIComponent(BASIS.password)],
        ['db_app_password', PASSWORT],
        ['session_secret', 'x'.repeat(48)],
        ['pgweb_db_password', LESEN_PW],
      ])
        fsm.writeFileSync(path.join(ort, 'geheimnisse', n), w);
      fsm.copyFileSync(path.join(ROOT, 'compose.yaml'), path.join(ort, 'compose.yaml'));
      const bin = path.join(ort, 'bin'),
        log = path.join(ort, 'docker.log'),
        g = path.join(ort, 'geheimnisse');
      fsm.mkdirSync(bin);
      fsm.writeFileSync(
        path.join(bin, 'docker'),
        `#!/bin/sh
echo "$*" >> '${log}'
case "$2 $4" in
  up*) exit 0 ;;
  'run db-rolle') DB_APP_PASSWORD_FILE='${g}/db_app_password' DB_MIGRATION_PASSWORD_FILE='${g}/db_migration_password' \
       PGWEB_DB_PASSWORD_FILE='${g}/pgweb_db_password' \
       DB_SYSTEM_PASSWORD_FILE='${g}/db_system_password' exec sh '${SKRIPT}' ;;
  'run migration') cd '${ROOT}' && DATABASE_URL="postgres://${MIG}:$(cat '${g}/db_migration_password')@${BASIS.host}/${umstieg}" \
       exec '${process.execPath}' dist/startup/migrieren.js ;;
  exec*) shift 6; PGPASSWORD="$(cat '${g}/db_password')" PGOPTIONS='-c search_path=pg_catalog,pg_temp' exec psql -h '${BASIS.hostname}' -p '${BASIS.port || 5432}' "$@" ;;
  *) echo "unbekannt: $*" >&2; exit 9 ;;
esac
`,
        { mode: 0o755 },
      );
      const lauf = () =>
        spawnSync('sh', [path.join(ROOT, 'scripts', 'rollen-trennen.sh')], {
          cwd: ort,
          encoding: 'utf8',
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            HOME: process.env.HOME,
            NODE_ENV: 'test',
            PGHOST: BASIS.hostname,
            PGPORT: BASIS.port || '5432',
            PGUSER: decodeURIComponent(BASIS.username),
            PGDATABASE: umstieg,
            DB_SUPERUSER: decodeURIComponent(BASIS.username),
            DB_APP_USER: ROLLE,
            DB_MIGRATION_USER: MIG,
            DB_LESEN_USER: LESEN,
            DB_SYSTEM_USER: SYS,
            PGPASSWORD_FILE: path.join(g, 'db_password'),
          },
        });
      const r = lauf();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`${MIG} besitzt alles, ${ROLLE} schreibt nur Zeilen`));
      assert.deepEqual(
        fsm
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(z => z.split(' ').slice(1, 4).join(' ')),
        ['up -d postgres', 'run --rm db-rolle', 'run --rm migration', 'exec -T -e', 'up -d'],
      );
      await als(umstieg, ROLLE, PASSWORT, app =>
        assert.rejects(app.query('ALTER TABLE users ADD COLUMN probe int'), /must be owner/),
      );
      const pw = fsm.readFileSync(path.join(g, 'db_migration_password'), 'utf8');
      const zweiter = lauf();
      assert.equal(zweiter.status, 0, zweiter.stdout + zweiter.stderr);
      assert.equal(
        fsm.readFileSync(path.join(g, 'db_migration_password'), 'utf8'),
        pw,
        'ein zweiter Lauf erzeugt ein neues Passwort',
      );
    },
  );
});
