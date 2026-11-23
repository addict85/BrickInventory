/**
 * The set images follow-up only loads images for sets with a reference and does not ask
 * an imageless set (404) again on every start.
 *
 * Counter-checks (carried out):
 * - reference condition removed from setImagesWithoutFile → „nur Katalog“ stands in the
 *   selection, part 1 red.
 * - rememberMissing removed in the follow-up → the 404 set stands in the selection again
 *   in the second run, part 2 red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/** Intercepted download: status code per set, no network. */
const antworten = new Map();
const requested = [];

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async (_url, sn, info) => {
    requested.push(sn);
    const status = antworten.get(sn);
    if (status && info) info.status = status;
    return null;
  },
});
const { dataOrSkip } = require('./helpers/db');
const { holdsSet, catalogSet } = require('./helpers/inventory');
const db = testData();

test('set image follow-up run: only sets with a reference, 404 rests', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const repo = _req('src/catalog/repository/imageState.js');
  const { READ_CONTRACT } = _req('src/services.js');
  const { reloadSetImages } = _req('src/catalog/imageState.js');
  const IM = _req('src/images/imageMisses.js');

  const P = `zzbn${process.pid}`;
  const gehalten = `${P}a-1`;
  const onlyCatalog = `${P}b-1`;
  const gemerkt = `${P}c-1`;
  const imageless = `${P}d-1`;
  const alle = [gehalten, onlyCatalog, gemerkt, imageless];

  const USER = `bildnachlauf-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [USER])).id;
  for (const sn of alle) await catalogSet(db, sn, { image_url: `https://cdn.example/${sn}.jpg` });
  await holdsSet(db, uid, gehalten, 1);
  await holdsSet(db, uid, imageless, 1);
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N')`, [uid, gemerkt]);
  await db.run(
    `INSERT INTO image_misses (cache_key, checked_at, reason) VALUES ($1, NOW(), 'HTTP 404 vom CDN')
     ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW()`,
    ['set:' + gemerkt],
  );
  const eigene = async () =>
    (await repo.setImagesWithoutFile(db, READ_CONTRACT)).map(r => r.set_number).filter(sn => sn.startsWith(P));

  try {
    await t.test('selection: held sets yes, pure catalog records and fresh 404 no', async () => {
      assert.deepEqual(await eigene(), [gehalten, imageless]);
    });

    await t.test('a 404 is noted and missing in the next run', async () => {
      IM._emptyForeground();
      antworten.set(imageless, 404);
      requested.length = 0;
      await reloadSetImages();
      await IM._writeBuffer();
      assert.deepEqual(
        requested.filter(sn => sn.startsWith(P)),
        [gehalten, imageless],
      );
      const m = await db.get(`SELECT reason FROM image_misses WHERE cache_key = $1`, ['set:' + imageless]);
      assert.match(m?.reason ?? '', /404/);
      // Without a status code (network outage) the set stays in the selection.
      assert.deepEqual(await eigene(), [gehalten]);
    });
  } finally {
    await db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [alle.map(sn => 'set:' + sn)]);
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]);
    await db.run(`DELETE FROM rb_sets WHERE set_num = ANY($1::text[])`, [alle]);
    await db.pool.end().catch(() => {});
  }
});
