/**
 * After moving a set EVERY component in the target account has its image.
 *
 * Counter-check: in src/sets/setMove.ts copyContents() skipped → red “a moved set takes the image paths of all its components along”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

test('a moved set takes the image paths of all its components along', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const p = String(process.pid).slice(-5);
  const VON = `mv_von_${p}`,
    NACH = `mv_nach_${p}`;
  const SN = `81${p}-1`,
    PN = `pt${p}`,
    FN = `fig${p}`;
  const PATH_PART = `/img/parts/${PN}.png`;
  const PATH_MINIFIG = `/img/minifigs/${FN}.png`;

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [VON, NACH]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [VON, NACH]);
  const ofId = (await db.get(`SELECT id FROM users WHERE username=$1`, [VON])).id;
  const nachId = (await db.get(`SELECT id FROM users WHERE username=$1`, [NACH])).id;

  try {
    await holdsSet(db, ofId, SN, 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`,
      [ofId, SN],
    );
    // Both components come FROM THE SET (source='set') and have a
    // cached image — exactly the case the image job produces.
    // Since migration 0034 the image stands in the catalog, the stock in
    // parts/minifigs.
    await db.run(
      `INSERT INTO part_color_catalog (part_number,color_id,image_local)
                  VALUES ($1,4,$2)
                  ON CONFLICT (part_number,color_id) DO UPDATE SET image_local=EXCLUDED.image_local`,
      [PN, PATH_PART],
    );
    await db.run(
      `INSERT INTO minifigs_catalog (fig_number,fig_name,image_local)
                  VALUES ($1,'Testfigur',$2)
                  ON CONFLICT (fig_number) DO UPDATE SET image_local=EXCLUDED.image_local`,
      [FN, PATH_MINIFIG],
    );
    await holdsPart(db, ofId, PN, { setNumber: SN, quantity: 2, colorId: 4 });
    await holdsMinifig(db, ofId, FN, { setNumber: SN, quantity: 1 });

    // Like the collection: in one transaction via its context; two foreign accounts only in the system frame.
    const { inSystemContext } = _req('src/infra/accountContext.js');
    const sammlung = require('./helpers/sources').testContext('collection');
    await inSystemContext('Testdaten', () => sammlung.transact(tt => tt.sets.setEntriesReassign(SN, ofId, nachId)));

    // Read via the same JOIN that the UIs use — i.e.
    // via the effect. A query on parts.image_local no longer exists,
    // and it would also be the wrong question: the user wants to see the image, and
    // whether it is copied or looked up does not matter to him.
    const teil = await db.get(
      `SELECT pcc.image_local
         FROM parts p
         LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                         AND pcc.color_id    = p.color_id
        WHERE p.user_id=$1 AND p.part_number=$2`,
      [nachId, PN],
    );
    const figur = await db.get(
      `SELECT mc.image_local
         FROM minifigs m
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
        WHERE m.user_id=$1 AND m.fig_number=$2`,
      [nachId, FN],
    );

    assert.ok(teil, 'Das Teil ist im Zielkonto gar nicht angekommen');
    assert.ok(figur, 'Die Minifigur ist im Zielkonto gar nicht angekommen');

    assert.equal(
      figur.image_local,
      PATH_MINIFIG,
      `Die verschobene Minifigur hat image_local=${figur.image_local} statt "${PATH_MINIFIG}". ` +
        'Das Figurenbild ist im Zielkonto nicht sichtbar, und bis zum nächsten ' +
        'Serverstart kommt es wieder über den Proxy vom CDN.',
    );
    assert.equal(
      teil.image_local,
      PATH_PART,
      `Das verschobene Teil hat image_local=${teil.image_local} statt "${PATH_PART}".`,
    );

    // The actual rule: both branches deliver the same result.
    assert.deepEqual(
      { teil: teil.image_local !== null, figur: figur.image_local !== null },
      { teil: true, figur: true },
      'Teile und Minifiguren kommen beim Verschieben verschieden heraus — ' +
        'copyContents() kopiert zwei Tabellen mit derselben Absicht, und bei ' +
        'einer davon fehlt hinterher das Bild.',
    );
  } finally {
    for (const uid of [ofId, nachId]) {
      await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM minifigs WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    }
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [VON, NACH]).catch(() => {});
    // The catalog rows hang on no account and would otherwise remain.
    await db.run(`DELETE FROM part_color_catalog WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM minifigs_catalog WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
