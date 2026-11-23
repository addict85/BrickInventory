/**
 * Deleting a foreign entry gives 404 and changes nothing — for parts and
 * minifigures as for sets. Previously parts and minifigures answered with success without
 * doing anything, and the caller could not tell the difference.
 *
 * Counter-check (measured on 28.10.2026): in the DELETE route the 404 line
 * removed → red: both substeps (200 instead of 404).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

const A = `fremd_a_${process.pid}`,
  B = `fremd_b_${process.pid}`;

test('delete foreign acquisitions', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[A, B]]);
  const fresh = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  const a = await fresh(A),
    b = await fresh(B);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    await db.pool.end().catch(() => {});
  });
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001', 4, 'manual')`, [b]);
  const part = (
    await db.get(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition)
    VALUES ($1, '3001', 4, 2, 'N') RETURNING id`,
      [b],
    )
  ).id;
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'sw0001', 'manual')`, [b]);
  const minifig = (
    await db.get(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, condition)
    VALUES ($1, 'sw0001', 1, 'N') RETURNING id`,
      [b],
    )
  ).id;

  const { base } = testServer(_req, { session: { userId: a }, t });
  const removeIt = path => fetch(base + path, { method: 'DELETE' }).then(r => r.status);

  await t.test('Teil', async () => {
    assert.equal(await removeIt(`/api/v2/parts/3001/4/acquisitions/${part}`), 404);
    assert.ok(await db.get('SELECT 1 FROM part_acquisitions WHERE id = $1', [part]), 'the foreign row is gone');
  });
  await t.test('figure', async () => {
    assert.equal(await removeIt(`/api/v2/minifigs/sw0001/acquisitions/${minifig}`), 404);
    assert.ok(await db.get('SELECT 1 FROM minifig_acquisitions WHERE id = $1', [minifig]), 'the foreign row is gone');
  });
});
