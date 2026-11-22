/**
 * Missing images are fetched ONCE — not anew per process and visit.
 *
 * Counter-check (14.11.2026): in isKnownMissing `k.uhr.jetzt()` → `Date.now()` → red:
 * “after a week the search happens again” (the services' clock had no effect).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The image download via the services' image machinery: null = the CDN has no image.
let versuche = 0;

const { buildAndRequire, testData, testImageWorker, testClock } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  loadSetImage: async () => {
    versuche++;
    return null;
  },
});
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('imageless sets are not searched for at the CDN again and again', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NUTZER = `im-${process.pid}`;
  const PREFIX = `IM${process.pid}_`;
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (id INT PRIMARY KEY, name TEXT, parent_id INT)`);
  await db.run(`INSERT INTO rb_themes (id,name,parent_id) VALUES (1,'T',NULL) ON CONFLICT DO NOTHING`);
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PREFIX + '%']);
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PREFIX + '%']).catch(() => {});
  // A year without images — like 1958 in the real catalog.
  await db.run(
    `INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT $1||g, 'Alt', 1958, 1, 50, 'https://example.invalid/'||g||'.jpg'
                  FROM generate_series(1,60) g`,
    [PREFIX],
  );
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  // The queue works concurrently — wait briefly after the fetch.
  const visit = async () => {
    await (await fetch(`${base}/api/v2/catalog/sets?limit=60&page=1&q=${PREFIX}`)).json();
    await new Promise(r => setTimeout(r, 700));
  };

  try {
    // Since an earlier round the list triggers no image work at all anymore (it ran
    // past all throttles). The path now leads via the proxy and
    // src/images/imageDemandRun.ts — what is checked is therefore the MARKER itself, no longer
    // the list.
    await visit();
    assert.equal(versuche, 0, `${versuche} downloads from the list — it must not trigger any more`);

    await t.test('another process knows about it', async () => {
      // The core of the matter: the server runs in a cluster. A marker in
      // memory only helps THE process that created it — with four
      // worker processes the same image is fetched four times.
      const IM = _req('src/images/imageMisses.js');
      IM.rememberMissing('set:' + PREFIX + '_probe');
      await IM._writeBuffer();
      IM._emptyForeground();
      assert.equal(IM.isKnownMissing('set:' + PREFIX + '_probe'), false, 'Precondition: the memory is empty');
      await IM._refresh();
      assert.equal(
        IM.isKnownMissing('set:' + PREFIX + '_probe'),
        true,
        'Without the table the knowledge is gone after a restart — then ' +
          'every worker process searches from scratch',
      );
    });

    await t.test('after a week it is searched again (set clock instead of waiting)', () => {
      const IM = _req('src/images/imageMisses.js');
      IM.rememberMissing('set:' + PREFIX + '_frist');
      assert.equal(IM.isKnownMissing('set:' + PREFIX + '_frist'), true);
      testClock().ago(7 * 24 * 60 * 60 * 1000 + 1);
      try {
        assert.equal(IM.isKnownMissing('set:' + PREFIX + '_frist'), false, 'the deadline has expired');
      } finally {
        testClock().back();
      }
    });

    await t.test('an image that exists is not remembered', async () => {
      // Opposite direction: otherwise the test would also be green if everything counted
      // as missing wholesale — and no image would ever be loaded.
      const IM = _req('src/images/imageMisses.js');
      IM._emptyForeground();
      assert.equal(IM.isKnownMissing('set:gibt-es-nicht-in-der-tabelle'), false);
    });
  } finally {
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [PREFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + PREFIX + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
