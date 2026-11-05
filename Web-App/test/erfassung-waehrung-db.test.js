/**
 * Kaufpreise in fremder Währung und geschätzte Kaufpreise (UI-Prüfung 17, H3
 * und H4), gegen den echten Server:
 *   - Die Summe im Kaufpreis-Dialog rechnet USD zum Kurs des Kauftags in die
 *     Kontowährung um und stimmt mit der Summe der Finanzen überein; vorher
 *     standen 3 × 260,66 USD + 2 × 354,50 EUR als „1.490,98 €“ da.
 *   - Jede Zeile trägt `preis_konto`; ohne Kurs zählt sie in `ohne_kurs`.
 *   - Die Bewertung nennt je Erfassung `price_estimated`, die Setliste
 *     `kaufpreis_geschaetzt`, wenn alle Kaufpreise geschätzt sind.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in erfassungenInKontowaehrung die Summe wieder über purchase_price →
 *      rot: „Summe in Kontowährung wie die Finanzen“ (1490.98)
 *   B  in valueAcquisitionRows das Feld price_estimated weggelassen → rot:
 *      „geschätzte Kaufpreise sind gekennzeichnet“
 *   C  bool_and(...) AS kaufpreis_geschaetzt durch NULL ersetzt → rot:
 *      „geschätzte Kaufpreise sind gekennzeichnet“ (Setliste)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('Kaufpreise in fremder Währung und geschätzte', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  if (!await dbOderSkip(t, _req)) return;
  const P = process.pid, NAME = `waehrung-${P}`, SN = '10326-1', GS = '10305-1';
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => { await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {}); await db.pool.end().catch(() => {}); });
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')", [uid]);
  await db.run(`INSERT INTO wechselkurse (tag, waehrung, je_eur) VALUES ('2019-03-04', 'USD', 1.25), ('2019-03-04', 'JPY', 120)
                ON CONFLICT (waehrung, tag) DO UPDATE SET je_eur = EXCLUDED.je_eur`);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2), ($1,$3)', [uid, SN, GS]);
  await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at, tag)
                VALUES ($1,$2,3,260.66,'N','USD','2019-03-04 12:00','2019-03-04'), ($1,$2,2,354.50,'N','EUR','2019-03-05 12:00','2019-03-05'),
                       ($1,$3,4,308,'N','EUR','2026-11-05 12:00','2026-11-05')`, [uid, SN, GS]);
  await db.run(`UPDATE set_acquisitions SET price_estimated = true WHERE user_id=$1 AND set_number=$2`, [uid, GS]);
  const { base } = testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const hole = async (pfad) => (await fetch(`${base}/api/v1/${pfad}`)).json();

  await t.test('Summe in Kontowährung wie die Finanzen', async () => {
    const r = await hole(`sets/${SN}/acquisitions`);
    assert.equal(r.totals.currency, 'EUR');
    assert.equal(r.totals.ohne_kurs, 0);
    // 3 × 260,66 / 1,25 + 2 × 354,50 = 625,584 + 709
    assert.equal(r.totals.amount, 1334.58);
    const usd = r.acquisitions.find(a => a.currency === 'USD');
    assert.equal(usd.preis_konto, 208.528);
    const v = await hole('finance/valuation');
    const set = v.sets.find(s => s.set_number === SN);
    const finanzen = set.acquisitions.reduce((s, a) => s + a.purchase_price * a.quantity, 0);
    assert.equal(Math.round(finanzen * 100) / 100, r.totals.amount, 'gleicher Betrag wie in den Finanzen');
  });

  await t.test('ohne Kurs nicht eingerechnet, sondern gezählt', async () => {
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at, tag)
                  VALUES ($1,$2,1,9000,'U','JPY','2010-01-01 12:00','2010-01-01')`, [uid, SN]);
    const r = await hole(`sets/${SN}/acquisitions`);
    assert.equal(r.totals.ohne_kurs, 1);
    assert.equal(r.totals.amount, 1334.58);
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1 AND currency='JPY'`, [uid]);
  });

  await t.test('geschätzte Kaufpreise sind gekennzeichnet', async () => {
    const v = await hole('finance/valuation');
    const geschaetzt = v.sets.find(s => s.set_number === GS).acquisitions;
    assert.deepEqual(geschaetzt.map(a => a.price_estimated), [true]);
    assert.ok(v.sets.find(s => s.set_number === SN).acquisitions.every(a => !a.price_estimated));
    const liste = await hole('sets');
    assert.equal(liste.sets.find(s => s.set_number === GS).kaufpreis_geschaetzt, true);
    assert.equal(liste.sets.find(s => s.set_number === SN).kaufpreis_geschaetzt, false);
  });
});
