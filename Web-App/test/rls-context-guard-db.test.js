/**
 * Row security follows app.account, and any SQL can set it. Whoever moves it to another account
 * inside a request (single query or transaction) gets an error instead of data, and the
 * ROLLBACK also takes back a setting forged at session level (contextCheckSql in
 * db/transaction.ts). Runtime role with one connection: each request inherits the previous one's.
 *
 * Counter-checks (measured 22.11.2026, each on its own):
 *   A  the check before COMMIT deleted in oneTimeTransaction() (db/database.ts) → red:
 *      “a switch inside a transaction ends it as an error” (the transaction commits, the row
 *      of B stays written)
 *   B  the check deleted from the pipeline in abfrage() → red: “a single query that switches
 *      the account gets no rows” and “a setting forged at session level does not stick …”
 *      (the next request without account sees B)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL, roles separated (npm test).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { createDb, dbConfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));
const { asRequest } = _req('src/infra/accountContext.js');

const as = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = lines => [...new Set(lines.map(z => Number(z.user_id)))].sort((x, y) => x - y);
const FORGED = /app\.account changed within the transaction/;

test('app.account cannot be switched unnoticed within a request', { concurrency: 1 }, async t => {
  const access = await accessOrSkip(t, _req);
  if (!access) return;
  t.after(() => access.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_OWN_URL || (await access.asSuperuserConnected()))
    return missingPrecondition(t, 'die App läuft als Superuser (nur npm test trennt Rollen)');
  const k = dbConfigFromEnvironment();
  const own = createDb({ ...k, connection: { connectionString: process.env.TEST_DB_OWN_URL }, system: null });
  const app = createDb({ ...k, pool: { ...k.pool, max: 1 } });
  t.after(async () => {
    await app.pool.end().catch(() => {});
    await own.pool.end().catch(() => {});
  });
  const account = async name =>
    (
      await own.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `rg_${name}_${process.pid}`,
      ])
    ).id;
  const A = await account('a'),
    B = await account('b');
  t.after(() => own.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]).catch(() => {}));
  for (const u of [A, B]) await own.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
  const setsOf = async uid =>
    (await own.all(`SELECT set_number FROM sets WHERE user_id = $1 ORDER BY 1`, [uid])).map(z => z.set_number);
  const change = `SELECT set_config('app.account', '${B}', true)`;

  await t.test('a switch inside a transaction ends it as an error', async () => {
    let seen = null;
    await assert.rejects(
      as(A, () =>
        app.transaction(async tx => {
          await tx.run(change);
          seen = ids(await tx.all('SELECT user_id FROM sets'));
          await tx.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B]);
        }),
      ),
      FORGED,
    );
    // Row security followed the forged setting inside, but nothing of it got out or stayed.
    assert.deepEqual(seen, [B], 'precondition: the query ran under the forged account');
    assert.deepEqual(await setsOf(B), ['10001-1'], 'the row for B is rolled back');
    assert.deepEqual(ids(await as(A, () => app.all('SELECT user_id FROM sets'))), [A], 'the connection afterwards: A');
  });

  await t.test('a single query that switches the account gets no rows', async () => {
    await assert.rejects(
      as(A, () => app.all(`WITH w AS (${change}) SELECT s.user_id FROM w, LATERAL (SELECT user_id FROM sets) s`)),
      FORGED,
    );
    await assert.rejects(
      as(A, () => app.run(change)),
      FORGED,
    );
  });

  await t.test('a setting forged at session level does not stick to the connection', async () => {
    await assert.rejects(
      as(A, () => app.run(`SELECT set_config('app.account', '${B}', false)`)),
      FORGED,
    );
    assert.deepEqual(await app.all('SELECT user_id FROM sets'), [], 'without an account the next request sees nothing');
  });

  await t.test('switching the account through the app (asRequest) stays allowed', async () => {
    const r = await as(A, () =>
      app.transaction(async tx => [
        ids(await tx.all('SELECT user_id FROM sets')),
        await as(B, async () => ids(await tx.all('SELECT user_id FROM sets'))),
      ]),
    );
    assert.deepEqual(r, [[A], [B]]);
  });
});
