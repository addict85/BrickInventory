/**
 * The own catalog is asked BEFORE Rebrickable.
 *
 * ── Counter-checks (MEASURED on 20.10., numbers copied down) ─────────────────
 *
 * Starting point: `# pass 9 / # fail 0` (eight cases and their shell). Every
 * counter-check is ONE change, reverted afterwards (the three files
 * were compared against their backup).
 *
 *   A  the catalogPart() pre-pass removed when adding a part (i.e. the state
 *      of Marco's finding)
 *      → `pass 4 / fail 5`. Red are FOUR cases: “name and color image in the
 *        catalog — no fetch", “image as file counts too", “without color
 *        the general image counts" and “the name comes from the catalog".
 *        The first reports `[ 'lookupPart 3001/4' ] instead of []` — Marco's finding
 *        in numbers.
 *   B  `hatImage` in the condition replaced by `image_url` (i.e. not letting the file
 *      count as evidence)
 *      → `pass 7 / fail 2`. Red: “image as file counts too". Exactly for that
 *        the field exists; without it every downloaded image would again be
 *        a fetch.
 *   C  in catalogPart() `rb_parts.part_img_url` counted as a hit even with
 *      a color
 *      → `pass 7 / fail 2`. Red: “name yes, color image no — it is asked".
 *        That is the barrier against the white image.
 *
 *        This counter-check stayed GREEN on the first attempt, and that was no
 *        praise for the barrier but a gap in the test: for 3003 there was
 *        no rb_parts row at all, so the general image could not
 *        interfere. The row is below now — it is the reason
 *        why this case checks anything at all.
 *   D  the catalogMinifig() pre-pass removed when adding a minifigure
 *      → `pass 7 / fail 2`. Red: “minifigure with name and image — no fetch".
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

// Rebrickable provided at the wiring (testSources); `fetches` counts what was asked.
let fetches = [];
testSources(null, {
  lookupPart: async (nr, farbe) => {
    fetches.push(`lookupPart ${nr}/${farbe}`);
    return { part_name: 'VON REBRICKABLE', category_name: '42', image_url: 'https://cdn.example/rb.jpg' };
  },
  getMinifigInfo: async nr => {
    fetches.push(`getMinifigInfo ${nr}`);
    return { fig_number: nr, fig_name: 'VON REBRICKABLE', image_url: 'https://cdn.example/rb-fig.jpg' };
  },
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('the own catalog is asked before Rebrickable', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const UID = (await db.get(`INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;

  // The price fetch is not the question here and should not interfere:
  // without BrickLink access fetchPartPrice aborts by itself, and
  // marketPriceWithOrigin catches it (preis: null).
  await db.run(`INSERT INTO part_catalog (part_number,part_name,category_name) VALUES
                  ('3001','Brick 2 x 4','Bricks'),
                  ('3002','Brick 2 x 2','Bricks'),
                  ('3003','Brick 2 x 3','Bricks')`);
  // 3001/4: name AND color image as URL. 3002/4: image only as FILE.
  // 3003 stands without any color image.
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_url) VALUES
                  ('3001',4,'https://cdn.example/3001-4.jpg')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_local) VALUES
                  ('3002',4,'/images/parts/3002-4.jpg')`);
  // 3003 carries a GENERAL image in rb_parts. That is the case where
  // it is decided whether the barrier against the white image holds: if one counted
  // it as a hit with a given color, the color fetch would not happen and the
  // general image would stay permanently on the red variant. Without this row
  // counter-check C had stayed green — the barrier was unchecked.
  await db.run(`INSERT INTO rb_parts (part_num,name,part_img_url) VALUES
                  ('3003','Brick 2 x 3','https://cdn.example/3003-weiss.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url) VALUES
                  ('fig-000123','Chewbacca','https://cdn.example/chewie.jpg'),
                  ('fig-000456','Luke',NULL)`);

  const { addManualPart } = _req('src/parts/manualParts.js');
  const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');

  /** Create a part and count what went outside in doing so. */
  const putPart = async (nr, farbe) => {
    fetches = [];
    await addManualPart(UID, { part_number: nr, color_id: farbe, quantity: 1 });
    return fetches.filter(a => a.startsWith('lookupPart'));
  };

  await t.test('name and color image in the catalog — no fetch', async () => {
    assert.deepEqual(
      await putPart('3001', 4),
      [],
      'Both are available locally. Every fetch here is the one Marco measured',
    );
  });

  await t.test('an image as a file counts too', async () => {
    assert.deepEqual(
      await putPart('3002', 4),
      [],
      'image_local is a path and must not go through V.optionalImageUrl — ' +
        'but it proves that the fetch has nothing left to get',
    );
  });

  await t.test('name yes, color image no — it is asked', async () => {
    assert.deepEqual(
      await putPart('3003', 4),
      ['lookupPart 3003/4'],
      'The superfluous fetch is to be saved, not the necessary one. ' +
        'rb_parts.part_img_url exists and must NOT replace the color fetch',
    );
    const z = await db.get(`SELECT image_url FROM part_color_catalog WHERE part_number='3003' AND color_id=4`);
    assert.equal(
      z?.image_url,
      'https://cdn.example/rb.jpg',
      'What lookupPart delivered for THIS color is written — ' + 'not the general image from rb_parts',
    );
  });

  await t.test('without color the generic image counts', async () => {
    // The flip side of the case above: without a given color there is no
    // color-correct expectation, and lookupPart itself only fetches the
    // general image there. Then the fetch really is superfluous.
    fetches = [];
    await addManualPart(UID, { part_number: '3003', quantity: 1 });
    assert.deepEqual(fetches, [], 'rb_parts carries the name and the general image — the fetch gets nothing more here');
  });

  await t.test('not in the catalog at all — it is asked', async () => {
    assert.deepEqual(
      await putPart('99999zzz', 4),
      ['lookupPart 99999zzz/4'],
      'Without a local entry Rebrickable is the only source',
    );
  });

  await t.test('the name comes from the catalog, not from Rebrickable', async () => {
    // The counter-check of the first case: that nothing was asked should not
    // mean that the name is missing. The double's default value is
    // “VON REBRICKABLE" — it must not appear anywhere here.
    await db.run("DELETE FROM parts WHERE user_id=$1 AND part_number='3001'", [UID]);
    fetches = [];
    const r = await addManualPart(UID, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.equal(
      r.part_name,
      'Brick 2 x 4',
      'The catalog name, not that of the duplicate — otherwise nothing would be saved but lost',
    );
    assert.deepEqual(fetches, []);
  });

  await t.test('figure with name and image — no fetch', async () => {
    fetches = [];
    const r = await addManualMinifig(UID, { fig_number: 'fig-000123', quantity: 1 });
    assert.deepEqual(fetches, [], 'minifigs_catalog carries name and image');
    assert.equal(r.fig_name, 'Chewbacca');
  });

  await t.test('figure without image — it is asked', async () => {
    fetches = [];
    await addManualMinifig(UID, { fig_number: 'fig-000456', quantity: 1 });
    assert.deepEqual(
      fetches,
      ['getMinifigInfo fig-000456'],
      'The name alone is not enough: the image really is missing',
    );
  });
});
