/**
 * Die Bewertung liest den Preiscache in einer Abfrage statt je Position, und
 * die Setmenge summiert nur die Erfassungen der gefragten Konten.
 *
 * Gezählt wird am Pool wie in bewertung-abfragen-db.test.js; für die Setmenge
 * zählen die Zeilen, die der Scan auf set_acquisitions laut EXPLAIN liefert.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in computePartsValuation den Vorrat nicht weitergereicht → rot:
 *      „zwölf Teile, eine Abfrage auf den Teile-Cache“
 *   B  dasselbe in computeMinifigsValuation → rot: „sechs Figuren, …“
 *   C  in mengeJoin den Kontofilter ignoriert → rot: „die Setmenge liest nur
 *      die Erfassungen der gefragten Konten“
 *   D  inKontowaehrung liefert immer TRUE → rot: „der Durchschnittskaufpreis
 *      der Galerie zählt nur die Kontowährung“ (200 statt 100)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltTeil, haeltFigur, haeltSet } = require('./helpers/bestand');

const gesehen = [];
let zaehlen = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (zaehlen) gesehen.push(String(typeof text === 'string' ? text : (text && text.text) || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
/** Die Abfragen während fn, gefiltert auf ein Muster. */
async function abfragen(muster, fn) {
  gesehen.length = 0; zaehlen = true;
  try { return { ergebnis: await fn(), treffer: () => gesehen.filter(q => muster.test(q)).length }; }
  finally { zaehlen = false; }
}

test('Bewertung und Setmenge ohne Zeile-für-Zeile-Abfragen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const ID = process.pid;
  const NAME = `bewertung-${ID}`, FREMD = `bewertung-fremd-${ID}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FREMD]]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const fremd = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [FREMD])).id;
  const teile = Array.from({ length: 12 }, (_, i) => `bw${ID}t${i}`);
  const figuren = Array.from({ length: 6 }, (_, i) => `bw${ID}f${i}`);
  t.after(async () => {
    db.pool.query = altQuery;
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremd]]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [teile]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [figuren.map(f => f + 'bl')]);
    await db.run(`DELETE FROM bl_zuordnung WHERE art = 'fig' AND rb_id = ANY($1)`, [figuren]);
    await db.pool.end().catch(() => {});
  });

  for (const nr of teile) {
    await haeltTeil(db, uid, nr, { menge: 2, preis: 1 });
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, 0, 'N', 'EUR', 1.5, 1.4)`, [nr]);
  }
  for (const nr of figuren) {
    await haeltFigur(db, uid, nr, { menge: 1, preis: 3 });
    await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ('fig', $1, $2)`, [nr, nr + 'bl']);
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, 'N', 'EUR', 4, 4)`, [nr + 'bl']);
  }
  const { computePartsValuation, computeMinifigsValuation } = _req('utils/financeCalc.js');

  await t.test('zwölf Teile, eine Abfrage auf den Teile-Cache', async () => {
    const m = await abfragen(/FROM part_price_cache/, () => computePartsValuation(uid, [uid]));
    assert.equal(m.ergebnis.parts.length, 12);
    assert.ok(m.ergebnis.parts.every(p => Number(p.avg_price) === 1.5), 'nicht jedes Teil kam aus dem Cache');
    assert.equal(m.treffer(), 1, `${m.treffer()} Abfragen auf part_price_cache`);
  });

  await t.test('sechs Figuren, eine Abfrage auf den Figuren-Cache', async () => {
    const m = await abfragen(/FROM minifig_price_cache/, () => computeMinifigsValuation(uid, [uid]));
    assert.equal(m.ergebnis.figs.length, 6);
    assert.ok(m.ergebnis.figs.every(f => Number(f.avg_price) === 4), 'nicht jede Figur kam aus dem Cache');
    assert.equal(m.treffer(), 1, `${m.treffer()} Abfragen auf minifig_price_cache`);
  });

  await t.test('die Setmenge liest nur die Erfassungen der gefragten Konten', async () => {
    await haeltSet(db, uid, `bw${ID}-1`, 2);
    for (let i = 0; i < 40; i++) await haeltSet(db, fremd, `bw${ID}x${i}-1`, 1);
    const { mengeJoin, mengeAus } = _req('utils/bestandsmenge.js');
    const plan = await db.get(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT s.set_number, ${mengeAus('sm', 0)} AS menge
         FROM sets s ${mengeJoin('s', 'sm', '= ANY($1)')}
        WHERE s.user_id = ANY($1)`, [[uid]]);
    /** Alle Knoten, die set_acquisitions lesen, und ihre gelieferten Zeilen. */
    const zeilen = [];
    (function lauf(k) {
      if (k['Relation Name'] === 'set_acquisitions') zeilen.push(k['Actual Rows']);
      for (const u of k.Plans || []) lauf(u);
    })(plan['QUERY PLAN'][0].Plan);
    assert.ok(zeilen.length > 0, 'kein Scan auf set_acquisitions im Plan');
    assert.ok(zeilen.every(n => n <= 1), `gelesene Erfassungen: ${zeilen.join(', ')}`);
  });

  await t.test('der Durchschnittskaufpreis der Galerie zählt nur die Kontowährung', async () => {
    const SN = `bw${ID}w-1`;
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'CHF'`, [uid]);
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
    for (const [preis, waehrung] of [[100, 'CHF'], [300, 'EUR']])
      await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                    VALUES ($1, $2, 1, $3, 'N', $4)`, [uid, SN, preis, waehrung]);
    const { getSets } = _req('utils/handlers/sets.js');
    const r = await getSets([uid], {});
    const zeile = (r.sets || r).find(z => z.set_number === SN);
    assert.ok(zeile, 'das Set fehlt in der Liste');
    assert.equal(Number(zeile.avg_purchase_price), 100);
  });
});
