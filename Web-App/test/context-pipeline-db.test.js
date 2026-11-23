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
const { createDb, dbConfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));
const { asRequest } = _req('src/infra/accountContext.js');

const as = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = lines => [...new Set(lines.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** Counts direction changes: if the client sends again after a response, a new round trip begins. */
function countingBroker(target) {
  const state = { roundtrips: 0, responseKam: true };
  const srv = net.createServer(a => {
    const b = net.connect(Number(target.port || 5432), target.hostname);
    a.on('data', d => {
      if (state.responseKam) state.roundtrips++;
      state.responseKam = false;
      b.write(d);
    });
    b.on('data', d => {
      state.responseKam = true;
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
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, state })));
}

test('context per query in the pipeline', { concurrency: 1 }, async t => {
  const access = await accessOrSkip(t, _req);
  if (!access) return;
  t.after(() => access.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_OWN_URL || (await access.asSuperuserConnected()))
    return missingPrecondition(t, 'die App läuft als Superuser (nur npm test trennt Rollen)');
  const k = dbConfigFromEnvironment();
  // The owner writes the test data, bypassing row security.
  const own = createDb({ ...k, connection: { connectionString: process.env.TEST_DB_OWN_URL }, system: null });
  const app = createDb({ ...k, pool: { ...k.pool, max: 1 } });
  t.after(async () => {
    await app.pool.end().catch(() => {});
    await own.pool.end().catch(() => {});
  });

  const account = async name =>
    (
      await own.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `kp_${name}_${process.pid}`,
      ])
    ).id;
  const A = await account('a'),
    B = await account('b');
  for (const u of [A, B]) await own.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
  const allSets = () => app.all('SELECT user_id FROM sets');
  const account_ = () => app.get(`SELECT current_setting('app.account', true) AS k`);

  await t.test('after a request with an account the next one without an account sees nothing', async () => {
    assert.deepEqual(ids(await as(A, allSets)), [A]);
    assert.deepEqual(await allSets(), []);
    assert.ok(!(await account_())?.k, 'the connection carries no account along');
  });

  await t.test('after a failed query with an account no context remains on the connection', async () => {
    await assert.rejects(
      as(A, () => app.all('SELECT 1 / (count(*) - count(*)) FROM sets')),
      /division by zero/,
    );
    await assert.rejects(
      as(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B])),
      /row-level security/,
    );
    assert.deepEqual(await allSets(), []);
    assert.deepEqual(ids(await as(B, allSets)), [B], 'the connection is usable afterwards');
    assert.equal((await own.get(`SELECT count(*)::int AS n FROM sets WHERE set_number = '10002-1'`)).n, 0);
  });

  await t.test('alternately and concurrently: every request only sees its account', async () => {
    const who = Array.from({ length: 30 }, (_, i) => [A, B, null][i % 3]);
    const seen = await Promise.all(who.map(u => (u ? as(u, allSets) : allSets())));
    for (const [i, lines] of seen.entries()) assert.deepEqual(ids(lines), who[i] ? [who[i]] : [], `Request ${i}`);
  });

  await t.test('one round trip for a query with an account', async () => {
    const target = new URL(process.env.DATABASE_URL);
    const { srv, state } = await countingBroker(target);
    const over = new URL(target);
    over.hostname = '127.0.0.1';
    over.port = String(srv.address().port);
    const near = createDb({ ...k, connection: { connectionString: over.toString() }, pool: { ...k.pool, max: 1 } });
    try {
      await near.get('SELECT 1');
      state.roundtrips = 0;
      assert.deepEqual(ids(await as(A, () => near.all('SELECT user_id FROM sets'))), [A]);
      assert.equal(state.roundtrips, 1);
    } finally {
      await near.pool.end();
      srv.close();
    }
  });
});
