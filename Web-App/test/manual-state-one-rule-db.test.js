/**
 * A manually captured piece has ONE condition — no matter who asks for it.
 *
 * Counter-check: conditionFromAcquisitions() (src/inventory/shared.ts) always returns 'N' → red “manual parts and figures: list and valuation state the same condition”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { manualPartsList } = _req('src/parts/queries.js');
const { readManualMinifigs } = _req('src/minifigs/queries.js');
const { valueParts, valueMinifigs } = _req('src/finances/financeCalc.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { holdsMinifig, holdsPart } = require('./helpers/inventory');

const NAME = 'zustand_eine_regel';

test('manual parts and figures: list and valuation state the same condition', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run('INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,true,true)', [
    NAME,
    await bcrypt.hash('x', 4),
  ]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  try {
    // The rule: as soon as ONE acquisition is used, the piece counts as
    // used. Without an acquisition „Neu" applies.
    const faelle = [
      { nr: '3001', acquisitions: [], erwartet: 'N' },
      { nr: '3002', acquisitions: ['N'], erwartet: 'N' },
      { nr: '3003', acquisitions: ['U'], erwartet: 'U' },
      { nr: '3004', acquisitions: ['N', 'U'], erwartet: 'U' },
      { nr: '3005', acquisitions: ['N', 'N'], erwartet: 'N' },
    ];
    for (const f of faelle) {
      // Name and color label into the catalogs (migration 0034).
      await db.run(
        `INSERT INTO part_catalog (part_number,part_name) VALUES ($1,$2)
                    ON CONFLICT (part_number) DO NOTHING`,
        [f.nr, 'Teil ' + f.nr],
      );
      await db.run(
        `INSERT INTO part_color_catalog (part_number,color_id,color_name)
                    VALUES ($1,4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`,
        [f.nr],
      );
      await holdsPart(db, uid, f.nr, { quantity: 0, colorId: 4 }); // quantity 0: the acquisition behind it carries it
      await db.run(
        `INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ($1,$2)
                    ON CONFLICT (fig_number) DO NOTHING`,
        ['fig' + f.nr, 'Figur ' + f.nr],
      );
      await holdsMinifig(db, uid, 'fig' + f.nr, { quantity: 0 }); // quantity 0: the acquisition behind it carries it
      // Different days, so that „the newest acquisition" is unambiguous.
      for (const [i, z] of f.acquisitions.entries()) {
        await db.run(
          `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,4,1,0.5,$3, NOW() - make_interval(days => $4))`,
          [uid, f.nr, z, f.acquisitions.length - i],
        );
        await db.run(
          `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,1,0.5,$3, NOW() - make_interval(days => $4))`,
          [uid, 'fig' + f.nr, z, f.acquisitions.length - i],
        );
      }
    }

    const [liste, bewertung, figList, figValuation] = await Promise.all([
      manualPartsList([uid]),
      valueParts(uid, [uid]),
      readManualMinifigs([uid]),
      valueMinifigs(uid, [uid]),
    ]);

    // Self-proof: if empty lists came back, every comparison below would be
    // trivially fulfilled and the test green without having checked anything.
    for (const [was, l] of [
      ['/parts/manual', liste],
      ['parts-valuation', bewertung.parts],
      ['/minifigs/manual', figList],
      ['minifigs-valuation', bewertung.parts],
    ])
      assert.equal(l.length, faelle.length, `${was}: ${l.length} statt ${faelle.length} Einträgen`);

    const condition = (liste, schluessel, wert) => liste.find(x => x[schluessel] === wert)?.condition;

    for (const f of faelle) {
      const beschreibung =
        `Teil ${f.nr} (` + (f.acquisitions.length ? `Erfassungen ${f.acquisitions.join('+')}` : 'ohne Erfassung') + ')';

      const fromList = condition(liste, 'part_number', f.nr);
      const fromValuation = condition(bewertung.parts, 'part_number', f.nr);
      assert.equal(
        fromList,
        fromValuation,
        `${beschreibung}: /parts/manual sagt ${fromList}, die Bewertung sagt ${fromValuation}. ` +
          'Die Webapp liest die eine Antwort, die App die andere — dasselbe Teil ' +
          'trüge in den beiden Oberflächen verschiedene Plaketten.',
      );
      assert.equal(fromList, f.erwartet, `${beschreibung}: erwartet ${f.erwartet}, bekommen ${fromList}`);

      const figFromList = condition(figList, 'fig_number', 'fig' + f.nr);
      const figFromValuation = condition(figValuation.figs, 'fig_number', 'fig' + f.nr);
      assert.equal(
        figFromList,
        figFromValuation,
        `Figur fig${f.nr}: /minifigs/manual sagt ${figFromList}, die Bewertung sagt ${figFromValuation}`,
      );
      assert.equal(figFromList, f.erwartet, `Figur fig${f.nr}: erwartet ${f.erwartet}, bekommen ${figFromList}`);
    }

    // And the envelope of the two valuations is shaped the same. The topmost
    // `condition` of the parts valuation carried the PRICE default and stood directly
    // next to the `condition` per piece, which means something else — exactly the
    // confusion from which the error above arose. Nobody read it
    // (looked up in both clients).
    assert.deepEqual(Object.keys(bewertung).sort(), [
      'converted_purchase_prices',
      'currency',
      'foreign_currency_purchases',
      'parts',
      'prices_pending',
      'total_value',
      'value_total',
    ]);
    assert.deepEqual(Object.keys(figValuation).sort(), [
      'converted_purchase_prices',
      'currency',
      'figs',
      'foreign_currency_purchases',
      'prices_pending',
      'total_value',
      'value_total',
    ]);
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('the app fetches the manual pieces from their own address', () => {
  // What the app calls stands in shared/app-schnittstelle.json (generated from its source text).
  const gerufen = new Set(
    require('./helpers/contract')
      .appRoutes(_req)
      .map(r => `${r.methode} ${r.path}`),
  );
  assert.ok(gerufen.has('GET /api/v2/parts/manual'), 'Die App ruft /parts/manual nicht');
  assert.ok(gerufen.has('GET /api/v2/minifigs/manual'), 'Die App ruft /minifigs/manual nicht');
});
