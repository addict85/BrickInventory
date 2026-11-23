/**
 * If a local image file is missing, the server finds the CDN address via the
 * file name stem — with an index per image table (migration 0067) instead of
 * LIKE '%/stamm.%' over six tables, which could use no index and ended
 * with an error on three tables without image_local.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in the query again `image_local LIKE '%/' || $1 || '.%'` instead of
 *      image_master(image_local) = $1 → red: “every image table asks via its
 *      index” (the partial indexes are only scanned, no Index Cond)
 *   B  imageMasterFromPath leaves _thumb → red: “a missing preview
 *      finds the address of the part image”
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
const db = testData();

test('image address via the file name stem', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const { cdnForMissingImage, CDN_QUERY } = _req('src/images/imageLookup.js');
  const P = `bst${process.pid}`;
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local)
                VALUES ($1, 4, 'https://cdn.rebrickable.com/media/parts/x.png', $2)`,
    [P, `/images/parts/${P}_4.png`],
  );
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, image_url, image_local) VALUES ($1, 'https://cdn.rebrickable.com/f.jpg', $2)`,
    [`fig-${P}`, `/images/minifigs/fig-${P}.jpg`],
  );
  await catalogSet(db, `${P}-1`, {
    name: 'Test',
    image_url: 'https://img.bricklink.com/s.png',
    image_local: `/images/sets/${P}-1.png`,
  });

  try {
    await t.test('a missing preview finds the address of the part image', async () => {
      assert.equal(
        await cdnForMissingImage(`/images/parts/${P}_4_thumb.jpg`),
        'https://cdn.rebrickable.com/media/parts/x.png',
      );
    });
    await t.test('figures and sets', async () => {
      assert.equal(await cdnForMissingImage(`/images/minifigs/fig-${P}.jpg`), 'https://cdn.rebrickable.com/f.jpg');
      assert.equal(await cdnForMissingImage(`/images/sets/${P}-1.png`), 'https://img.bricklink.com/s.png');
      assert.equal(await cdnForMissingImage(`/images/sets/${P}-9.png`), null);
    });
    await t.test('every image table asks via its index', async () => {
      const plan = await db.transaction(async tx => {
        await tx.run('SET LOCAL enable_seqscan = off');
        return (await tx.all(`EXPLAIN ${CDN_QUERY.replaceAll('$1', `'${P}_4'`)}`)).map(z => z['QUERY PLAN']).join('\n');
      });
      // set_minifigs_catalog has been a view on minifigs_catalog since migration 0072.
      for (const ix of [
        'idx_part_color_catalog_image_master',
        'idx_minifigs_catalog_image_master',
        'idx_set_catalog_image_master',
      ])
        assert.ok(plan.includes(ix), `${ix} is missing in the plan:\n${plan}`);
      // Not only scanned but searched via the stem: without a search key
      // the planner would read the partial index fully with Seq Scan switched off.
      const sought = plan.match(/Index Cond: \(regexp_replace\(regexp_replace\(image_local/g) || [];
      assert.equal(sought.length, 3, `not every table searches via the master:\n${plan}`);
    });
  } finally {
    await db.run('DELETE FROM part_color_catalog WHERE part_number=$1', [P]);
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number=$1', [`fig-${P}`]);
    await db.run('DELETE FROM set_catalog WHERE set_number=$1', [`${P}-1`]);
    await db.pool.end().catch(() => {});
  }
});
