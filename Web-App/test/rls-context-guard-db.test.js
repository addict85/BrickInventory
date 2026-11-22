/**
 * Row security follows app.konto, and any SQL can set it. Whoever moves it to another account
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

const als = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = zeilen => [...new Set(zeilen.map(z => Number(z.user_id)))].sort((x, y) => x - y);
const GEFAELSCHT = /app\.konto changed within the transaction/;

test('app.konto cannot be switched unnoticed within a request', { concurrency: 1 }, async t => {
  const zugang = await accessOrSkip(t, _req);
  if (!zugang) return;
  t.after(() => zugang.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_EIGEN_URL || (await zugang.asSuperuserConnected()))
    return missingPrecondition(t, 'die App läuft als Superuser (nur npm test trennt Rollen)');
  const k = dbConfigFromEnvironment();
  const eigen = createDb({ ...k, verbindung: { connectionString: process.env.TEST_DB_EIGEN_URL }, system: null });
  const app = createDb({ ...k, pool: { ...k.pool, max: 1 } });
  t.after(async () => {
    await app.pool.end().catch(() => {});
    await eigen.pool.end().catch(() => {});
  });
  const konto = async name =>
    (
      await eigen.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `rg_${name}_${process.pid}`,
      ])
    ).id;
  const A = await konto('a'),
    B = await konto('b');
  t.after(() => eigen.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]).catch(() => {}));
  for (const u of [A, B]) await eigen.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
  const setsOf = async uid =>
    (await eigen.all(`SELECT set_number FROM sets WHERE user_id = $1 ORDER BY 1`, [uid])).map(z => z.set_number);
  const wechsel = `SELECT set_config('app.konto', '${B}', true)`;

  await t.test('a switch inside a transaction ends it as an error', async () => {
    let gesehen = null;
    await assert.rejects(
      als(A, () =>
        app.transaction(async tx => {
          await tx.run(wechsel);
          gesehen = ids(await tx.all('SELECT user_id FROM sets'));
          await tx.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B]);
        }),
      ),
      GEFAELSCHT,
    );
    // Row security followed the forged setting inside, but nothing of it got out or stayed.
    assert.deepEqual(gesehen, [B], 'Vorbedingung: die Abfrage lief unter dem gefälschten Konto');
    assert.deepEqual(await setsOf(B), ['10001-1'], 'die Zeile für B ist zurückgerollt');
    assert.deepEqual(ids(await als(A, () => app.all('SELECT user_id FROM sets'))), [A], 'die Verbindung danach: A');
  });

  await t.test('a single query that switches the account gets no rows', async () => {
    await assert.rejects(
      als(A, () => app.all(`WITH w AS (${wechsel}) SELECT s.user_id FROM w, LATERAL (SELECT user_id FROM sets) s`)),
      GEFAELSCHT,
    );
    await assert.rejects(
      als(A, () => app.run(wechsel)),
      GEFAELSCHT,
    );
  });

  await t.test('a setting forged at session level does not stick to the connection', async () => {
    await assert.rejects(
      als(A, () => app.run(`SELECT set_config('app.konto', '${B}', false)`)),
      GEFAELSCHT,
    );
    assert.deepEqual(await app.all('SELECT user_id FROM sets'), [], 'ohne Konto sieht die nächste Anfrage nichts');
  });

  await t.test('switching the account through the app (asRequest) stays allowed', async () => {
    const r = await als(A, () =>
      app.transaction(async tx => [
        ids(await tx.all('SELECT user_id FROM sets')),
        await als(B, async () => ids(await tx.all('SELECT user_id FROM sets'))),
      ]),
    );
    assert.deepEqual(r, [[A], [B]]);
  });
});
