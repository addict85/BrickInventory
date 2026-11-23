/**
 * Add only what is meant: POST /sets takes a typed set number,
 * not a sentence from which the lenient normalization made a set; and
 * “take over from the wishlist” requires a wishlist item.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in POST /sets the check of the raw number removed → red: “a sentence
 *      is not a set number” (200, set 1-1 created) and thereby also “without
 *      wishlist item …” (the set already exists)
 *   B  in uebernimm() the check for the wishlist item removed → red: “without
 *      wishlist item …” (200, set created)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('capture only what is meant', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `streng_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { session: { userId: uid, username: NAME }, t });
  const post = async (route, body) => {
    const r = await fetch(`${base}/api/v2${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json()).code };
  };
  const sets = async () =>
    (await db.all('SELECT set_number FROM sets WHERE user_id = $1', [uid])).map(z => z.set_number);

  await t.test('a sentence is not a set number', async () => {
    for (const raw of ["1'; DROP TABLE sets;--", '75192 Millennium Falcon', '75192;2'])
      assert.deepEqual(await post('/sets', { set_number: raw }), { status: 400, code: 'set_number_invalid' }, raw);
    assert.deepEqual(await sets(), []);
  });

  await t.test('without a wishlist item nothing is adopted', async () => {
    assert.deepEqual(await post('/wanted/75192-1/N/take-over', {}), { status: 404, code: 'not_found' });
    assert.deepEqual(await sets(), []);
  });
});
