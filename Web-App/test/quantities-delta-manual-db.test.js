/**
 * quantity_delta for manual parts and figures too: two devices that
 * send „+1" at the same time result in +2 — with an absolute quantity the one
 * sent last won. Checked via the route (the response carries the quantity) and
 * via the service (concurrency).
 *
 * Counter-checks (measured 31.10.2026):
 *   A  in adjustManualQuantity the target quantity from `upfront` instead of from the
 *      acquisitions read inside the lock → red: “two concurrent +1” (3 instead of 4)
 *   B  mengenwunsch() without the quantity_delta branch → red: all cases
 *   C  lower limit AT_LEAST set to 0 → red: “a step below 1 stays at 1”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');

const NAME = `mdelta_${process.pid}`,
  TEIL = '3001md',
  FIGUR = 'fig-md01';

test('quantity_delta for manual parts and minifigures', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, TEIL]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, $2, 5, 2)`, [
    uid,
    TEIL,
  ]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, $2, 'manual')`, [uid, FIGUR]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity) VALUES ($1, $2, 1)`, [uid, FIGUR]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { changeManualPart } = _req('src/parts/manualParts.js');
  const { updateManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  const teil = async () =>
    Number(
      (
        await db.get(
          'SELECT COALESCE(SUM(quantity),0)::int q FROM part_acquisitions WHERE user_id=$1 AND part_number=$2',
          [uid, TEIL],
        )
      ).q,
    );
  const figur = async () =>
    Number(
      (
        await db.get(
          'SELECT COALESCE(SUM(quantity),0)::int q FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2',
          [uid, FIGUR],
        )
      ).q,
    );

  await t.test('two concurrent +1 result in +2', async () => {
    await Promise.all([
      changeManualPart(uid, TEIL, 5, { quantity_delta: 1 }),
      changeManualPart(uid, TEIL, 5, { quantity_delta: 1 }),
    ]);
    assert.equal(await teil(), 4);
    await Promise.all([
      updateManualMinifig(uid, FIGUR, { quantity_delta: 1 }),
      updateManualMinifig(uid, FIGUR, { quantity_delta: 1 }),
    ]);
    assert.equal(await figur(), 3);
  });

  await t.test('via the route: step down, response with the quantity afterwards', async () => {
    const { base } = testServer(_req, { t, sitzung: { userId: uid } });
    const put = (path, body) =>
      fetch(`${base}/api/v2/${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    assert.deepEqual(await put(`parts/${TEIL}/5`, { quantity_delta: -1 }), {
      status: 200,
      body: { success: true, quantity: 3 },
    });
    assert.deepEqual(await put(`minifigs/${FIGUR}`, { quantity_delta: -2 }), {
      status: 200,
      body: { success: true, quantity: 1 },
    });
    assert.equal((await put(`parts/${TEIL}/5`, { quantity_delta: 1.5 })).status, 400);
    assert.equal(await teil(), 3);
  });

  await t.test('a step below 1 stays at 1 — deleting only via delete', async () => {
    assert.deepEqual(await changeManualPart(uid, TEIL, 5, { quantity_delta: -10 }), { quantity: 1 });
    assert.equal(await teil(), 1);
  });
});
