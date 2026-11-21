/**
 * Purchase prices in a foreign currency are converted at the rate of their purchase day
 * (migration 0077, src/finances/calculation/queries.ts); if the day is missing, the
 * next earlier rate applies, if every rate is missing, the price stays “foreign currency,
 * not included”. The rates come from the ECB — here from a local
 * server with the same file format (ZIP with CSV, daily XML).
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in kaufpreisIn() again `CASE WHEN currency = w THEN spalte END`
 *      instead of in_waehrung(…) → red: “set” (purchase_price null instead of 65.25),
 *      “price history”, “part”
 *   B  in kurs_je_eur() `k.tag <= t` replaced by `k.tag = t` (no
 *      fallback to the previous day) → red: “set” (purchase_price 38 instead of 65.25),
 *      “price history” (null instead of 92.5)
 *   C  ecbFetch without checking the scheme → red: “only HTTPS to the ECB host”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet, record, holdsPart, catalogSet } = require('./helpers/inventory');
const { ZipArchive } = require(path.join(__dirname, '..', 'node_modules', 'archiver'));
const { portOf } = require('./helpers/server');

const NAME = `kurse_${process.pid}`;
const SET = `7${process.pid}1-1`,
  TEIL = `wk${process.pid}`,
  FARBE = 4;

/** A ZIP file with a CSV, as the ECB delivers it. */
function zipWith(name, inhalt) {
  return new Promise((ok, fehler) => {
    const a = new ZipArchive(),
      teile = [];
    a.on('data', d => teile.push(d))
      .on('end', () => ok(Buffer.concat(teile)))
      .on('error', fehler);
    a.append(inhalt, { name });
    a.finalize();
  });
}

const HISTORY = ['Date,USD,JPY,CHF,', '2026-01-06,1.2500,N/A,0.9500,', '2026-01-02,1.2000,160.5,0.9250,'].join('\n');
const TAG = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-01-07'>
  <Cube currency='USD' rate='1.2600'/><Cube currency='CHF' rate='0.9600'/>
</Cube></Cube></gesmes:Envelope>`;

test('exchange rates: fetch, conversion, fallback', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const abgerufen = [];
  const srv = http
    .createServer((q, a) => {
      abgerufen.push(q.url);
      if (q.url.endsWith('/eurofxref-hist.zip')) return a.end(zip);
      if (q.url.endsWith('/eurofxref-daily.xml')) return a.end(TAG);
      a.statusCode = 404;
      a.end();
    })
    .listen(0);
  t.after(() => srv.close());
  const zip = await zipWith('eurofxref-hist.csv', HISTORY);
  const lokal = url =>
    fetch(`http://127.0.0.1:${portOf(srv)}${new URL(url).pathname}`).then(async r =>
      Buffer.from(await r.arrayBuffer()),
    );

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM exchange_rates');
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]);
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM exchange_rates');
  const { reloadRates } = _req('src/finances/exchangeRates.js');

  await t.test('first the history, then the daily rates', async () => {
    assert.deepEqual(await reloadRates(lokal), { quelle: 'historie', rates: 5 }, 'N/A und leere Spalten zählen nicht');
    assert.deepEqual(await reloadRates(lokal), { quelle: 'tag', rates: 2 });
    assert.deepEqual(abgerufen, ['/stats/eurofxref/eurofxref-hist.zip', '/stats/eurofxref/eurofxref-daily.xml']);
    const r = await db.get(`SELECT per_eur FROM exchange_rates WHERE currency = 'CHF' AND day = '2026-01-07'`);
    assert.equal(r.per_eur, 0.96);
  });

  await t.test("only HTTPS to the ECB's host", async () => {
    const { ecbFetch } = _req('clients/ecb.js');
    await assert.rejects(ecbFetch('http://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'), /nur von https/);
    await assert.rejects(ecbFetch('https://ecb.example.org/stats/eurofxref/eurofxref-daily.xml'), /nur von https/);
  });

  // Display currency CHF; bought in EUR, USD and JPY.
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  await catalogSet(db, SET, { name: SET });
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
                VALUES ($1, 'N', 'CHF', 120, NOW()) ON CONFLICT DO NOTHING`,
    [SET],
  );
  const kauf = async (menge, preis, waehrung, am) => {
    await record(db, uid, SET, menge, { preis, am });
    await db.run(
      `UPDATE set_acquisitions SET currency = $1 WHERE id = (SELECT max(id) FROM set_acquisitions WHERE user_id = $2)`,
      [waehrung, uid],
    );
  };
  await holdsSet(db, uid, SET, 0);
  // Sunday 4.1.: no rate, Friday (2.1.) applies: 100 / 1 × 0.925 = 92.5.
  await kauf(1, 100, 'EUR', '2026-01-04T10:00:00Z');
  // 6.1.: 50 USD / 1,25 × 0,95 = 38.
  await kauf(1, 50, 'USD', '2026-01-06T10:00:00Z');
  // The ECB does not carry XAU: without a rate the price stays out.
  await kauf(1, 900, 'XAU', '2026-01-06T11:00:00Z');

  await t.test('Set', async () => {
    const { gainAndLoss } = _req('src/finances/financeCalc.js');
    const pnl = await gainAndLoss(uid, [uid]);
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.purchase_price, (92.5 + 38) / 2, 'mengengewichtet über die umgerechneten Preise');
    assert.equal(pnl.totals.kaufpreise_umgerechnet, 2);
    assert.equal(pnl.totals.kaufpreise_fremde_waehrung, 1, 'XAU ohne Kurs bleibt draussen');
    const { valueSets } = _req('src/finances/financeCalc.js');
    const b = await valueSets(uid, [uid]);
    assert.equal(b.kaufpreise_umgerechnet, 2);
    assert.equal(b.kaufpreise_fremde_waehrung, 1);
  });

  await t.test('price history', async () => {
    const { priceHistorySet } = _req('src/finances/priceHistory.js');
    const v = await priceHistorySet([uid], SET, 'CHF');
    assert.equal(v.purchase_price, 92.5, 'die erste Erfassung, umgerechnet');
    assert.equal(v.by_condition.N.purchase_price, (92.5 + 38) / 2);
  });

  await t.test('Teil', async () => {
    await holdsPart(db, uid, TEIL, { colorId: FARBE, menge: 10, preis: 2, am: '2026-01-07T09:00:00Z' });
    await db.run(`UPDATE part_acquisitions SET currency = 'USD' WHERE user_id = $1`, [uid]);
    const { priceHistoryPart } = _req('src/finances/priceHistory.js');
    const v = await priceHistoryPart([uid], TEIL, FARBE, 'CHF');
    // 2 USD / 1,26 × 0,96 = 1,5238
    assert.equal(v.by_condition.N.purchase_price, 1.5238);
  });
});
