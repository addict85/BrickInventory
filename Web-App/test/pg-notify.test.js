/**
 * LISTEN/NOTIFY instead of database polling (point 7). NOTIFY is volatile: whoever
 * is not connected at the moment of the signal never gets it. Therefore
 * pgNotify calls every handler once on (re)connecting, and the
 * receiver looks in the database (the job table).
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  the catch-up loop over _handlers removed in connect() → red:
 *      „beim Verbinden fragt der Handler einmal von sich aus“
 *   B  quoteIdent() lets every name through → red: „ein Kanalname mit
 *      Leerzeichen wird abgewiesen“ (afterwards the run hangs on the invalid channel)
 *   C  `listen('csv_sync_trigger', …)` again in startup/jobsProcess.ts →
 *      red: “no scheduler asks for triggers any more”
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { bis } = require('./helpers/time');
const ROOT = path.join(__dirname, '..');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'db/pgNotify.ts'), 'utf8');
test('no scheduler asks for triggers any more', () => {
  // Kicks and schedules are jobs (src/jobQueue/schedule.ts); the old
  // trigger entries with their own channel are gone.
  const { allSources } = require('./helpers/sources');
  const treffer = allSources().filter(rel =>
    /csv_sync_trigger|job_reschedule_trigger|instr_queue_trigger/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')),
  );
  assert.deepEqual(treffer, []);
});

test('missed signals are caught up when connecting', { concurrency: 1 }, async t => {
  const db = testData();
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const pgNotify = testAccess().notification;
  t.after(async () => {
    await pgNotify.close();
    await db.pool.end().catch(() => {});
  });
  const CHANNEL = `ae_probe_${process.pid}`;
  const bekommen = [];
  const waitOn = n => bis(() => bekommen.length >= n, 5000);

  assert.throws(
    () => pgNotify.listen('kein kanal', () => {}),
    /Ungültiger Kanalname/,
    'ein Kanalname mit Leerzeichen wird abgewiesen',
  );

  pgNotify.listen(CHANNEL, nutzlast => {
    bekommen.push(nutzlast ?? null);
  });
  await waitOn(1);
  assert.deepEqual(bekommen, [null], 'beim Verbinden fragt der Handler einmal von sich aus');

  await pgNotify.notify(CHANNEL, 'hallo');
  await waitOn(2);
  assert.deepEqual(bekommen, [null, 'hallo'], 'das Signal kommt an');

  // Tear down the listening connection: a signal in the gap would be
  // lost, hence the handler catches up when reconnecting.
  await db.run(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE $1`,
    [`LISTEN "${CHANNEL}"%`],
  );
  await waitOn(3);
  assert.deepEqual(bekommen, [null, 'hallo', null], 'nach dem Wiederverbinden holt der Handler nach');
});

test('when sending, the channel is bound, not inserted', () => {
  assert.match(
    NOTIFY,
    /pg_notify\(\$1, \$2\)/,
    'Beim Senden lässt sich der Kanal binden — dort gehört kein String-Bau hin',
  );
});

test('own connection, with capped reconnect', () => {
  assert.match(NOTIFY, /new Client\(/, 'Ein dauerhaft lauschender Client wäre im Pool blockiert');
  assert.match(
    NOTIFY,
    /Math\.min\(30_000, (?:this\.)?_retryMs \* 2\)/,
    'Reconnect ohne Deckelung und Backoff hämmert bei DB-Ausfall dagegen',
  );
});
