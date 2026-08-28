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
 * Wieder das Muster „dieselbe Regel fehlt am zweiten Weg". Deshalb prüft
 * dieser Test beide Routenfamilien gegeneinander statt nur die reparierte.
 *
 * Gegenprobe (durchgeführt): parentPriceSql zurück auf null → der
 * Android-Teilschritt zeigt wieder 108.
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

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/sets', _req('routes/sets.js'));
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Ausgangslage jedes Mal frisch herstellen — inklusive der Erfassungen.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'Space Roller Coaster',1,'U',108.00)`, [uid, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`, [uid, SN]);
    return (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])).id;
  };
  const kachel = async () => parseFloat(
    (await db.get(`SELECT purchase_price FROM sets WHERE user_id=$1 AND set_number=$2`, [uid, SN])).purchase_price);

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
        `${name}: sets.purchase_price wurde NICHT mitgezogen — Galerie, Finanzübersicht und ` +
        'Detail-Kachel lesen von dort und zeigen dann dauerhaft den alten Wert');
    }

    // Gegenrichtung: Ist die geänderte Erfassung NICHT die neueste, darf die
    // Kachel sich auch nicht ändern — sie zeigt definitionsgemäss die neueste.
    const alt = await aufbauen();
    // Ein anderer TAG, nicht bloss eine Stunde später: Der Index
    // idx_set_acq_tag lässt pro Tag und Set nur EINE Erfassung zu. Mit
    // „+1 hour" hing der Test an der Uhrzeit des Laufs — abends fiel die
    // zweite Zeile auf denselben Tag und der Aufbau scheiterte am Index
    // (in der Suite um 23:xx aufgefallen, mittags wäre es durchgegangen).
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,200.00,'U',1, NOW() + INTERVAL '1 day')`, [uid, SN]);
    await db.run(`UPDATE sets SET purchase_price=200.00 WHERE user_id=$1 AND set_number=$2`, [uid, SN]);
    const r2 = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${alt}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 50.00 }),
    });
    assert.equal(r2.status, 200);
    assert.equal(await kachel(), 200.00,
      'eine ÄLTERE Erfassung darf die Kachel nicht überschreiben — sie zeigt die neueste');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
