/**
 * The catalog no longer triggers more images than someone looks at.
 *
 * Counter-check: catalogPage() (src/catalog/service.ts) calls k.images.loadSetImage for every row → red “the catalog list triggers no image work at all”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The image download via the services' image machinery: counted, without network.
let kicked = 0;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async () => {
    kicked++;
    await new Promise(r => setTimeout(r, 2));
    return null;
  },
});
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('the catalog list triggers no image work at all', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `bq-${process.pid}`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`);
  await db.run(`INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT 'BQ'||g, 'S'||g, 2020, 1, 100, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,600) g`);
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, { session: { userId: uid }, t });

  try {
    // Ten pages in quick succession — as when scrolling through.
    for (let page = 1; page <= 10; page++)
      await (await fetch(`${base}/api/v2/catalog/sets?limit=60&page=${page}&sort=year_desc`)).json();
    // Wait until the queue would have run through.
    await new Promise(r => setTimeout(r, 2500));

    // The cap became a zero
    assert.equal(
      kicked,
      0,
      `${kicked} image jobs from the LIST. It must not trigger any ` +
        'anymore — every call from here bypasses all throttling.',
    );
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE 'BQ%'`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
