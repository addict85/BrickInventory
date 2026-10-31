/**
 * Geld wird erst am Ende gerundet, Kaufpreise in fremder Währung werden
 * gezählt statt still weggelassen, die Vorgabewährung kommt aus dem Konto,
 * und die Galeriekachel bekommt Betrag und G&V fertig vom Server.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in bewertung.ts total_avg wieder aus dem gerundeten Stückpreis
 *      ((unitAvg * qty).toFixed(2)) → rot: „120,3333 × 3 ist 361,00“ (360.99)
 *   B  kaufpreise_fremde_waehrung in computeSetsValuation fest auf 0 → rot:
 *      „ein Kaufpreis in EUR wird gezählt“
 *   C  erfassung_waehrung() in der Datenbank auf den alten Rumpf (Konto, sonst
 *      EUR) zurückgesetzt → rot: „ohne Kontowährung gilt die der Installation“
 *   D  kachelWerte() in gewinnVerlust.ts nicht angehängt → rot: „die Kachel
 *      kommt fertig vom Server“
 *   E  (30.10.) in computePartsValuation hasCost wieder `acqs.length > 0` →
 *      rot: „nur ein Kaufpreis in EUR: keine G&V“ (Teil: kauf 0, pnl 21000 statt null)
 *   F  (30.10.) dasselbe in computeMinifigsValuation → rot: „nur ein
 *      Kaufpreis in EUR: keine G&V“ (Figur: kauf 0, pnl 40000 statt null)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Rappen erst am Ende, Währungen ehrlich', { concurrency: 1 }, async (t) => {
  const geld = _req('src/infra/geld.js');
  await t.test('120,3333 × 2 ist 240,67, und 1,005 rundet auf 1,01', () => {
    assert.equal(geld.zeilenwert(120.3333, 2), 240.67);
    assert.equal(geld.zeilenwert('120.3333', 2), 240.67);
    assert.equal(geld.alsText(1.005), '1.01');
    assert.equal(geld.aufRappen(-12345), -1.23);
    assert.equal(geld.summeAus([{ preis: 0.07, menge: 1000 }, { preis: null, menge: 5 }]), 70);
    const { valueSet } = _req('src/finanzen/setValue.js');
    const v = valueSet('X-1', [{ quantity: 2, condition: 'N' }], new Map([['X-1|N', 120.3333]]));
    assert.equal(v.total, 240.67);
    assert.equal(v.unit_price, 120.33);
  });

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `geld-${process.pid}`, SN = `GW${process.pid}-1`;
  const TEIL_EUR = `gwe${process.pid}`, TEIL_CHF = `gwc${process.pid}`, FIG = `gwf${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NAME + '-2']]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const ohne = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME + '-2'])).id;
  const globalVorher = await db.get(`SELECT value FROM global_settings WHERE key='currency'`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, ohne]]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [[TEIL_EUR, TEIL_CHF]]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number=$1', [FIG]);
    if (globalVorher) await db.run(`UPDATE global_settings SET value=$1 WHERE key='currency'`, [globalVorher.value]);
    else await db.run(`DELETE FROM global_settings WHERE key='currency'`);
    await db.pool.end().catch(() => {});
  });

  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,$2,2,100,'N','CHF','2026-01-05T12:00:00Z'), ($1,$2,1,50,'N','EUR','2026-01-06T12:00:00Z')`, [uid, SN]);
  await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
  await db.run(`INSERT INTO price_cache (set_number, currency_code, condition, avg_price, fetched_at)
                VALUES ($1,'CHF','N',120.3333,NOW())`, [SN]);

  await t.test('120,3333 × 3 ist 361,00, und ein Kaufpreis in EUR wird gezählt', async () => {
    const { computeSetsValuation } = _req('src/finanzen/financeCalc.js');
    const r = await computeSetsValuation(uid, [uid]);
    const set = r.sets.find(s => s.set_number === SN);
    assert.equal(set.total_avg, '361.00', '120,3333 × 3 ist 361,00');
    assert.equal(set.wert_gesamt, 361);
    assert.equal(r.totals.avg, '361.00');
    assert.equal(r.kaufpreise_fremde_waehrung, 1, 'ein Kaufpreis in EUR wird gezählt');
    assert.equal(set.purchase_price, 100, 'der EUR-Kaufpreis geht nicht in den Schnitt');
    assert.equal(set.pnl_prozent, 20.3);
    assert.equal(set.pnl_pct, '20.3');
    assert.equal(r.ttl_stunden, Number(r.ttl_hours));
  });

  await t.test('die Kachel kommt fertig vom Server', async () => {
    const { computePnl } = _req('src/finanzen/financeCalc.js');
    const r = await computePnl(uid, [uid]);
    const zeile = r.sets.find(s => s.set_number === SN);
    assert.equal(zeile.kachel_preis, 120.33);
    assert.equal(zeile.kachel_pnl_pct, 20.3);
    assert.equal(typeof zeile.pnl_prozent, 'number');
    assert.equal(r.totals.kaufpreise_fremde_waehrung, 1);
  });

  await t.test('nur ein Kaufpreis in EUR: keine G&V statt Tausender-Prozent', async () => {
    const { haeltTeil, haeltFigur } = require('./helpers/bestand');
    await haeltTeil(db, uid, TEIL_EUR, { colorId: 5, preis: 1 });
    await haeltTeil(db, uid, TEIL_CHF, { colorId: 5, preis: 0.1 });
    await haeltFigur(db, uid, FIG, { preis: 3 });
    await db.run(`UPDATE part_acquisitions SET currency='EUR' WHERE user_id=$1 AND part_number=$2`, [uid, TEIL_EUR]);
    await db.run(`UPDATE minifig_acquisitions SET currency='EUR' WHERE user_id=$1 AND fig_number=$2`, [uid, FIG]);
    for (const nr of [TEIL_EUR, TEIL_CHF])
      await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                    VALUES ($1,5,'N','CHF',2.1,2.1)`, [nr]);
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,'N','CHF',4)`, [FIG]);
    const { computePartsValuation, computeMinifigsValuation } = _req('src/finanzen/financeCalc.js');
    const teile = await computePartsValuation(uid, [uid]);
    const figuren = await computeMinifigsValuation(uid, [uid]);
    const sicht = (z) => z && { markt: z.avg_price, kauf: z.purchase_price, pnl: z.pnl_prozent };
    assert.deepEqual({
      eur: sicht(teile.parts.find(z => z.part_number === TEIL_EUR)),
      chf: sicht(teile.parts.find(z => z.part_number === TEIL_CHF)),
      figur: sicht(figuren.figs.find(z => z.fig_number === FIG)),
      fremd: [teile.kaufpreise_fremde_waehrung, figuren.kaufpreise_fremde_waehrung],
    }, {
      eur: { markt: 2.1, kauf: null, pnl: null },
      chf: { markt: 2.1, kauf: 0.1, pnl: 2000 },
      figur: { markt: 4, kauf: null, pnl: null },
      fremd: [1, 1],
    });
  });

  await t.test('mehrere Zeilen eines Sets: mengengewichtet, sonst der Kaufpreis', () => {
    const { kachelWerte } = _req('src/finanzen/setValue.js');
    const w = kachelWerte([
      { set_number: 'A', quantity: 1, current_price: 750, purchase_price: 100, baseline_price: 100, pnl_pct: '650.0', baseline_pnl_pct: '650.0' },
      { set_number: 'A', quantity: 1, current_price: 750, purchase_price: 600, baseline_price: 600, pnl_pct: '25.0', baseline_pnl_pct: '25.0' },
      { set_number: 'B', quantity: 2, current_price: 0, purchase_price: 40, baseline_price: 40, pnl_pct: null, baseline_pnl_pct: null },
    ]);
    assert.deepEqual(w.get('A'), { kachel_preis: 750, kachel_pnl_pct: 114.3 });
    assert.deepEqual(w.get('B'), { kachel_preis: 40, kachel_pnl_pct: null });
  });

  await t.test('ohne Kontowährung gilt die der Installation — für Erfassungen und Gutscheine', async () => {
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('currency','GBP')
                  ON CONFLICT (key) DO UPDATE SET value='GBP'`);
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [ohne, SN]);
    await db.run('INSERT INTO set_acquisitions (user_id, set_number, quantity) VALUES ($1,$2,1)', [ohne, SN]);
    assert.equal((await db.get('SELECT currency FROM set_acquisitions WHERE user_id=$1', [ohne])).currency, 'GBP');
    await db.run(`INSERT INTO vouchers (user_id, number, amount) VALUES ($1,'1234567',10), ($2,'7654321',10)`, [ohne, uid]);
    const g = await db.all('SELECT user_id, currency FROM vouchers WHERE user_id = ANY($1) ORDER BY number', [[uid, ohne]]);
    assert.deepEqual(g.map(z => z.currency), ['GBP', 'CHF']);
  });
});
