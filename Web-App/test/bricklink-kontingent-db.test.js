/**
 * Jeder HTTP-Aufruf an BrickLink zählt im Tageskontingent — auch die
 * Rückfälle (sold → stock), die bisher kostenlos mitliefen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  die Zählung in bricklinkRequest() entfernt → rot: beide Fälle
 *   B  in fetchPrice wieder checkAndIncrementRateLimit statt kontingentFrei
 *      → rot: beide Fälle (der Vorabcheck zählt mit)
 *   C  in bricklinkRequest den Abbruch bei erschöpftem Kontingent entfernt
 *      → rot: „ein erschöpftes Kontingent hält auch den Rückfall an“
 *
 * BrickLink selbst wird nicht gefragt: https.get ist durch eine Attrappe
 * ersetzt, die für „sold“ nichts und für „stock“ einen Preis liefert.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

/** @type {string[]} */
const aufrufe = [];
// @ts-ignore — Attrappe mit genau dem, was clients/bricklink.ts benutzt.
https.get = (opts, cb) => {
  aufrufe.push(opts.path);
  const req = new EventEmitter();
  const art = new URL('https://x' + opts.path).searchParams.get('guide_type');
  const data = art === 'stock'
    ? { avg_price: '12.50', qty_avg_price: '12.00', min_price: '10', max_price: '15', total_quantity: '3' }
    : { avg_price: '0', qty_avg_price: '0', min_price: '0', max_price: '0', total_quantity: '0' };
  setImmediate(() => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    cb(res);
    res.emit('data', JSON.stringify({ meta: { code: 200 }, data }));
    res.emit('end');
  });
  return req;
};

const zaehler = async () => Number((await db.get(
  `SELECT anzahl FROM api_aufrufe WHERE tag = $1 AND api = 'bricklink' AND konto = 0`,
  [new Date().toISOString().slice(0, 10)]))?.anzahl || 0);

test('BrickLink-Kontingent je HTTP-Aufruf', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const SN = `91${process.pid % 10000}-1`;
  const heute = new Date().toISOString().slice(0, 10);
  const vorher = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`);
  const setze = async (k, v) => db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [k, v]);
  const neuerTag = async () => {
    await db.run(`DELETE FROM api_aufrufe WHERE tag = $1 AND api = 'bricklink'`, [heute]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    aufrufe.length = 0;
  };
  const zugang = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const alterZugang = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [zugang]);
  for (const k of zugang) await setze(k, 'test');
  const { fetchPrice } = _req('utils/financeCalc.js');
  t.after(async () => {
    await setze('api_limit_bricklink', vorher?.value ?? '4000');
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [zugang]);
    for (const z of alterZugang) await setze(z.key, z.value);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SN]);
    await db.pool.end().catch(() => {});
  });

  await t.test('sold und stock zählen je einmal', async () => {
    await setze('api_limit_bricklink', '100');
    await neuerTag();
    const p = await fetchPrice(SN, 'N', 'sold', 'EUR', 24);
    assert.equal(parseFloat(p.avg_price), 12.5, 'der Rückfall auf Angebote hat keinen Preis geliefert');
    assert.equal(aufrufe.length, 2, `erwartet zwei Abrufe, gesehen: ${aufrufe.join(' | ')}`);
    assert.equal(await zaehler(), 2, 'das Kontingent zählt nicht jeden Abruf');
  });

  await t.test('ein erschöpftes Kontingent hält auch den Rückfall an', async () => {
    await setze('api_limit_bricklink', '1');
    await neuerTag();
    await fetchPrice(SN, 'N', 'sold', 'EUR', 24).catch(() => null);
    assert.equal(aufrufe.length, 1, `über das Limit hinaus abgerufen: ${aufrufe.join(' | ')}`);
    assert.equal(await zaehler(), 1);
  });
});
