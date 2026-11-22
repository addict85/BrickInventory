/**
 * The idempotency key records the route's effect in the same
 * transaction. If the request aborts after the COMMIT (crash, server error),
 * the repetition has no second effect: after the deadline 409
 * “not repeatable” instead of a second run.
 *
 * Counter-checks (measured 10.11.2026):
 * - db/database.ts: the call of commitCompanion before the COMMIT removed →
 *   red: “aborted after the COMMIT” (two rows instead of one) and “a
 *   server error after the COMMIT” (repetition ran, 200 instead of 409).
 * - repository.ts: in belege() `AND NOT idempotency.has_effect` deleted → red:
 *   “aborted after the COMMIT” (the repetition occupies anew and acts).
 * - Opposite direction: “without COMMIT it may run anew” stays green, even with both
 *   counter-checks; a rolled-back transaction records nothing.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { idempotency } = _req('src/idempotency/http/middleware.js');
const dienst = _req('src/idempotency/service.js');

const NAME = `idem_wirkung_${process.pid}`;

test('idempotency: effect and key in one transaction', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const tabelle = `idem_wirkung_${process.pid}`;
  await db.run(`CREATE TABLE ${tabelle} (key text)`);
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${tabelle}`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // What the route does after its transaction: answer, abort or fail.
  let danach = 'antworten',
    rollback = false;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).apiUser = { user_id: uid };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', idempotency(require('./helpers/sources').testServices().idempotency));
  app.post('/api/v2/parts', async (req, res) => {
    await db.transaction(async tx => {
      await tx.run(`INSERT INTO ${tabelle} VALUES ($1)`, [req.get('Idempotency-Key')]);
      if (rollback) throw new Error('zurückgerollt');
    });
    if (danach === 'abbrechen') return void res.socket.destroy();
    if (danach === 'scheitern') throw new Error('nach dem COMMIT');
    res.json({ success: true });
  });
  app.use((_e, _req, res, _next) => {
    res.status(500).type('text/plain').send('Fehler');
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const url = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/api/v2/parts`;
  const sende = k =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': k },
      body: '{"part_number":"3001"}',
    }).catch(() => null);
  const effects = async k => (await db.get(`SELECT COUNT(*)::int AS n FROM ${tabelle} WHERE key = $1`, [k])).n;
  const orphan = k =>
    db.run(
      `UPDATE idempotency SET created_at = NOW() - make_interval(secs => $3)
                                  WHERE user_id = $1 AND key = $2`,
      [uid, k, dienst.ORPHANED_AFTER_S + 1],
    );
  const fertig = async k => {
    for (let i = 0; i < 50; i++) {
      if (!(await db.get('SELECT 1 FROM idempotency WHERE user_id = $1 AND key = $2 AND status IS NULL', [uid, k])))
        return;
      await new Promise(r => setTimeout(r, 20));
    }
  };

  await t.test('aborted after the COMMIT', async () => {
    danach = 'abbrechen';
    assert.equal(await sende('k-abbruch'), null, 'Vorbedingung: Die Verbindung reisst ab');
    await orphan('k-abbruch');
    danach = 'antworten';
    const r = await sende('k-abbruch');
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'idempotency_not_repeatable');
    assert.equal(await effects('k-abbruch'), 1);
  });

  await t.test('a server error after the COMMIT', async () => {
    danach = 'scheitern';
    assert.equal((await sende('k-fehler')).status, 500);
    await fertig('k-fehler');
    danach = 'antworten';
    const r = await sende('k-fehler');
    assert.equal(r.status, 409);
    assert.equal(await effects('k-fehler'), 1);
  });

  await t.test('without COMMIT it may run anew', async () => {
    rollback = true;
    assert.equal((await sende('k-rollback')).status, 500);
    await fertig('k-rollback');
    rollback = false;
    const r = await sende('k-rollback');
    assert.equal(r.status, 200);
    assert.equal(await effects('k-rollback'), 1);
  });
});
