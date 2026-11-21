/**
 * The name lookup /sets/info/:setNumber stands in routes/api_v1/sets.ts before
 * /sets/:setNumber/…: otherwise a number that looks like a path word of the first lands there:
 * GET /api/v1/sets/info/price-history hit /sets/:setNumber/price-history with …
 *
 * Counter-check (measured on 29.10.2026): the route /sets/info/:setNumber put behind
 * the routes /sets/:setNumber/… → red:
 * “a path word as set number” (the response came from the price history).
 *
 * A placeholder („Set <Nummer>“ without year, theme, parts) that addSet creates without
 * a catalog hit only reveals that some account has the number
 * (security review round 13, H3). Counter-checks (measured 04.11.2026):
 *   A  in GET /sets/info the refusal for `platzhalter` deleted → red: “a
 *      foreign placeholder …”
 *   B  setStamm() always delivers `platzhalter` true → red: “an ordinary
 *      number”, “a path word …” (the catalog entry no longer counts)
 *   C  the refusal without scope (every placeholder counts as foreign) → red: „ein
 *      eigener Platzhalter …“
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('the name lookup under /api/v1/sets is unambiguous', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `setinfo-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}-f`]]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const fremdId = (
    await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`${NAME}-f`])
  ).id;
  const [fremd, eigen, nie] = [`${process.pid}7-1`, `${process.pid}8-1`, `${process.pid}9-1`];
  const nummern = ['price-history-1', `${process.pid}-1`, fremd, eigen];
  for (const [i, name] of ['Pfadwort', 'Gewöhnlich', null, null].entries())
    await catalogSet(db, nummern[i], { name: name ?? `Set ${nummern[i]}` });
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [fremdId, fremd, uid, eigen]);
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: false }, t });

  try {
    await t.test('an ordinary number', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/${process.pid}-1`)).json();
      assert.equal(r.name, 'Gewöhnlich');
    });
    await t.test('a path word as set number', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/price-history`)).json();
      assert.equal(r.set_number, 'price-history-1', JSON.stringify(r));
      assert.equal(r.name, 'Pfadwort');
    });
    const info = async sn => (await fetch(`${base}/api/v1/sets/info/${sn}`)).json();
    await t.test('a foreign placeholder responds like a never entered number', async () => {
      assert.deepEqual(await info(nie), { success: true, set_number: nie, name: nie, im_katalog: false });
      assert.deepEqual(await info(fremd), { success: true, set_number: fremd, name: fremd, im_katalog: false });
    });
    await t.test('an own placeholder and a catalog entry apply', async () => {
      const e = await info(eigen);
      assert.deepEqual([e.name, e.im_katalog], [`Set ${eigen}`, true], 'ein eigener Platzhalter …');
      const k = await info(`${process.pid}-1`);
      assert.deepEqual([k.name, k.im_katalog, 'platzhalter' in k], ['Gewöhnlich', true, false], 'ein Katalogeintrag …');
    });
  } finally {
    await db.run('DELETE FROM sets WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremdId]]);
    await db.pool.end().catch(() => {});
  }
});
