/**
 * Kaufpreis LÖSCHEN → Marktpreis nachfüllen, auf beiden Wegen.
 * Ausführlich: docs/begruendungen/test/acquisition-price-refill-db.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): resolvePrice zurück auf null → der
 * Android-Teilschritt bleibt leer, die Webapp füllt weiterhin.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');

test('ein geleerter Kaufpreis wird aus dem Marktpreis gefüllt — Webapp UND App',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

  const HAUPT = `cp-h-${process.pid}`, SUB = `cp-s-${process.pid}`;
  const SN = `31146-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

  // Marktpreise im gemeinsamen Cache — zwei VERSCHIEDENE, damit auffällt, wenn
  // der falsche Zustand gewinnt.
  await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]);
  await db.run(`INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'CHF','N',12.55,NOW()),($1,'CHF','U',7.30,NOW())`, [SN]);
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','CHF')
                ON CONFLICT (key) DO UPDATE SET value='CHF'`);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: hauptId },
    apiNutzer: { user_id: hauptId, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  // Ausgangslage: Set des UNTERKONTOS mit zwei Erfassungen (gebraucht + neu).
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await haeltSet(db, subId, SN, 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.30,'U',1, NOW() - INTERVAL '1 day')`, [subId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,9.00,'N',1)`, [subId, SN]);
    return (await db.get(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 AND condition='N'`,
      [subId, SN])).id;
  };

  // Marcos Befund: Android füllte 12.55, die Webapp 18.90 — für
  // DENSELBEN Vorgang. Ursache war eine zweite, eigene Preisregel im
  // Webapp-Weg, die die GLOBALE Währung las statt der des Kontos. Deshalb
  // steht hier bewusst eine abweichende globale Währung mit anderen Preisen: …
  // Ausführlich: docs/begruendungen/test/acquisition-price-refill-db.test.js.md#stelle
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(`INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'EUR','N',18.90,NOW()),($1,'EUR','U',9.90,NOW())`, [SN]);
  for (const u of [hauptId, subId]) {
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [u]);
  }

  try {
    const ergebnisse = {};
    for (const [name, pfad] of [
      ['Webapp',  (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
      ['Android', (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
    ]) {
      const id = await aufbauen();
      const r = await fetch(`${base}${pfad(id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: '' }),   // Feld geleert
      });
      assert.equal(r.status, 200, `${name}: das Leeren muss angenommen werden`);

      const acq = await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id]);
      assert.ok(acq.purchase_price !== null,
        `${name}: der Kaufpreis blieb LEER — er muss aus dem Marktpreis gefüllt werden`);
      assert.equal(Number(acq.purchase_price), 12.55,
        `${name}: es muss der NEU-Preis sein (12.55), nicht der Gebraucht-Preis der ` +
        'Erfassung daneben (7.30)');

      // Und die Kachel oben — dort stand Marcos Strich. Sie rechnet seit
      // Migration 0032 aus den Erfassungen; der Bestand hat hier zwei (7.30
      // gebraucht, 12.55 neu, je ein Exemplar), der Mittelwert ist 9.925.
      const kachel = await _req('src/sets/lesen.js')
        .getSetConditionAggregate([subId], SN);
      assert.equal(kachel.avg_purchase_price, 9.925,
        `${name}: die Kachel muss den gefüllten Preis mitrechnen, keinen Strich zeigen`);
      ergebnisse[name] = Number(acq.purchase_price);
    }

    // Die eigentliche Zusage: BEIDE Wege kommen zum selben Ergebnis.
    assert.equal(ergebnisse.Webapp, ergebnisse.Android,
      `Die beiden Clients füllen verschiedene Preise ein (Webapp ${ergebnisse.Webapp}, ` +
      `Android ${ergebnisse.Android}) — die Regel existiert dann wieder zweimal`);
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
