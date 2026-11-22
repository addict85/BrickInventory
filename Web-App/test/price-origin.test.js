/**
 * The purchase price is adopted — and its origin named: if BrickLink carries
 * no price for the chosen condition, the one of the other condition applies, and
 * the response says so (price_from_condition). Server against the test DB (the
 * price cache knows „new without price“ and „used with price“, so no
 * fetch), web app in the real bundle (jsdom).
 *
 * Counter-checks (measured 10.11.2026, each on its own, dist or bundle rebuilt):
 *   A  in preise.ts fetchPartPrice on the cache fallback without `is_fallback: true`
 *      → red: “part and minifigure without a price …” (part)
 *   B  the same in fetchMinifigPrice → red: same place (figure)
 *   C  in preisRegel.ts the market asked even for a typed-in number → red:
 *      “a typed-in number …” (origin 'U' on an own price)
 *   D  the hint left out in teil-erfassen.js → red: “the web app names …”
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { openUi, ANMELDUNG, warte } = require('./helpers/ui');

const U = 990811,
  PART = `ph-teil-${process.pid}`,
  FIG = `ph-fig-${process.pid}`,
  FARBE = 4;

test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);

async function setup(t) {
  const db = await dataOrSkip(t, _req);
  if (!db) return null;
  const weg = async () => {
    for (const tab of ['part_acquisitions', 'minifig_acquisitions', 'parts', 'minifigs'])
      await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    await db.run('DELETE FROM part_price_cache WHERE part_number=$1', [PART]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number=$1', [FIG]);
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
  };
  await weg();
  t.after(weg);
  await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,$2,'x')", [U, `ph${process.pid}`]);
  await db.run(
    "INSERT INTO rb_colors (id,name,bl_color_id) VALUES ($1,'Rot',$1) ON CONFLICT (id) DO UPDATE SET bl_color_id=$1",
    [FARBE],
  );
  for (const { condition, preis } of [
    { condition: 'N', preis: 0 },
    { condition: 'U', preis: 0.9 },
  ]) {
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
      VALUES ($1,$2,$3,'EUR',$4,$4,NOW())`,
      [PART, FARBE, condition, preis],
    );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price,fetched_at)
      VALUES ($1,$2,'EUR',$3,$3,NOW())`,
      [FIG, condition, preis * 10],
    );
  }
  return db;
}

test('part and minifigure without a price in the selected condition take the other and say so', async t => {
  if (!(await setup(t))) return;
  const { addManualPart } = _req('src/parts/manualParts.js');
  const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  const teil = await addManualPart(U, { part_number: PART, color_id: FARBE, condition: 'N' });
  const fig = await addManualMinifig(U, { fig_number: FIG, condition: 'N' });
  assert.deepEqual([teil.price_from_condition, fig.price_from_condition], ['U', 'U']);
  const { manualPartPurchase } = _req('src/parts/manualParts.js');
  const r = await manualPartPurchase(U, { partNumber: PART, colorId: FARBE, condition: 'N' });
  assert.deepEqual([r.effectivePurchasePrice, r.priceFromState], [0.9, 'U'], 'der übernommene Preis fehlt');
  const gleich = await manualPartPurchase(U, { partNumber: PART, colorId: FARBE, condition: 'U' });
  assert.deepEqual([gleich.effectivePurchasePrice, gleich.priceFromState], [0.9, null], 'ohne Rückfall keine Herkunft');
});

test('a typed-in number has no origin', async t => {
  if (!(await setup(t))) return;
  const { manualPartPurchase } = _req('src/parts/manualParts.js');
  const r = await manualPartPurchase(U, { partNumber: PART, colorId: FARBE, unitPrice: '2.50', condition: 'N' });
  assert.deepEqual([r.effectivePurchasePrice, r.priceFromState, r.estimated], [2.5, null, false]);
});

test('the web app names the origin for part and minifigure', async () => {
  const de = require('./helpers/sources').loadTranslations().de;
  const items = kind => (_url, o) =>
    o.method === 'POST'
      ? { success: true, action: 'added', [`${kind}_number`]: `${kind}-1`, price_from_condition: 'U' }
      : ANMELDUNG[`/v2/${kind === 'part' ? 'parts' : 'minifigs'}`];
  const o = await openUi({ '/v2/parts': items('part'), '/v2/minifigs': items('fig') });
  try {
    await o.ruhig();
    for (const [kind, nr, knopf, ergebnis] of [
      ['part', 'ap-num-inline', 'btn-add-part', 'ap-inline-result'],
      ['fig', 'af-num-inline', 'btn-add-fig', 'af-inline-result'],
    ]) {
      o.d.getElementById(nr).value = `${kind}-1`;
      o.d.getElementById(knopf).click();
      await warte(() => o.d.getElementById(ergebnis).textContent.startsWith(`${kind}-1`));
      assert.ok(
        o.d.getElementById(ergebnis).textContent.includes(de['price.from_other_condition_used']),
        `${kind}: ${o.d.getElementById(ergebnis).textContent}`,
      );
    }
  } finally {
    o.w.close();
  }
});
