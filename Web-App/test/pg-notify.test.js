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
 * Counter-checks (22.11.2026, each alone):
 *   D  notifyVia builds `SELECT pg_notify('${channel}', '${payload}')` → red “when sending, channel and
 *      payload are bound …” (nothing arrives)
 *   E  scheduleReconnect without Math.min(30_000, …) → red “own connection, with capped reconnect” (32000)
 *   F  the doubling removed → red the same test (always 1000)
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
const { noDb } = require('./helpers/db');
const { bis } = require('./helpers/time');
const ROOT = path.join(__dirname, '..');
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);
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
    noDb(t, e);
    return;
  }
  const pgNotify = testAccess().notification;
  t.after(async () => {
    await pgNotify.close();
  });
  const CHANNEL = `ae_probe_${process.pid}`;
  const bekommen = [];
  const waitOn = n => bis(() => bekommen.length >= n, 5000);

  assert.throws(
    () => pgNotify.listen('kein kanal', () => {}),
    /Ungültiger Kanalname/,
    'ein Kanalname mit Leerzeichen wird abgewiesen',
  );

  pgNotify.listen(CHANNEL, payload => {
    bekommen.push(payload ?? null);
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

test('when sending, channel and payload are bound, not inserted', { concurrency: 1 }, async t => {
  // A payload with quotes and a semicolon arrives unchanged; built into the SQL it would break it.
  const db = testData();
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  const pgNotify = testAccess().notification;
  t.after(() => pgNotify.close());
  const CHANNEL = `bind_probe_${process.pid}`;
  const got = [];
  pgNotify.listen(CHANNEL, payload => {
    if (payload != null) got.push(payload);
  });
  assert.ok(await bis(() => pgNotify.listensTo(CHANNEL), 5000), 'not listening');
  const payload = `it's "quoted"; SELECT 1 --`;
  await pgNotify.notify(CHANNEL, payload);
  assert.ok(await bis(() => got.length > 0, 5000), 'the signal did not arrive');
  assert.deepEqual(got, [payload]);
});

test('own connection, with capped reconnect', async t => {
  // Against a port nobody listens on: every failed attempt doubles the wait, at most 30 s.
  const { Notification } = _req('db/pgNotify.js');
  const net = require('node:net');
  const closed = await new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(port));
    });
  });
  const waits = [];
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => {
    if (ms >= 1000 && waits.length < 8) {
      waits.push(ms);
      return realTimeout(fn, 0, ...rest);
    }
    return realTimeout(fn, ms, ...rest);
  });
  t.mock.method(console, 'error', () => {});
  const n = new Notification({ host: '127.0.0.1', port: closed, user: 'x', database: 'x' }, async () => {});
  t.after(() => n.close());
  n.listen('probe', () => {});
  assert.ok(await bis(() => waits.length >= 8, 5000), `only ${waits.length} attempts`);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
