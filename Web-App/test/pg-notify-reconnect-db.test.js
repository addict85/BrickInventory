/**
 * LISTEN/NOTIFY survives a connection drop — against a real database.
 *
 * Counter-check (carried out): retire() in db/pgNotify.ts again replaced by the
 * old version (removeAllListeners without a replacement listener) → this test
 * turns red, exit code 7 instead of 0.
 * Counter-check (measured 10.11.2026): in db/pgNotify.ts the check for _closed
 * after c.connect() deleted → red: “close() during connection setup
 * …” (the child does not end, ETIMEDOUT after 15 s).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

// The child process: listens, lets its connection be shot down and reports
// via the exit code whether it survived that.
const CHILD = `
process.env.DATABASE_URL = ${JSON.stringify(process.env.DATABASE_URL)};
const dbModule = require(${JSON.stringify(path.join(ROOT, 'dist/db/database.js'))});
const db     = dbModule.createDb(dbModule.dbConfigFromEnvironment());
const notify = db.notification;
const { until } = require(${JSON.stringify(path.join(__dirname, 'helpers', 'time.js'))});
const LISTEN = \`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query LIKE 'LISTEN "reconnect_probe"%'\`;
let empfangen = 0;
process.on('uncaughtException', e => { console.log('CRASH:' + e.message); process.exit(7); });
(async () => {
  notify.listen('reconnect_probe', () => { empfangen++; });
  await until(async () => (await db.pool.query(LISTEN)).rows.length > 0);
  const alt = (await db.pool.query(LISTEN)).rows.map(z => z.pid);
  // Abriss serverseitig erzwingen — der reale Fall (Postgres-Neustart, Proxy).
  await db.run(\`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                WHERE datname = current_database() AND query LIKE 'LISTEN "reconnect_probe"%' AND pid <> pg_backend_pid()\`);
  // Ohne funktionierenden Wiederaufbau (erster Versuch nach ~1 s) kommt keine
  // neue Verbindung mit LISTEN; die alte zählt nicht.
  const fresh = async () => (await db.pool.query(LISTEN)).rows.filter(z => !alt.includes(z.pid)).length;
  await until(async () => await fresh() > 0, 10_000);
  const n = await fresh();
  console.log('LISTEN_WIEDER_DA:' + n);
  await notify.close();
  await db.pool.end();
  process.exit(n >= 1 ? 0 : 8);
})().catch(e => { console.log('FEHLER:' + e.message); process.exit(9); });
`;

test('a drop of the LISTEN connection does NOT end the process and reconnects', { concurrency: 1 }, async t => {
  try {
    await db.pool.query('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  const file = path.join(os.tmpdir(), `notify-reconnect-${process.pid}.js`);
  fs.writeFileSync(file, CHILD);
  try {
    let out = '';
    try {
      out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 40000 });
    } catch (e) {
      // Exit code != 0: evaluate the output anyway, it says what the cause was.
      const stdout = (e.stdout || '').toString();
      assert.fail(
        `The child process did not exit cleanly (exit code ${e.status}). ` + `Output: ${stdout.trim() || '(empty)'}`,
      );
    }
    assert.ok(!out.includes('CRASH:'), `The teardown killed the process: ${out.trim()}`);
    assert.match(
      out,
      /LISTEN_WIEDER_DA:[1-9]/,
      `After the teardown there is no LISTEN any more — the reconnect did not work. Output: ${out.trim()}`,
    );
  } finally {
    fs.rmSync(file, { force: true });
    await db.pool.end().catch(() => {});
  }
});

// Under load the setup is still on its way when a test calls close(); the
// connection that arrived afterwards kept the process open forever.
test('close() during connection setup leaves no connection open', async t => {
  // The pool is closed after the first test: an own connection for the probe.
  const probe = new (require(path.join(ROOT, 'node_modules', 'pg')).Client)({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await probe.connect();
  } catch (e) {
    noDb(t, e);
    return;
  } finally {
    await probe.end().catch(() => {});
  }
  // No process.exit in the child: it must end by itself.
  const kind = `
process.env.DATABASE_URL = ${JSON.stringify(process.env.DATABASE_URL)};
const dbModule = require(${JSON.stringify(path.join(ROOT, 'dist/db/database.js'))});
const db = dbModule.createDb(dbModule.dbConfigFromEnvironment());
const notify = db.notification;
notify.listen('rennen_probe', () => {});
notify.close().then(() => console.log('GESCHLOSSEN'));
`;
  const out = execFileSync(process.execPath, ['-e', kind], { encoding: 'utf8', timeout: 15_000 });
  assert.match(out, /GESCHLOSSEN/);
});
