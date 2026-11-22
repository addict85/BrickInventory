/**
 * A query with an account outside a transaction (db/database.ts abfrage()):
 * BEGIN with context, query and COMMIT go out in the pipeline at once. One
 * round trip, and the context ends with the transaction, even if the query fails.
 * Checked as runtime role with a single connection so that every request
 * inherits the connection of the previous one.
 *
 * Counter-checks (measured on 13.11.2026, each alone):
 *   A  contextSql(): set_config(…, false) instead of true → red: “after a request with
 *      an account …”, “after a failed …”, “alternating …”
 *   B  abfrage() sequential again (await per part) → red: “one round trip …” (3)
 *   C  in abfrage() without 'COMMIT' and without the idle check → red: “after a
 *      request with an account …”, “after a failed …”, “alternating …”; without
 *      'COMMIT' alone green: the check discards the connection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { createDb, dbKonfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));
const { asRequest } = _req('src/infra/accountContext.js');

const als = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = zeilen => [...new Set(zeilen.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** Counts direction changes: if the client sends again after a response, a new round trip begins. */
function countingBroker(ziel) {
  const stand = { roundtrips: 0, responseKam: true };
  const srv = net.createServer(a => {
    const b = net.connect(Number(ziel.port || 5432), ziel.hostname);
    a.on('data', d => {
      if (stand.responseKam) stand.roundtrips++;
      stand.responseKam = false;
      b.write(d);
    });
    b.on('data', d => {
      stand.responseKam = true;
      a.write(d);
    });
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      x.on('error', () => y.destroy());
      x.on('close', () => y.destroy());
    }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, stand })));
}

test('context per query in the pipeline', { concurrency: 1 }, async t => {
  const zugang = await accessOrSkip(t, _req);
  if (!zugang) return;
  t.after(() => zugang.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_EIGEN_URL || (await zugang.asSuperuserConnected()))
    return missingPrecondition(t, 'die App läuft als Superuser (nur npm test trennt Rollen)');
  const k = dbKonfigFromEnvironment();
  // The owner writes the test data, bypassing row security.
  const eigen = createDb({ ...k, verbindung: { connectionString: process.env.TEST_DB_EIGEN_URL }, system: null });
  const app = createDb({ ...k, pool: { ...k.pool, max: 1 } });
  t.after(async () => {
    await app.pool.end().catch(() => {});
    await eigen.pool.end().catch(() => {});
  });

  const konto = async name =>
    (
      await eigen.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `kp_${name}_${process.pid}`,
      ])
    ).id;
  const A = await konto('a'),
    B = await konto('b');
  for (const u of [A, B]) await eigen.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
  const allSets = () => app.all('SELECT user_id FROM sets');
  const account_ = () => app.get(`SELECT current_setting('app.konto', true) AS k`);

  await t.test('after a request with an account the next one without an account sees nothing', async () => {
    assert.deepEqual(ids(await als(A, allSets)), [A]);
    assert.deepEqual(await allSets(), []);
    assert.ok(!(await account_())?.k, 'die Verbindung trägt kein Konto weiter');
  });

  await t.test('after a failed query with an account no context remains on the connection', async () => {
    await assert.rejects(
      als(A, () => app.all('SELECT 1 / (count(*) - count(*)) FROM sets')),
      /division by zero/,
    );
    await assert.rejects(
      als(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B])),
      /row-level security/,
    );
    assert.deepEqual(await allSets(), []);
    assert.deepEqual(ids(await als(B, allSets)), [B], 'die Verbindung ist danach benutzbar');
    assert.equal((await eigen.get(`SELECT count(*)::int AS n FROM sets WHERE set_number = '10002-1'`)).n, 0);
  });

  await t.test('alternately and concurrently: every request only sees its account', async () => {
    const wer = Array.from({ length: 30 }, (_, i) => [A, B, null][i % 3]);
    const gesehen = await Promise.all(wer.map(u => (u ? als(u, allSets) : allSets())));
    for (const [i, zeilen] of gesehen.entries()) assert.deepEqual(ids(zeilen), wer[i] ? [wer[i]] : [], `Anfrage ${i}`);
  });

  await t.test('one round trip for a query with an account', async () => {
    const ziel = new URL(process.env.DATABASE_URL);
    const { srv, stand } = await countingBroker(ziel);
    const ueber = new URL(ziel);
    ueber.hostname = '127.0.0.1';
    ueber.port = String(srv.address().port);
    const nah = createDb({ ...k, verbindung: { connectionString: ueber.toString() }, pool: { ...k.pool, max: 1 } });
    try {
      await nah.get('SELECT 1');
      stand.roundtrips = 0;
      assert.deepEqual(ids(await als(A, () => nah.all('SELECT user_id FROM sets'))), [A]);
      assert.equal(stand.roundtrips, 1);
    } finally {
      await nah.pool.end();
      srv.close();
    }
  });
});
