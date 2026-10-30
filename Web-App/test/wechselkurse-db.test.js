/**
 * Kaufpreise in fremder Währung werden zum Kurs ihres Kauftags umgerechnet
 * (Migration 0077, utils/finance/abfragen.ts); fehlt der Tag, gilt der
 * nächstfrühere Kurs, fehlt jeder Kurs, bleibt der Preis „fremde Währung,
 * nicht eingerechnet“. Die Kurse kommen von der EZB — hier von einem lokalen
 * Server mit derselben Dateiform (ZIP mit CSV, Tages-XML).
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in kaufpreisIn() wieder `CASE WHEN currency = w THEN spalte END`
 *      statt in_waehrung(…) → rot: „Set“ (purchase_price null statt 65.25),
 *      „Preisverlauf“, „Teil“
 *   B  in kurs_je_eur() `k.tag <= t` durch `k.tag = t` ersetzt (kein
 *      Rückfall auf den Vortag) → rot: „Set“ (purchase_price 38 statt 65.25),
 *      „Preisverlauf“ (null statt 92.5)
 *   C  ezbAbruf ohne Prüfung des Schemas → rot: „nur HTTPS auf den Host der EZB“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, erfasse, haeltTeil } = require('./helpers/bestand');
const { ZipArchive } = require(path.join(__dirname, '..', 'node_modules', 'archiver'));

const NAME = `kurse_${process.pid}`;
const SET = `7${process.pid}1-1`, TEIL = `wk${process.pid}`, FARBE = 4;

/** Eine ZIP-Datei mit einer CSV, wie die EZB sie ausliefert. */
function zipMit(name, inhalt) {
  return new Promise((ok, fehler) => {
    const a = new ZipArchive(), teile = [];
    a.on('data', d => teile.push(d)).on('end', () => ok(Buffer.concat(teile))).on('error', fehler);
    a.append(inhalt, { name });
    a.finalize();
  });
}

const HISTORIE = [
  'Date,USD,JPY,CHF,',
  '2026-01-06,1.2500,N/A,0.9500,',
  '2026-01-02,1.2000,160.5,0.9250,',
].join('\n');
const TAG = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-01-07'>
  <Cube currency='USD' rate='1.2600'/><Cube currency='CHF' rate='0.9600'/>
</Cube></Cube></gesmes:Envelope>`;

test('Wechselkurse: Abruf, Umrechnung, Rückfall', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const abgerufen = [];
  const srv = http.createServer((q, a) => {
    abgerufen.push(q.url);
    if (q.url.endsWith('/eurofxref-hist.zip')) return a.end(zip);
    if (q.url.endsWith('/eurofxref-daily.xml')) return a.end(TAG);
    a.statusCode = 404; a.end();
  }).listen(0);
  t.after(() => srv.close());
  const zip = await zipMit('eurofxref-hist.csv', HISTORIE);
  const lokal = (url) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`)
    .then(async r => Buffer.from(await r.arrayBuffer()));

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM wechselkurse');
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]);
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM wechselkurse');
  const { kurseNachladen } = _req('utils/wechselkurse.js');

  await t.test('erst die Historie, dann die Tageskurse', async () => {
    assert.deepEqual(await kurseNachladen(lokal), { quelle: 'historie', kurse: 5 }, 'N/A und leere Spalten zählen nicht');
    assert.deepEqual(await kurseNachladen(lokal), { quelle: 'tag', kurse: 2 });
    assert.deepEqual(abgerufen, ['/stats/eurofxref/eurofxref-hist.zip', '/stats/eurofxref/eurofxref-daily.xml']);
    const r = await db.get(`SELECT je_eur FROM wechselkurse WHERE waehrung = 'CHF' AND tag = '2026-01-07'`);
    assert.equal(r.je_eur, 0.96);
  });

  await t.test('nur HTTPS auf den Host der EZB', async () => {
    const { ezbAbruf } = _req('clients/ezb.js');
    await assert.rejects(ezbAbruf('http://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'), /nur von https/);
    await assert.rejects(ezbAbruf('https://ecb.example.org/stats/eurofxref/eurofxref-daily.xml'), /nur von https/);
  });

  // Anzeigewährung CHF; gekauft in EUR, USD und JPY.
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [SET]);
  await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
                VALUES ($1, 'N', 'CHF', 120, NOW()) ON CONFLICT DO NOTHING`, [SET]);
  const kauf = async (menge, preis, waehrung, am) => {
    await erfasse(db, uid, SET, menge, { preis, am });
    await db.run(`UPDATE set_acquisitions SET currency = $1 WHERE id = (SELECT max(id) FROM set_acquisitions WHERE user_id = $2)`, [waehrung, uid]);
  };
  await haeltSet(db, uid, SET, 0);
  // Sonntag 4.1.: kein Kurs, es gilt der Freitag (2.1.): 100 / 1 × 0,925 = 92,5.
  await kauf(1, 100, 'EUR', '2026-01-04T10:00:00Z');
  // 6.1.: 50 USD / 1,25 × 0,95 = 38.
  await kauf(1, 50, 'USD', '2026-01-06T10:00:00Z');
  // XAU führt die EZB nicht: ohne Kurs bleibt der Preis draussen.
  await kauf(1, 900, 'XAU', '2026-01-06T11:00:00Z');

  await t.test('Set', async () => {
    const { computePnl } = _req('utils/financeCalc.js');
    const pnl = await computePnl(uid, [uid]);
    const z = pnl.sets.find(s => s.set_number === SET);
    assert.equal(z.purchase_price, (92.5 + 38) / 2, 'mengengewichtet über die umgerechneten Preise');
    assert.equal(pnl.totals.kaufpreise_umgerechnet, 2);
    assert.equal(pnl.totals.kaufpreise_fremde_waehrung, 1, 'XAU ohne Kurs bleibt draussen');
    const { computeSetsValuation } = _req('utils/financeCalc.js');
    const b = await computeSetsValuation(uid, [uid]);
    assert.equal(b.kaufpreise_umgerechnet, 2);
    assert.equal(b.kaufpreise_fremde_waehrung, 1);
  });

  await t.test('Preisverlauf', async () => {
    const { getSetPriceHistory } = _req('utils/priceHistory.js');
    const v = await getSetPriceHistory([uid], SET, 'CHF');
    assert.equal(v.purchase_price, 92.5, 'die erste Erfassung, umgerechnet');
    assert.equal(v.by_condition.N.purchase_price, (92.5 + 38) / 2);
  });

  await t.test('Teil', async () => {
    await haeltTeil(db, uid, TEIL, { colorId: FARBE, menge: 10, preis: 2, am: '2026-01-07T09:00:00Z' });
    await db.run(`UPDATE part_acquisitions SET currency = 'USD' WHERE user_id = $1`, [uid]);
    const { getPartPriceHistory } = _req('utils/priceHistory.js');
    const v = await getPartPriceHistory([uid], TEIL, FARBE, 'CHF');
    // 2 USD / 1,26 × 0,96 = 1,5238
    assert.equal(v.by_condition.N.purchase_price, 1.5238);
  });
});
