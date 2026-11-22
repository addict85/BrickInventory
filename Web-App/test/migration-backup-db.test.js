/**
 * Before open migrations: back up user data, migrate without a time limit.
 * @einzeln: puts a sample migration into dist/db/migrations, which every file starting
 * in parallel would see when migrating.
 *
 * A sample migration in dist/db/migrations aborts if
 * statement_timeout is not 0; the pool sets 30 s for every connection.
 *
 * Counter-checks (measured on 27.10.):
 *   A  `SET LOCAL statement_timeout = 0` removed → red: “open migration:
 *      first backed up, then applied without a time limit”
 *   B  the call of secureUserData removed in runMigrations → red:
 *      the same check (no backup)
 *   C  OFFSET of the cleanup query removed (delete all) → red: “the three
 *      most recent backups stay”
 *   D  (28.10.) the UNION over foreign keys on users removed → red:
 *      “open migration …” (account_links missing)
 *   E  (12.11.2026) in runMigrations again `SET LOCAL lock_timeout = 0` → red:
 *      “a held lock: deadline, retry, clear message” (timeout)
 *   F  (12.11.2026) in withLockPeriod() without retry (rethrow immediately)
 *      → red: the same check (one warning expected, none seen)
 *   G  (12.11.2026) in secureUserData again `lock_timeout = 0` → red:
 *      “the backup does not wait forever either” (timeout)
 *   H  (14.11.2026) the `ENABLE ROW LEVEL SECURITY` deleted in secureUserData
 *      → red: “open migration …” (copies without row protection: users, api_tokens, …)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { DIST, testData } = require('./helpers/sources');
const db = testData();
const { runMigrations, secureUserData } = _req('db/migrate.js');
const NAME = `migsich_${process.pid}`,
  SECOND = `migsich2_${process.pid}`;
const PROBE = `9999-probe-${process.pid}.sql`;

const backups = async () =>
  (await db.all(`SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$' ORDER BY nspname`)).map(
    r => r.nspname,
  );

test('migrations: backup and time limit', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const client = await db.pool.connect();
  await runMigrations(client);
  const vorher = new Set(await backups());
  const probe = path.join(DIST, 'db/migrations', PROBE);

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, SECOND]]);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
        [n],
      )
    ).id;
  const haupt = await anlegen(NAME),
    kind = await anlegen(SECOND);
  // A household link: the table has no column user_id, only foreign keys on users.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    fs.rmSync(probe, { force: true });
    await db.run('DELETE FROM schema_migrations WHERE name = $1', [PROBE]).catch(() => {});
    for (const s of await backups()) if (!vorher.has(s)) await db.run(`DROP SCHEMA ${s} CASCADE`).catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, SECOND]]).catch(() => {});
    client.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('without an open migration no backup', async () => {
    await runMigrations(client, { sichern: true });
    assert.deepEqual(new Set(await backups()), vorher);
  });

  await t.test('open migration: first backed up, then applied without a time limit', async () => {
    fs.writeFileSync(
      probe,
      `DO $$ BEGIN
      IF current_setting('statement_timeout') <> '0' THEN
        RAISE EXCEPTION 'statement_timeout ist %', current_setting('statement_timeout');
      END IF; END $$;`,
    );
    assert.notEqual(
      (await client.query('SHOW statement_timeout')).rows[0].statement_timeout,
      '0',
      'The connection has no timeout — then the probe checks nothing',
    );
    const applied = await runMigrations(client, { sichern: true });
    assert.deepEqual(applied, [PROBE]);
    const neu = (await backups()).filter(s => !vorher.has(s));
    assert.equal(neu.length, 1, 'no backup before the migration');
    const kopie = await db.get(`SELECT username FROM ${neu[0]}.users WHERE username = $1`, [NAME]);
    assert.ok(kopie, 'The backup does not contain the accounts');
    const tabellen = (
      await db.all(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [neu[0]])
    ).map(r => r.table_name);
    assert.ok(tabellen.includes('set_acquisitions'), `Tables with user_id are missing: ${tabellen.join(', ')}`);
    assert.ok(!tabellen.includes('set_catalog'), 'The catalogue does not belong in the backup');
    for (const n of ['account_links', 'account_link_invites', 'household_former_links', 'admin_log'])
      assert.ok(tabellen.includes(n), `${n} is missing in the backup`);
    assert.ok(
      await db.get(`SELECT 1 FROM ${neu[0]}.account_links WHERE main_user_id = $1 AND sub_user_id = $2`, [haupt, kind]),
      'The household link is missing in the backup',
    );
    // The copy carries no policy: without RLS the runtime role would read hashes and tokens of all accounts.
    const open = await db.all(
      `SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r' AND NOT relrowsecurity`,
      [neu[0]],
    );
    assert.deepEqual(open, [], 'copies without row protection');
  });

  const SHORT = { fristMs: 200, versuche: 2 };
  const LOCK_PROBE = `9998-sperre-${process.pid}.sql`,
    TABLE_NAME = `migsperre_${process.pid}`;
  /** A second connection holds `tabelle` exclusively until `frei()` is called –
   * at the latest after 4 s, so that a version without a deadline turns red instead of hanging. */
  const holdLock = async tabelle => {
    const c2 = await db.pool.connect();
    await c2.query('BEGIN');
    await c2.query(`LOCK TABLE ${tabelle} IN ACCESS EXCLUSIVE MODE`);
    let open = true;
    const frei = async () => {
      if (!open) return;
      open = false;
      clearTimeout(emergency);
      await c2.query('ROLLBACK');
      c2.release();
    };
    const emergency = setTimeout(frei, 4000);
    return frei;
  };
  /** Record console.warn as long as `f` runs. */
  const withWarnings = async f => {
    const echt = console.warn,
      gesehen = [];
    console.warn = (...a) => gesehen.push(a.join(' '));
    try {
      return { ergebnis: await f().catch(e => e), gesehen };
    } finally {
      console.warn = echt;
    }
  };

  await t.test('a held lock: deadline, retry, clear message', { timeout: 15_000 }, async () => {
    const datei = path.join(DIST, 'db/migrations', LOCK_PROBE);
    await db.run(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (x int)`);
    t.after(async () => {
      fs.rmSync(datei, { force: true });
      await db.run('DELETE FROM schema_migrations WHERE name = $1', [LOCK_PROBE]).catch(() => {});
      await db.run(`DROP TABLE IF EXISTS ${TABLE_NAME}`).catch(() => {});
    });
    fs.writeFileSync(datei, `SELECT count(*) FROM ${TABLE_NAME};`);
    const frei = await holdLock(TABLE_NAME);
    const { ergebnis, gesehen } = await withWarnings(() => runMigrations(client, { sperre: SHORT }));
    await frei();
    assert.ok(ergebnis instanceof Error, `back without error: ${ergebnis}`);
    assert.match(
      ergebnis.message,
      new RegExp(
        `Migration ${LOCK_PROBE} fehlgeschlagen: .*nach 0.2 s keine Sperre erhalten.*Aufgegeben nach 2 Versuchen`,
      ),
    );
    assert.equal(gesehen.filter(w => w.includes('Versuch 2/2')).length, 1, gesehen.join('\n'));
    assert.equal(await db.get('SELECT 1 FROM schema_migrations WHERE name = $1', [LOCK_PROBE]), undefined);
    assert.deepEqual(await runMigrations(client, { sperre: SHORT }), [LOCK_PROBE], 'without a lock it runs through');
  });

  await t.test('the backup does not wait forever either', { timeout: 15_000 }, async () => {
    const frei = await holdLock('users');
    const { ergebnis } = await withWarnings(() => secureUserData(client, ['probe'], { fristMs: 200, versuche: 1 }));
    await frei();
    assert.ok(ergebnis instanceof Error, `back without error: ${ergebnis}`);
    assert.match(ergebnis.message, /Sicherung vor den Migrationen fehlgeschlagen: .*keine Sperre erhalten/);
  });

  await t.test('the three most recent backups stay', async () => {
    for (let i = 0; i < 4; i++) {
      await secureUserData(client, ['probe']);
      await new Promise(r => setTimeout(r, 5));
    }
    assert.equal((await backups()).length, 3);
  });
});
