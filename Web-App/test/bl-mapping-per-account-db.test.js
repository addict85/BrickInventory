/**
 * A BrickLink number entered by hand applies only to the account that
 * enters it (bl_mapping_custom, migration 0094). Two accounts without a household:
 * Anna corrects during the wanted import and on her minifigure, Bruno still sees
 * the shared mapping — in price fetch, minifigure price, valuation and …
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  routes/api_v1/wanted.ts: rememberNumber always writes rememberBlNumber →
 *      red: all seven subtests (Anna's 3001 fills the note for 3003)
 *   B  db/blMappingSql.ts: blNumberSql without `_e.bl_id` → red: “valuation”
 *      (Anna sees the shared number)
 *   C  resolveBlPartNumber() ignores `konto` → red: “price fetch”
 *   D  writeBlNumber() back with `DO UPDATE SET bl_id=…` without WHERE → red:
 *      “the shared mapping is only filled, never replaced”
 *   E  manualMinifigs.ts writes the BrickLink no. with rememberBlNumber again →
 *      red: “the BrickLink no. of an own minifigure …”
 *
 * As in production every service queries on behalf of its account (asAccount) as runtime role;
 * the owner writes the test data.
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const item = (typ, id, farbe) =>
  `<ITEM><ITEMTYPE>${typ}</ITEMTYPE><ITEMID>${id}</ITEMID>` +
  (farbe === null ? '' : `<COLOR>${farbe}</COLOR>`) +
  '<MINQTY>1</MINQTY><CONDITION>N</CONDITION></ITEM>';
const liste = (...i) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>${i.join('')}</INVENTORY>\n`;

async function hochladen(base, xml, korrekturen) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  fd.append('korrekturen', JSON.stringify(korrekturen));
  const r = await fetch(`${base}/api/v1/wanted-list/import/xml?schreiben=1`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('BrickLink mapping per account', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  importWorker(t, _req);
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const neu = async name =>
    (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  const ANNA = await neu('anna'),
    BRUNO = await neu('bruno');
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2 x 4'), ('3003','Brick 2 x 2')`,
  );
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, image_url)
                VALUES ('3001',4,'Red','https://cdn.rebrickable.com/a.jpg'), ('3003',4,'Red','https://cdn.rebrickable.com/b.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
                VALUES ('fig-000001','Han Solo','https://cdn.rebrickable.com/f.jpg')`);
  await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);
  // Checked: 3003 is called the same at BrickLink, the minifigure sw0001.
  await db.run(
    `INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('part','3003',NULL), ('fig','fig-000001','sw0001')`,
  );
  const gemeinsam = async () =>
    (await db.all('SELECT type, rb_id, bl_id FROM bl_mapping ORDER BY type, rb_id')).map(
      z => `${z.type}|${z.rb_id}|${z.bl_id}`,
    );
  const vorher = await gemeinsam();

  // Bruno holds the same things so that his valuation has rows.
  const { addManualPart } = _req('src/parts/manualParts.js');
  const { addManualMinifig, updateManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  await asAccount(BRUNO, async () => {
    await addManualPart(BRUNO, { part_number: '3003', color_id: 4, quantity: 1, unit_price: 1 });
    await addManualMinifig(BRUNO, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });
  });

  const anna = testServer(_req, { sitzung: { userId: ANNA }, t });

  await t.test("the import only writes Anna's mapping", async () => {
    const { status, body } = await hochladen(anna.base, liste(item('M', 'sw0001a', null), item('P', '3001', 5)), [
      { index: 0, blId: 'sw0001a', art: 'fig', rbId: 'fig-000001' },
      { index: 1, blId: '3001', art: 'part', rbId: '3003', rbFarbe: 4 },
    ]);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.korrekturen?.angewandt, 2, JSON.stringify(body.korrekturen));
    assert.deepEqual(await gemeinsam(), vorher, 'die gemeinsame Zuordnung hat sich verändert');
    const eigen = await db.all('SELECT user_id, type, rb_id, bl_id FROM bl_mapping_custom ORDER BY type');
    assert.deepEqual(
      eigen.map(z => `${z.user_id}|${z.type}|${z.rb_id}|${z.bl_id}`),
      [`${ANNA}|fig|fig-000001|sw0001a`, `${ANNA}|part|3003|3001`],
    );
  });

  const { resolveBlPartNumber, fetchPartPrice } = _req('src/finances/calculation/prices.js');
  const { blNumberOf } = _req('src/catalog/blMapping.js');

  await t.test('price fetch: Anna asks BrickLink for 3001, Bruno for 3003', async () => {
    assert.equal(await asAccount(ANNA, () => resolveBlPartNumber('3003', ANNA)), '3001');
    assert.equal(await asAccount(BRUNO, () => resolveBlPartNumber('3003', BRUNO)), '3003');
    assert.equal(await resolveBlPartNumber('3003'), '3003', 'ohne Konto gilt die gemeinsame Zuordnung');
    // The fetch itself reads the price under the translated number.
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, fetched_at)
                  VALUES ('3001',5,'N','EUR',7,NOW()), ('3003',5,'N','EUR',2,NOW())`);
    const preis = uid => asAccount(uid, () => fetchPartPrice('3003', 4, 'N', 'EUR', 24, null, uid));
    assert.equal(Number((await preis(ANNA))?.avg_price), 7);
    assert.equal(Number((await preis(BRUNO))?.avg_price), 2);
  });

  await t.test('figure price: every account by its number', async () => {
    assert.equal(await asAccount(ANNA, () => blNumberOf('fig', 'fig-000001', ANNA)), 'sw0001a');
    assert.equal(await asAccount(BRUNO, () => blNumberOf('fig', 'fig-000001', BRUNO)), 'sw0001');
  });

  await t.test('valuation: numbers per account', async () => {
    const repo = require('./helpers/sources').testArea('finances').valuation;
    // Every account values its stock; two foreign accounts are never in one valuation.
    const je2 = async f => [...(await asAccount(ANNA, () => f([ANNA]))), ...(await asAccount(BRUNO, () => f([BRUNO])))];
    const figuren = await je2(ids => repo.manualMinifigsToValuation(ids));
    const teile = await je2(ids => repo.manualPartsToValuation(ids));
    const je = (zeilen, feld) => Object.fromEntries(zeilen.map(z => [z.user_id, z[feld]]));
    assert.deepEqual(je(figuren, 'bl_fig_number'), { [ANNA]: 'sw0001a', [BRUNO]: 'sw0001' });
    assert.deepEqual(je(teile, 'bl_part_number'), { [ANNA]: '3001', [BRUNO]: '3003' });
  });

  await t.test("the next import: Anna's correction resolves for Anna, not for Bruno", async () => {
    const { resolveLocalOn } = _req('src/wanted/wantedResolution.js');
    const { readWantedList } = _req('src/wanted/wantedParser.js');
    const { posten } = readWantedList(liste(item('P', '3001', 5)));
    assert.equal((await asAccount(ANNA, () => resolveLocalOn(posten, ANNA)))[0].rbId, '3003');
    const bruno = (await asAccount(BRUNO, () => resolveLocalOn(posten, BRUNO)))[0];
    assert.equal(bruno.rbId, '3001');
    assert.equal(bruno.sicherheit, 'katalogtreffer');
  });

  await t.test('the BrickLink no. of an own figure stays with the account', async () => {
    await asAccount(BRUNO, () => updateManualMinifig(BRUNO, 'fig-000001', { bl_fig_number: 'sw9999' }));
    assert.deepEqual(await gemeinsam(), vorher);
    assert.equal(await asAccount(BRUNO, () => blNumberOf('fig', 'fig-000001', BRUNO)), 'sw9999');
    assert.equal(await asAccount(ANNA, () => blNumberOf('fig', 'fig-000001', ANNA)), 'sw0001a');
  });

  await t.test('the shared mapping is only filled, never replaced', async () => {
    const { rememberBlNumber, rememberBlNumbers } = _req('src/catalog/blMapping.js');
    await rememberBlNumber('fig', 'fig-000001', 'falsch');
    await rememberBlNumbers('fig', [{ rbId: 'fig-000001', blId: 'auch-falsch' }]);
    await rememberBlNumber('part', '3003', '3003b');
    await rememberBlNumber('part', '3004', '3004');
    assert.deepEqual(
      await gemeinsam(),
      ['fig|fig-000001|sw0001', 'part|3003|3003b', 'part|3004|null'],
      'ein vorhandener Wert bleibt, ein leerer wird gefüllt, ein neuer angelegt',
    );
  });
});
