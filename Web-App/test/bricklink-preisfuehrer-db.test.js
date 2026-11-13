/**
 * Der BrickLink-Preisführer, wie ihn Sets, Teile und Figuren abfragen: an
 * einer Attrappe von bricklinkRequest (clients/bricklink.js im
 * require-Zwischenspeicher ersetzt, bevor jemand sie lädt) und der Test-DB.
 * Erst Verkäufe der letzten sechs Monate, ohne Preis dort die Angebote.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  getPriceGuide mit Vorgabe `condition = 'U'` → rot: „ohne Angabe der
 *      Neupreis aus den Verkäufen“
 *   B  getPriceGuide ohne den Rückfall (`return { ...first, guide_used }`
 *      sofort) → rot: „ohne Verkauf … die Angebote“ (Set)
 *   C  in fetchPartPrice bzw. fetchMinifigPrice den Abruf mit guide_type
 *      'stock' gestrichen → rot: „ohne Verkauf … die Angebote“ (Teil bzw. Figur)
 *   D  getPriceGuideRaw fragt mit guide_type 'stock' zuerst → rot: „ohne
 *      Angabe …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

const blPfad = require.resolve(path.join(__dirname, '..', 'dist', 'clients', 'bricklink.js'));
const echt = require(blPfad);
const abrufe = [];
/** Preis je guide_type; fehlt einer, liefert BrickLink 0. */
let preise = {};
require.cache[blPfad].exports = {
  ...echt,
  bricklinkRequest: async (_methode, pfad, params) => {
    abrufe.push({ pfad, ...params });
    const p = String(preise[params.guide_type] ?? 0);
    return { avg_price: p, qty_avg_price: p, min_price: p, max_price: p, total_quantity: p === '0' ? '0' : '3' };
  },
};
const { getPriceGuide } = _req('src/katalog/bricklinkPreise.js');
const { fetchPartPrice, fetchMinifigPrice } = _req('src/finanzen/rechnung/preise.js');

const N = `${process.pid}`;
const SET = `91${N}-1`,
  TEIL = `pf${N}`,
  FIGUR = `pf-fig-${N}`;

test('BrickLink-Preisführer', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(async () => {
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_price_history WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGUR]).catch(() => {});
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = $1', [FIGUR]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('ohne Angabe der Neupreis aus den Verkäufen', async () => {
    abrufe.length = 0;
    preise = { sold: 120 };
    const g = await getPriceGuide(SET);
    assert.deepEqual(
      abrufe.map(a => [a.new_or_used, a.guide_type]),
      [['N', 'sold']],
    );
    assert.deepEqual([g.avg_price, g.guide_used], ['120', 'sold']);
  });

  await t.test('ohne Verkauf in sechs Monaten die Angebote — für Sets, Teile und Figuren', async () => {
    preise = { sold: 0, stock: 80 };
    abrufe.length = 0;
    const g = await getPriceGuide(SET, 'U');
    assert.deepEqual(
      abrufe.map(a => [a.new_or_used, a.guide_type]),
      [
        ['U', 'sold'],
        ['U', 'stock'],
      ],
    );
    assert.deepEqual([g.avg_price, g.guide_used, g.guide_fallback], ['80', 'stock', true]);

    abrufe.length = 0;
    const teil = await fetchPartPrice(TEIL, 4, 'N', 'EUR', 24);
    assert.equal(teil.avg_price, 80, JSON.stringify(teil));
    assert.deepEqual(
      abrufe.slice(0, 2).map(a => a.guide_type),
      ['sold', 'stock'],
    );
    assert.match(abrufe[0].pfad, new RegExp(`/items/part/${TEIL}/price`));

    abrufe.length = 0;
    const figur = await fetchMinifigPrice(FIGUR, 'N', 'EUR', 24);
    assert.equal(figur.avg_price, 80, JSON.stringify(figur));
    assert.deepEqual(
      abrufe.slice(0, 2).map(a => a.guide_type),
      ['sold', 'stock'],
    );
  });
});
