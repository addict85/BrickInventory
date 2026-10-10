/**
 * Kaufpreis ändern → die Kachel zieht mit, auf BEIDEN Wegen.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 51) ───────────────────
 * Screenshot aus der App: In der Erfassung steht 107.00 CHF, die Kachel oben
 * zeigt weiterhin 108.00 CHF. Der Kaufpreis wurde also gespeichert, aber die
 * Anzeige blieb auf dem alten Wert.
 *
 * Ursache: In der Konfiguration der v1-Erfassungsrouten stand für SETS
 * `parentPriceSql: null` — als einzige der drei Elementarten. Teile und
 * Minifiguren spiegelten seit jeher, und die Webapp-Route tut es für Sets
 * ebenfalls. Nur der Android-Weg liess die sets-Zeile stehen. Weil Galerie,
 * Finanzübersicht und Detail-Kachel alle aus `sets.purchase_price` lesen,
 * zeigte die ganze App danach den alten Wert — dauerhaft, nicht nur bis zum
 * Neuladen.
 *
 * ── Was Migration 0032 daran geändert hat ───────────────────────────────────
 * Es gibt keine Spiegelung mehr, weil es keine zweite Spalte mehr gibt.
 * `parentPriceSql` ist für Sets wieder `null` — diesmal nicht aus Versehen,
 * sondern weil nichts zu spiegeln ist. Die Kachel rechnet aus den Erfassungen
 * (avg_purchase_price in getSetConditionAggregate).
 *
 * Damit ändert sich auch eine REGEL, und zwar sichtbar für Marco: Die Kachel
 * zeigte bisher den Preis der NEUESTEN Erfassung, jetzt den mengengewichteten
 * Mittelwert über alle. Bei einem Set mit einem Kauf ist das dasselbe; bei
 * zwei verschieden teuren Käufen ist der Mittelwert die Zahl, die zur Menge
 * daneben passt (Anzeige × Menge = Summe). Der Teilschritt „Gegenrichtung"
 * unten hält genau diesen Unterschied fest.
 *
 * Gegenprobe (durchgeführt): in getSetConditionAggregate() avg_purchase_price
 * auf `MAX(purchase_price)` umgestellt → „Gegenrichtung" wird rot
 * (erwartet 125, bekommen 200). Danach zurückgesetzt.
 *
 * FALLE beim Schreiben dieses Tests: Beim ersten Anlauf räumte mein Aufbau
 * zwischen den beiden Läufen nur `sets` weg, nicht `set_acquisitions`. Die
 * Erfassung aus dem ersten Lauf blieb liegen, „die neueste Erfassung" war
 * dadurch eine andere Zeile, und der Test meldete einen Fehler, den es nicht
 * gab. Deshalb hier ausdrücklich beide Tabellen leeren.
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

test('der geänderte Kaufpreis erreicht die sets-Zeile — Webapp UND App',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const USER = `spiegel-${process.pid}`;
  const SN   = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/sets': 'routes/sets.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  // Ausgangslage jedes Mal frisch herstellen — inklusive der Erfassungen.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity)
                  VALUES ($1,$2,'Space Roller Coaster',1)`, [uid, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`, [uid, SN]);
    return (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])).id;
  };
  // Was die Kachel zeigt: das Aggregat aus den Erfassungen. Hier stand
  // `SELECT purchase_price FROM sets` — die gespiegelte Spalte, die es seit
  // Migration 0032 nicht mehr gibt.
  const kachel = async () =>
    (await _req('utils/handlers/sets.js').getSetConditionAggregate([uid], SN)).avg_purchase_price;

  try {
    for (const [name, pfad] of [
      ['Webapp',  (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
      ['Android', (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
    ]) {
      const id = await aufbauen();
      const r = await fetch(`${base}${pfad(id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: 107.00 }),
      });
      assert.equal(r.status, 200, `${name}: die Änderung muss angenommen werden`);

      const erfasst = parseFloat(
        (await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id])).purchase_price);
      assert.equal(erfasst, 107.00, `${name}: die Erfassung muss den neuen Preis tragen`);
      assert.equal(await kachel(), 107.00,
        `${name}: die Kachel zieht den neuen Preis nicht mit — Galerie, Finanzübersicht und ` +
        'Detail-Kachel rechnen aus den Erfassungen und zeigen dann den alten Wert');
    }

    // Gegenrichtung — und hier liegt der Unterschied zu vorher.
    //
    // Bis Migration 0032 lautete die Regel: Ändert man eine ÄLTERE Erfassung,
    // bleibt die Kachel stehen, denn sie zeigt die NEUESTE (200). Jetzt zählt
    // jede Erfassung mit: 50 und 200, je ein Exemplar → 125.
    //
    // Das ist die bessere Zahl. Die alte liess sich nicht mit der Menge
    // daneben multiplizieren: „1 Stück zu 200" bei einem Bestand von zwei
    // Exemplaren für zusammen 250 war schlicht falsch.
    const alt = await aufbauen();
    // Ein anderer TAG, nicht bloss eine Stunde später: Der Index
    // idx_set_acq_tag lässt pro Tag und Set nur EINE Erfassung zu. Mit
    // „+1 hour" hing der Test an der Uhrzeit des Laufs — abends fiel die
    // zweite Zeile auf denselben Tag und der Aufbau scheiterte am Index
    // (in der Suite um 23:xx aufgefallen, mittags wäre es durchgegangen).
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,200.00,'U',1, NOW() + INTERVAL '1 day')`, [uid, SN]);
    const r2 = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${alt}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 50.00 }),
    });
    assert.equal(r2.status, 200);
    assert.equal(await kachel(), 125.00,
      'Die Kachel muss den Mittelwert über BEIDE Erfassungen zeigen (50 und 200). ' +
      'Bei 200 zählt weiterhin nur die neueste — die Regel der gelöschten Spalte.');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
