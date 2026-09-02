/**
 * Marktpreis der Detailansicht: Die Währung bestimmt der SERVER, nicht der
 * Client — gegen echte Route und Tabelle.
 *
 * ── Warum es diese Datei gibt (Marcos Fehlerbericht, Nachtrag 31) ───────────
 * Symptom: Die Android-App zeigte in der Detailansicht teilweise keinen
 * Marktpreis, während Finanzübersicht und Galerie-Kachel ihn zeigten.
 *
 * Ursache-Kette, am laufenden Server nachgestellt:
 *   1. Die App speichert die Währung lokal (DataStore), Startwert "EUR" —
 *      übernommen vom Server erst beim ERSTEN Laden der Finanzübersicht.
 *   2. Die Detailansicht schickte diesen Wert als ?currency= mit.
 *   3. GET /api/v1/sets/:sn/price liess den Parameter GEWINNEN
 *      (`req.query.currency || getSetting(...)`).
 *   4. price_cache ist über set_number+condition+currency_code verschlüsselt:
 *      EUR-Anfrage traf den CHF-Cache nie → Live-Versuch (bis zu zwei
 *      BrickLink-Abrufe je Ansicht) → häufig no_price → leere Kachel.
 *   Finanzübersicht und Galerie fragen OHNE Parameter → Nutzereinstellung →
 *   Preis da. Identischer Nutzer, identisches Set: nur der Parameter
 *   unterschied no_price=true von avg_price=629.90.
 *
 * Seit Nachtrag 31 ignoriert die Route den Parameter — wie es die
 * Schwester-Route /price-history aus demselben Grund immer tat. Damit sind
 * auch ALTE App-Fassungen geheilt, ohne Update.
 *
 * Gegenprobe (durchgeführt): `req.query.currency ||` wieder vorangestellt →
 * der erste Teilschritt hier wird rot (no_price statt 629.90).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('der currency-Parameter der App übersteuert die Nutzereinstellung NICHT',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const USERNAME = 'currency-param-test';
  const SET = '10307-1';
  await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin,is_active) VALUES ($1,'x',0,1)`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USERNAME])).id;
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [uid]);
  await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition) VALUES ($1,$2,'Testset',1,'N')`, [uid, SET]);
  // Preis liegt NUR in der eingestellten Währung vor — wie im Betrieb, wo der
  // Preis-Job genau diese füllt.
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
                VALUES ($1,'N','CHF',500,629.90,800,631,7,NOW())
                ON CONFLICT (set_number,condition,currency_code)
                DO UPDATE SET avg_price=629.90, fetched_at=NOW()`, [SET]);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid, username: USERNAME, isAdmin: false },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const hole = async (query) => {
    const r = await fetch(`${base}/api/v1/sets/${SET}/price${query}`);
    assert.equal(r.status, 200);
    return r.json();
  };

  try {
    // Der Fehlerfall von früher: App schickt ihren Startwert EUR mit. Die
    // Antwort muss trotzdem der CHF-Preis der Nutzereinstellung sein.
    let j = await hole('?currency=EUR');
    assert.equal(j.currency, 'CHF', 'die Antwortwährung ist die Nutzereinstellung, nicht der Parameter');
    assert.equal(parseFloat(j.avg_price), 629.90, 'der Preis kommt aus dem Cache der Nutzereinstellung');
    assert.ok(!j.no_price, 'kein no_price — genau das war die leere Kachel');

    // Ohne Parameter (Webapp, künftige App-Fassungen): identisches Ergebnis.
    j = await hole('');
    assert.equal(j.currency, 'CHF');
    assert.equal(parseFloat(j.avg_price), 629.90);
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SET]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
