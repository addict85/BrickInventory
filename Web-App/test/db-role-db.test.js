/**
 * postgres/app-rolle.sh: the migration role owns everything, the runtime role
 * of app and jobs only reads and writes rows; both without superuser rights.
 * Checked on an existing installation (objects belong to the superuser or
 * still to the runtime role with too many rights) and on a new one; migration
 * happens as the migration role, the runtime role only checks the state.
 *
 * Counter-checks (measured on 02.11.2026):
 *   A  the loop over pg_class removed in the script → red: “existing
 *      installation” (tables still belong to the superuser, ALTER TABLE as
 *      app fails)
 *   B  NOSUPERUSER replaced by SUPERUSER → red: “existing installation”
 *      and “new installation” (rolsuper)
 *   C  the REVOKE loop removed → red: “existing installation”
 *      (pg_execute_server_program stays, COPY … PROGRAM works)
 *   D  the comparison with the superuser password removed → red: “an equal
 *      password is rejected”
 *   E  in warnAtSuperuser() rolsuper no longer respected → red:
 *      “existing installation” (the start also warns as app role)
 *   O  (04.11.2026) in warnAtSuperuser() the start ban without
 *      DB_SUPERUSER_ERLAUBT deleted → red: “existing installation”
 *      (production starts as superuser)
 *   F  PGOPTIONS and `SET search_path` removed → red: “the migration role
 *      slips nothing under the superuser” (an operator of the role creates a
 *      superuser role)
 *   G  `ALTER DATABASE … RESET ALL` removed → red: the same check
 *      (the database's search_path stays for later superuser sessions)
 *   H  `-c role=none` and `SET ROLE NONE` removed → red: the same check
 *      (“slipped-in SET role”: the session runs as the migration role)
 *   I  `password_hash` deleted from the read role's block list → red:
 *      “the read role sees no secrets”
 *   J  (03.11.2026) `REVOKE TEMPORARY … FROM PUBLIC` deleted → red:
 *      “the read role creates temporary tables”
 *   K  (03.11.2026) `api_tokens_consumed` deleted from the block list →
 *      red: “SELECT token FROM api_tokens_consumed”
 *   L  (03.11.2026, allowlist) `password_hash` added to the line `users:` of
 *      LESEN_SPALTEN → red: “the read role sees no secrets”
 *      (SELECT password_hash succeeds) and “… reads exactly the allowlist”
 *   M  the allowlist loop replaced by the old block list (all columns
 *      except the known secrets) → red: “new columns and tables
 *      stay unreadable” (users.neues_geheimnis readable)
 *   N  in app-rolle.sh `aus_datei DB_APP_PASSWORD` deleted → red:
 *      “passwords from files” (DB_APP_PASSWORD missing)
 *   P  (06.11.2026) the loop over vor_migration_* removed → red:
 *      “existing installation” (permission denied for schema vor_migration_…)
 *   Separate migration role (11.11.2026, each alone; F–H repeated the same day
 *   against the migration role, which can now create functions):
 *   Q  the default privileges for tables deleted → red: “new installation”
 *      (permission denied for table schema_migrations) and “what the
 *      migration role creates later …” (permission denied for table spaeter)
 *   R  `GRANT CONNECT, TEMPORARY` → only CONNECT → red: “… may not DROP …”,
 *      “the catalog import swaps as runtime role” (temporary tables)
 *   S  csvTausch.ts again `CREATE UNLOGGED TABLE` → red: “the catalog import
 *      swaps as runtime role” (permission denied for schema public)
 *   T  the database handed back to the runtime role → red: “existing
 *      installation”, “new installation”, “… may not DROP …”
 *   U  in initSchemaOnce the branch for roles without CREATE deleted → red:
 *      “new installation” (no message “Die Datenbank ist leer …”)
 *   V  in startup/migrate.ts the check changeMaySchema() deleted →
 *      red: “… open migrations” (the service reports success as runtime role)
 *   W  in scripts/rollen-trennen.sh `docker compose run --rm db-rolle`
 *      deleted → red: “scripts/rollen-trennen.sh converts …”
 *   X  TRUNCATE added for the runtime role → red: “… may not DROP …”
 *      (Missing expected rejection: TRUNCATE wanted)
 *   Y  in cleanOldBackupsOn the emptying for foreign copies deleted →
 *      red: “what the migration role creates later …” (0 instead of 1 emptied)
 *   Z  (13.11.2026) the read role again NOBYPASSRLS → red: “row security
 *      applies to the runtime role …” (pgweb sees 0 rows); likewise with
 *      `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` before the check (the
 *      runtime role sees 1 row without an account)
 *   System role (13.11.2026, each alone):
 *   AA the system role NOBYPASSRLS → red: “existing installation”
 *      (rolbypassrls) and “row security applies …” (system role sees 0)
 *   AB `aus_datei DB_SYSTEM_PASSWORD` deleted → red: “passwords from
 *      files” and “scripts/rollen-trennen.sh …” (DB_SYSTEM_PASSWORD missing)
 *   AC privileges granted only to the runtime role → red: “runtime
 *      and system role may …” and “row security applies …” (permission denied)
 *
 *   Account tables (14.11.2026, each alone):
 *   AD in 0115 the loop over the roles deleted → red: “… already after the
 *      migration” (SELECT password_hash succeeds for the runtime role)
 *   AE in app-rolle.sh the block for users/user_sessions deleted → red: “… and
 *      after every run of app-rolle.sh …” (GRANT ON ALL TABLES gives both back)
 *   AF the policy `lesen` on account_links for all commands (without `FOR SELECT`) →
 *      red: both (the INSERT into the foreign household succeeds)
 *   AG in app-rolle.sh the loop over vor_migration_* for RLS deleted → red:
 *      “… copies before migrations …” (the runtime role reads the copy's hash)
 *
 *   Only the system role writes credentials (migration 0117, measured 14.11.2026, each alone):
 *   AH in 0117 the loop over the roles run empty (`AND false`) → red: “… already
 *      after the migration” (the runtime role sets is_admin, the log is deletable)
 *   AI in app-rolle.sh the REVOKE on users deleted → red: “… and after every run …”
 *      (GRANT ON ALL TABLES gives INSERT/UPDATE/DELETE back)
 *   AJ verwaltungsprotokoll_aufraeumen() as SECURITY INVOKER → red: both (the system role
 *      may not delete itself, the cleanup fails)
 *   AK in app-rolle.sh the REVOKE on admin_log only for the runtime role → red:
 *      “… and after every run …” (the system role deletes log lines)
 *
 * Prerequisite: TEST_DATABASE_URL with superuser (creates databases and a
 * role) and psql from version 15 (\getenv).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { keineDb, missingPrecondition } = require('./helpers/db');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'postgres', 'app-rolle.sh');
const BASIS = new URL(
  process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest',
);
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
require('./helpers/sources').buildAndRequire();

const { testName, cleanRemainder } = require('./helpers/test-names');
const praefix = testName('rolle');
const ROLLE = `${praefix}_app`.toLowerCase();
const MIG = `${praefix}_mig`.toLowerCase();
const LESEN = `${praefix}_lesen`.toLowerCase();
const BOESE = `${praefix}_boese`.toLowerCase();
const SYS = `${praefix}_sys`.toLowerCase();
const SYSWEB = `${praefix}_sysweb`.toLowerCase();
const SYS_PW = `sys-${process.pid}-geheim`;
const READ_PW = `lesen-${process.pid}-geheim`;
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

function setUpRole(db, mehr = {}) {
  return spawnSync('sh', [SCRIPT], {
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
      PGWEB_DB_PASSWORD: READ_PW,
      DB_SYSTEM_USER: SYS,
      DB_SYSTEM_WEB_USER: SYSWEB,
      DB_SYSTEM_PASSWORD: SYS_PW,
      ...mehr,
    },
  });
}

/** Schema and migrations in their own process, as at startup. */
function schemaAsAccount(dbUrl, call = 'initSchemaOnce') {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const m = require('./dist/db/database.js'); const db = m.createDb(m.dbConfigFromEnvironment()); db.${call}().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); })`,
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: dbUrl } },
  );
}

async function foreignOwned(c) {
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

async function rightsTheRole(c, rolle = ROLLE) {
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

/** A connection as `nutzer`, for one block. */
async function als(db, nutzer, pw, fn) {
  const c = new Client({ connectionString: url(db, nutzer, pw) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

test('database role of the app', { concurrency: 1, timeout: 180_000 }, async t => {
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
    missingPrecondition(t, 'kein Superuser oder psql unter 15');
    return;
  }
  await cleanRemainder(admin, 'rolle');
  const alt = `${praefix}_alt`,
    neu = `${praefix}_neu`,
    migration = `${praefix}_umstieg`;
  t.after(async () => {
    for (const db of [alt, neu, migration])
      await admin.query(`DROP DATABASE IF EXISTS ${id(db)} WITH (FORCE)`).catch(() => {});
    for (const r of [ROLLE, MIG, LESEN, BOESE, SYS]) await admin.query(`DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
    await admin.end();
  });

  await t.test('existing installation', async () => {
    await admin.query(`CREATE DATABASE ${id(alt)}`);
    const s = schemaAsAccount(url(alt));
    assert.equal(s.status, 0, s.stderr);
    // NOLOGIN: app-rolle.sh switches on the login itself; a leftover after
    // an abort is thus not a superuser one can log in as.
    await admin.query(`CREATE ROLE ${id(ROLLE)} NOLOGIN SUPERUSER CREATEROLE`);
    await admin.query(`GRANT pg_execute_server_program TO ${id(ROLLE)}`);
    // State up to round 17: database and tables belonged to the runtime role.
    await admin.query(`ALTER DATABASE ${id(alt)} OWNER TO ${id(ROLLE)}`);
    await als(alt, null, null, c =>
      c.query(`ALTER TABLE users OWNER TO ${id(ROLLE)}; ALTER TABLE sets OWNER TO ${id(ROLLE)}`),
    );
    // A copy before migrations that the superuser still created.
    const kopie = new Client({ connectionString: url(alt) });
    await kopie.connect();
    try {
      await kopie.query('CREATE SCHEMA vor_migration_20261029195422666');
      await kopie.query('CREATE TABLE vor_migration_20261029195422666.users AS TABLE public.users');
    } finally {
      await kopie.end();
    }

    const r = setUpRole(alt);
    assert.equal(r.status, 0, r.stderr);
    const withoutRights = {
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      mitglied: 0,
    };
    assert.deepEqual(await rightsTheRole(admin), withoutRights);
    assert.deepEqual(await rightsTheRole(admin, MIG), withoutRights);
    assert.deepEqual(await rightsTheRole(admin, SYS), { ...withoutRights, rolbypassrls: true });
    const c = new Client({ connectionString: url(alt) });
    await c.connect();
    try {
      assert.deepEqual(await foreignOwned(c), []);
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
      // Deleted accounts also disappear from the copies; only the migration role may remove them.
      await app.query('DELETE FROM vor_migration_20261029195422666.users WHERE id = -1');
      await assert.rejects(app.query('DROP SCHEMA vor_migration_20261029195422666 CASCADE'), /must be owner/);
    });
    await als(alt, MIG, MIG_PW, mig => mig.query('DROP SCHEMA vor_migration_20261029195422666 CASCADE'));
    const m = schemaAsAccount(url(alt, MIG, MIG_PW), 'initSchema');
    assert.equal(m.status, 0, `Schema und Migrationen als Migrationsrolle: ${m.stderr}`);
    assert.equal(setUpRole(alt).status, 0, 'ein zweiter Lauf scheitert');

    const warnung = (dbUrl, env = {}) =>
      spawnSync(
        process.execPath,
        [
          '-e',
          "const m = require('./dist/db/database.js'); const db = m.createDb(m.dbConfigFromEnvironment()); require('./dist/startup/database.js').warnAtSuperuser(db).then(w => { console.log('WARNUNG=' + w); return db.pool.end(); })",
        ],
        { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: dbUrl, ...env } },
      );
    const ban = warnung(url(alt));
    assert.equal(ban.status, 1, `als Superuser startet die Produktion: ${ban.stdout}`);
    assert.match(ban.stderr, /Superuser — Start verweigert.*DB_SUPERUSER_ERLAUBT=1/);
    assert.match(
      warnung(url(alt), { DB_SUPERUSER_ERLAUBT: '1' }).stdout,
      /WARNUNG=true/,
      'mit Ausweg warnt der Start nicht',
    );
    assert.match(warnung(url(alt, ROLLE, PASSWORT)).stdout, /WARNUNG=false/);
    assert.match(warnung(url(alt, MIG, MIG_PW)).stdout, /WARNUNG=false/);
  });

  await t.test('new installation', async () => {
    await admin.query(`CREATE DATABASE ${id(neu)}`);
    const r = setUpRole(neu);
    assert.equal(r.status, 0, r.stderr);
    const vorher = schemaAsAccount(url(neu, ROLLE, PASSWORT));
    assert.notEqual(vorher.status, 0, 'die Laufzeitrolle startet auf einer leeren Datenbank');
    assert.match(vorher.stderr, /Die Datenbank ist leer\. Diese Rolle darf das Schema nicht ändern/);
    const s = schemaAsAccount(url(neu, MIG, MIG_PW));
    assert.equal(s.status, 0, `das erste Schema als Migrationsrolle: ${s.stderr}`);
    const app = schemaAsAccount(url(neu, ROLLE, PASSWORT));
    assert.equal(app.status, 0, `die Laufzeitrolle startet auf dem migrierten Schema: ${app.stderr}`);
    const c = new Client({ connectionString: url(neu) });
    await c.connect();
    try {
      assert.deepEqual(await foreignOwned(c), []);
      assert.ok((await c.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rowCount, 'pg_trgm fehlt');
    } finally {
      await c.end();
    }
    assert.equal((await rightsTheRole(admin)).rolsuper, false);
  });

  /** Exactly these write privileges (0117): credentials, global settings and the log. */
  const checkAccessRights = async (db, konto) => {
    const frage = (rolle, objekt, type, funktion) =>
      als(db, null, null, c =>
        c
          .query(
            funktion
              ? 'SELECT has_function_privilege($1, $2, $3) AS ja'
              : 'SELECT has_table_privilege($1, $2, $3) AS ja',
            [rolle, objekt, type],
          )
          .then(r => r.rows[0].ja),
      );
    const ist = {};
    for (const [rolle, kurz] of [
      [ROLLE, 'app'],
      [SYS, 'sys'],
    ]) {
      for (const tabelle of ['users', 'global_settings', 'admin_log'])
        for (const type of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
          ist[`${kurz} ${tabelle} ${type}`] = await frage(rolle, `public.${tabelle}`, type);
      ist[`${kurz} aufraeumen EXECUTE`] = await frage(
        rolle,
        'public.verwaltungsprotokoll_aufraeumen()',
        'EXECUTE',
        true,
      );
    }
    const soll = {};
    for (const k of Object.keys(ist)) soll[k] = false;
    // Table-wide (has_table_privilege only checks whole tables here; the runtime role has SELECT on users
    // column-wise without password_hash, see above).
    for (const k of ['app global_settings SELECT', 'app admin_log SELECT', 'app admin_log INSERT']) soll[k] = true;
    for (const t of ['users', 'global_settings'])
      for (const a of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) soll[`sys ${t} ${a}`] = true;
    for (const k of ['sys admin_log SELECT', 'sys admin_log INSERT', 'sys aufraeumen EXECUTE']) soll[k] = true;
    assert.deepEqual(ist, soll);
    const spalten = (
      await als(db, null, null, c =>
        c.query(
          `SELECT a.attname FROM pg_attribute a WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0
              AND NOT a.attisdropped AND has_column_privilege($1, 'public.users', a.attname, 'UPDATE') ORDER BY 1`,
          [ROLLE],
        ),
      )
    ).rows.map(z => z.attname);
    assert.deepEqual(spalten, ['first_name', 'last_name'], 'in users schreibt die Laufzeitrolle nur die Namen');

    // And the way an injected query tried it:
    await als(db, ROLLE, PASSWORT, async app => {
      for (const sql of [
        'UPDATE users SET is_admin = true WHERE id = $1',
        "UPDATE users SET password_hash = 'x' WHERE id = $1",
        "UPDATE users SET email = 'boese@example.org' WHERE id = $1",
        'UPDATE users SET session_version = 0 WHERE id = $1',
        'DELETE FROM users WHERE id = $1',
        'DELETE FROM admin_log WHERE target_id = $1',
        "UPDATE admin_log SET action = 'x' WHERE target_id = $1",
        "INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1::text)",
        'SELECT verwaltungsprotokoll_aufraeumen() WHERE $1::int > 0',
      ])
        await assert.rejects(app.query(sql, [konto]), /permission denied/, `Laufzeitrolle: ${sql}`);
      // The name only on the own account (0121): without an account no row, with an account the own one.
      assert.equal((await app.query(`UPDATE users SET first_name = 'Neu' WHERE id = $1`, [konto])).rowCount, 0);
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.konto', $1, true)`, [String(konto)]);
      assert.equal((await app.query(`UPDATE users SET first_name = 'Neu' WHERE id = $1`, [konto])).rowCount, 1);
      await app.query('COMMIT');
      await app.query(`INSERT INTO admin_log (target_id, action) VALUES ($1, 'probe')`, [konto]);
    });
    await als(db, SYS, SYS_PW, async sys => {
      await sys.query(
        `INSERT INTO admin_log (occurred_at, target_id, action) VALUES (NOW() - INTERVAL '400 days', $1, 'alt')`,
        [konto],
      );
      for (const sql of [
        'DELETE FROM admin_log WHERE target_id = $1',
        "UPDATE admin_log SET action = 'x' WHERE target_id = $1",
      ])
        await assert.rejects(sys.query(sql, [konto]), /permission denied/, `Systemrolle: ${sql}`);
      assert.ok((await sys.query('SELECT verwaltungsprotokoll_aufraeumen() AS n')).rows[0].n >= 1);
      assert.deepEqual(
        (await sys.query('SELECT action FROM admin_log WHERE target_id = $1 ORDER BY action', [konto])).rows,
        [{ action: 'probe' }],
        'die feste Frist nimmt nur die alte Zeile',
      );
    });
    await als(db, null, null, c => c.query('DELETE FROM admin_log WHERE target_id = $1', [konto]));
  };

  /** What the runtime role may do on account tables; the system role reads everything. */
  const checkAccountTables = async db => {
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
      for (const sql of [
        'SELECT password_hash FROM users',
        'SELECT * FROM users',
        'SELECT email FROM users',
        'SELECT reset_token FROM users',
        'SELECT sid FROM user_sessions',
      ])
        await assert.rejects(app.query(sql), /permission denied/, `Laufzeitrolle: ${sql}`);
      await assert.rejects(app.query(`DELETE FROM user_sessions`), /permission denied/);
      // Without an account no row, with an account the own one (0121).
      assert.equal((await app.query('SELECT username FROM users WHERE id = $1', [A])).rowCount, 0);
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.konto', $1, true)`, [String(A)]);
        assert.equal((await app.query('SELECT username FROM users WHERE id = $1', [A])).rows[0].username, 'kt_a');
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.konto', $1, true)`, [String(C)]);
        // Entering oneself into a foreign household would mean seeing its rows.
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
        // C no longer sees foreign links (0121), not even for reading.
        assert.equal((await app.query('SELECT 1 FROM account_links WHERE main_user_id = $1', [A])).rowCount, 0);
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
    await checkAccessRights(db, A);
    await als(db, null, null, c =>
      c.query(`DELETE FROM user_sessions WHERE sid = 'kt-sid'; DELETE FROM users WHERE username LIKE 'kt\\_%'`),
    );
  };

  await t.test(
    'password hashes and sessions are only read by the system role, already after the migration',
    async () => {
      // “new installation” migrated without app-rolle.sh afterwards: migration 0115 alone achieves that.
      await checkAccountTables(neu);
    },
  );

  await t.test('… and after every run of app-rolle.sh; copies before migrations only for the system role', async () => {
    await als(neu, MIG, MIG_PW, mig =>
      mig.query(`CREATE SCHEMA vor_migration_20261114000000000;
        CREATE TABLE vor_migration_20261114000000000.users AS SELECT 7 AS id, 'x' AS password_hash`),
    );
    try {
      assert.equal(setUpRole(neu).status, 0);
      await checkAccountTables(neu);
      const kopie = 'SELECT password_hash FROM vor_migration_20261114000000000.users';
      assert.equal((await als(neu, ROLLE, PASSWORT, app => app.query(kopie))).rowCount, 0);
      assert.equal((await als(neu, SYS, SYS_PW, sys => sys.query(kopie))).rowCount, 1);
    } finally {
      await als(neu, MIG, MIG_PW, mig => mig.query('DROP SCHEMA vor_migration_20261114000000000 CASCADE'));
    }
  });

  await t.test('the migration role slips nothing under the superuser', async () => {
    const app = new Client({ connectionString: url(neu, MIG, MIG_PW) });
    await app.connect();
    try {
      // Every function creates a superuser role as soon as a superuser executes it.
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
    const r = setUpRole(neu);
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
    const r2 = setUpRole(neu);
    assert.equal(r2.status, 0, `untergeschobenes SET role: ${r2.stderr}`);
    assert.equal((await rightsTheRole(admin, MIG)).rolsuper, false);
  });

  await t.test('runtime and system role may not DROP, ALTER or CREATE, only rows', async () => {
    assert.equal(setUpRole(neu).status, 0);
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
        // Write rows, advance sequences, create temporary objects: everything the app needs.
        // (the runtime role only partly writes users, see “only … writes credentials”.)
        const { id: zeile } = (
          await app.query(`INSERT INTO app_logs (level, message) VALUES ('info', 'laufzeitprobe') RETURNING id`)
        ).rows[0];
        await app.query(`UPDATE app_logs SET message = 'L' WHERE id = $1`, [zeile]);
        assert.equal((await app.query('SELECT message FROM app_logs WHERE id = $1', [zeile])).rows[0].message, 'L');
        await app.query('DELETE FROM app_logs WHERE id = $1', [zeile]);
        await app.query('CREATE TEMP TABLE probe (x int)');
      });
  });

  await t.test('the catalog import swaps as the runtime role', async () => {
    const tausch = require(path.join(ROOT, 'dist', 'src', 'catalog', 'repository', 'csvSwap.js'));
    await als(neu, ROLLE, PASSWORT, async app => {
      await tausch.lockTable(app, 'rb_colors');
      try {
        await tausch.createShadow(app, 'rb_colors', 'rb_colors_import');
        await tausch.addBlockOne(
          app,
          'rb_colors_import',
          ['id', 'name', 'rgb', 'is_trans'],
          [
            [9001, 'Probe-Rot', 'C91A09', false],
            [9002, 'Probe-Blau', '0055BF', false],
          ],
          ['id'],
        );
        await tausch.swap(app, 'rb_colors', 'rb_colors_import', ['id', 'name', 'rgb', 'is_trans']);
        await tausch.removeShadow(app, 'rb_colors_import');
        assert.equal(await tausch.maintenance(app, 'rb_colors'), true, 'VACUUM (ANALYZE) bricht ab');
      } finally {
        await tausch.giveTableFree(app, 'rb_colors');
      }
      assert.deepEqual((await app.query('SELECT id, name FROM rb_colors ORDER BY id')).rows, [
        { id: 9001, name: 'Probe-Rot' },
        { id: 9002, name: 'Probe-Blau' },
      ]);
    });
    await als(neu, null, null, c => c.query('DELETE FROM rb_colors'));
  });

  await t.test('what the migration role creates later reaches the runtime role without a new run', async () => {
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

    // An expired copy: the runtime role empties it, only the migration role can remove it.
    const { cleanOldBackupsOn } = require(path.join(ROOT, 'dist', 'db', 'migrate.js'));
    const abfrager = c => ({
      all: async (q, p) => (await c.query(q, p)).rows,
      run: async (q, p) => ({ changes: (await c.query(q, p)).rowCount }),
    });
    const ALT = 'vor_migration_20200101000000000';
    await als(neu, MIG, MIG_PW, mig => mig.query(`CREATE SCHEMA ${ALT}; CREATE TABLE ${ALT}.users AS SELECT 7 AS id`));
    assert.equal(await als(neu, ROLLE, PASSWORT, app => cleanOldBackupsOn(abfrager(app))), 1);
    assert.deepEqual(
      (await als(neu, null, null, c => c.query(`SELECT count(*)::int AS n FROM ${ALT}.users`))).rows,
      [{ n: 0 }],
      'ein gelöschtes Konto lebt in der abgelaufenen Kopie weiter',
    );
    assert.equal(await als(neu, MIG, MIG_PW, mig => cleanOldBackupsOn(abfrager(mig))), 1);
    assert.equal(
      (await als(neu, null, null, c => c.query(`SELECT 1 FROM pg_namespace WHERE nspname = '${ALT}'`))).rowCount,
      0,
    );
  });

  await t.test('the runtime role does not start on a schema with open migrations', async () => {
    const letzte = (await als(neu, MIG, MIG_PW, mig => mig.query('SELECT max(name) AS n FROM schema_migrations')))
      .rows[0].n;
    await als(neu, MIG, MIG_PW, mig =>
      mig.query(`UPDATE schema_migrations SET name = name || '.weg' WHERE name = $1`, [letzte]),
    );
    try {
      const r = schemaAsAccount(url(neu, ROLLE, PASSWORT));
      assert.notEqual(r.status, 0, 'gestartet trotz offener Migration');
      assert.match(r.stderr, new RegExp(`Migrationen offen: ${letzte.replace(/\./g, '\\.')}\\..*Dienst migration`));
    } finally {
      await als(neu, MIG, MIG_PW, mig =>
        mig.query(`UPDATE schema_migrations SET name = $1 WHERE name = $1 || '.weg'`, [letzte]),
      );
    }
    const m = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'startup', 'migrate.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url(neu, ROLLE, PASSWORT) },
    });
    assert.notEqual(m.status, 0, 'der Dienst migration meldet als Laufzeitrolle Erfolg');
    assert.match(m.stderr, /PGUSER muss die Migrationsrolle sein/);
    const ok = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'startup', 'migrate.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url(neu, MIG, MIG_PW) },
    });
    assert.equal(ok.status, 0, ok.stderr);
  });

  await t.test('the read role sees no secrets', async () => {
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
    assert.equal(setUpRole(neu).status, 0, 'Rechte für neue Tabellen');
    const l = new Client({ connectionString: url(neu, LESEN, READ_PW) });
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
        'SELECT token FROM api_tokens_consumed',
        'SELECT sid FROM user_sessions',
        'SELECT secret FROM second_factor',
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
    const ohne = setUpRole(neu, { PGWEB_DB_PASSWORD: '' });
    assert.equal(ohne.status, 0, ohne.stderr);
    assert.equal(
      (await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [LESEN])).rows[0].rolcanlogin,
      false,
      'ohne PGWEB_DB_PASSWORD meldet sich die Leserolle nicht an',
    );
    const gleich = setUpRole(neu, { PGWEB_DB_PASSWORD: PASSWORT });
    assert.notEqual(gleich.status, 0);
    assert.match(gleich.stderr, /PGWEB_DB_PASSWORD muss sich/);
  });

  await t.test('the read role reads exactly the allowlist', async () => {
    const r = setUpRole(neu);
    assert.equal(r.status, 0, r.stderr);
    // Every column of the allowlist exists in the current schema (otherwise the script reports it).
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
      'session_version',
    ]);
    assert.deepEqual(await lesbar('vouchers'), [
      'id',
      'user_id',
      'amount',
      'currency',
      'pdf_path',
      'created_at',
      'updated_at',
      'balance_checked_at',
    ]);
    for (const t of [
      'api_tokens',
      'api_tokens_consumed',
      'user_sessions',
      'qr_login_tokens',
      'webauthn_challenges',
      'second_factor_codes',
      'account_link_invites',
      'idempotency',
    ])
      assert.deepEqual(await lesbar(t), [], `${t} ist für die Leserolle lesbar`);
  });

  await t.test('row security applies to the runtime role, not to system and read role', async () => {
    await als(neu, null, null, c =>
      c.query(`INSERT INTO sets (user_id, set_number) SELECT id, '10001-1' FROM users WHERE username = 'leseprobe'`),
    );
    const zaehle = c => c.query('SELECT count(id)::int AS n FROM sets').then(r => r.rows[0].n);
    // Without an account the runtime role sees no row in users either (0121): the identifier comes from the owner.
    const konto = await als(neu, null, null, c =>
      c.query(`SELECT id FROM users WHERE username = 'leseprobe'`).then(r => r.rows[0].id),
    );
    await als(neu, ROLLE, PASSWORT, async app => {
      assert.equal(await zaehle(app), 0, 'ohne Konto sieht die Laufzeitrolle keine Zeile');
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.konto', $1::text, true)`, [konto]);
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
    await als(neu, LESEN, READ_PW, async l => assert.equal(await zaehle(l), 1, 'pgweb sieht alle Zeilen'));
  });

  await t.test('new columns and tables stay unreadable until the allowlist names them', async () => {
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
    const r = setUpRole(neu);
    assert.equal(r.status, 0, r.stderr);
    const l = new Client({ connectionString: url(neu, LESEN, READ_PW) });
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
    // Only an entry in the allowlist releases the column (copy of the script with an extended line).
    const fsm = require('node:fs'),
      osm = require('node:os');
    const kopie = path.join(fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-liste-')), 'app-rolle.sh');
    const quelle = fsm.readFileSync(SCRIPT, 'utf8');
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
        PGWEB_DB_PASSWORD: READ_PW,
        DB_SYSTEM_USER: SYS,
        DB_SYSTEM_WEB_USER: SYSWEB,
        DB_SYSTEM_PASSWORD: SYS_PW,
      },
    });
    fsm.rmSync(path.dirname(kopie), { recursive: true, force: true });
    assert.equal(mit.status, 0, mit.stderr);
    const l2 = new Client({ connectionString: url(neu, LESEN, READ_PW) });
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
    assert.equal(setUpRole(neu).status, 0);
  });

  await t.test('passwords from files (Docker secrets)', async tt => {
    const fsm = require('node:fs'),
      osm = require('node:os');
    const ordner = fsm.mkdtempSync(path.join(osm.tmpdir(), 'rolle-geheim-'));
    tt.after(() => fsm.rmSync(ordner, { recursive: true, force: true }));
    const datei = (name, wert) => {
      const f = path.join(ordner, name);
      fsm.writeFileSync(f, wert + '\n');
      return f;
    };
    const environment = {
      DB_APP_PASSWORD_FILE: datei('app', PASSWORT),
      PGWEB_DB_PASSWORD_FILE: datei('lesen', READ_PW),
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
        DB_SYSTEM_WEB_USER: SYSWEB,
        ...environment,
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
      return spawnSync('sh', [SCRIPT], { encoding: 'utf8', env });
    };
    const r = ohneWerte({});
    assert.equal(r.status, 0, r.stderr);
    const l = new Client({ connectionString: url(neu, LESEN, READ_PW) });
    await l.connect();
    await l.end();
    const app = new Client({ connectionString: url(neu, ROLLE, PASSWORT) });
    await app.connect();
    await app.end();
    await als(neu, MIG, MIG_PW, () => {});
    await als(neu, SYS, SYS_PW, () => {});
    const withoutSys = ohneWerte({ DB_SYSTEM_PASSWORD_FILE: '' });
    assert.notEqual(withoutSys.status, 0);
    assert.match(withoutSys.stderr, /DB_SYSTEM_PASSWORD fehlt/);
    const withoutMig = ohneWerte({ DB_MIGRATION_PASSWORD_FILE: '' });
    assert.notEqual(withoutMig.status, 0);
    assert.match(withoutMig.stderr, /DB_MIGRATION_PASSWORD fehlt/);
    const beide = ohneWerte({ DB_APP_PASSWORD: PASSWORT });
    assert.notEqual(beide.status, 0);
    assert.match(beide.stderr, /DB_APP_PASSWORD und DB_APP_PASSWORD_FILE sind beide gesetzt/);
    const fehlt = ohneWerte({ DB_APP_PASSWORD_FILE: path.join(ordner, 'gibt-es-nicht') });
    assert.notEqual(fehlt.status, 0);
    assert.match(fehlt.stderr, /DB_APP_PASSWORD_FILE=.* ist nicht lesbar/);
  });

  await t.test('an identical password is rejected', () => {
    const r = setUpRole(neu, { DB_APP_PASSWORD: decodeURIComponent(BASIS.password) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden/);
    const m = setUpRole(neu, { DB_MIGRATION_PASSWORD: PASSWORT });
    assert.notEqual(m.status, 0);
    assert.match(m.stderr, /DB_MIGRATION_PASSWORD muss sich von DB_PASSWORD und DB_APP_PASSWORD unterscheiden/);
    const sys = setUpRole(neu, { DB_SYSTEM_PASSWORD: PASSWORT });
    assert.notEqual(sys.status, 0);
    assert.match(sys.stderr, /DB_SYSTEM_PASSWORD muss sich von DB_PASSWORD, DB_APP_PASSWORD und DB_MIGRATION_PASSWORD/);
  });

  // `docker` is a stand-in: db-rolle and migration really run against the test DB.
  await t.test(
    'scripts/rollen-trennen.sh converts an installation with the app role as owner, repeatable',
    async tt => {
      const fsm = require('node:fs'),
        osm = require('node:os');
      const ort = fsm.mkdtempSync(path.join(osm.tmpdir(), 'rollen-trennen-'));
      tt.after(() => fsm.rmSync(ort, { recursive: true, force: true }));
      await admin.query(`CREATE DATABASE ${id(migration)}`);
      const s = schemaAsAccount(url(migration));
      assert.equal(s.status, 0, s.stderr);
      // State up to round 17: database and tables belong to the runtime role.
      await admin.query(`ALTER DATABASE ${id(migration)} OWNER TO ${id(ROLLE)}`);
      await als(migration, null, null, c =>
        c.query(`ALTER TABLE users OWNER TO ${id(ROLLE)}; ALTER TABLE sets OWNER TO ${id(ROLLE)}`),
      );

      fsm.mkdirSync(path.join(ort, 'geheimnisse'), { mode: 0o700 });
      for (const [n, w] of [
        ['db_password', decodeURIComponent(BASIS.password)],
        ['db_app_password', PASSWORT],
        ['session_secret', 'x'.repeat(48)],
        ['pgweb_db_password', READ_PW],
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
       DB_SYSTEM_PASSWORD_FILE='${g}/db_system_password' exec sh '${SCRIPT}' ;;
  'run migration') cd '${ROOT}' && DATABASE_URL="postgres://${MIG}:$(cat '${g}/db_migration_password')@${BASIS.host}/${migration}" \
       exec '${process.execPath}' dist/startup/migrate.js ;;
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
            PGDATABASE: migration,
            DB_SUPERUSER: decodeURIComponent(BASIS.username),
            DB_APP_USER: ROLLE,
            DB_MIGRATION_USER: MIG,
            DB_LESEN_USER: LESEN,
            DB_SYSTEM_USER: SYS,
            DB_SYSTEM_WEB_USER: SYSWEB,
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
      await als(migration, ROLLE, PASSWORT, app =>
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
