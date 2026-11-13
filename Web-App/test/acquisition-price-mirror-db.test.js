/**
 * Kaufpreis ändern → die Kachel zieht mit, auf BEIDEN Wegen.
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
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');
const db = testDaten();

test('der geänderte Kaufpreis erreicht die Kachel — Webapp UND App', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;

  const USER = `spiegel-${process.pid}`;
  const SN = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  // Ausgangslage jedes Mal frisch herstellen — inklusive der Erfassungen.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await haeltSet(db, uid, SN, 0); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`,
      [uid, SN],
    );
    return (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])).id;
  };
  // Was die Kachel zeigt: das Aggregat aus den Erfassungen. Hier stand
  // `SELECT purchase_price FROM sets` — die gespiegelte Spalte, die es seit
  // Migration 0032 nicht mehr gibt.
  const kachel = async () => (await _req('src/sets/index.js').getSetConditionAggregate([uid], SN)).avg_purchase_price;

  try {
    for (const [name, pfad] of [
      ['Webapp', id => `/api/v1/sets/${SN}/acquisitions/${id}`],
      ['Android', id => `/api/v1/sets/${SN}/acquisitions/${id}`],
    ]) {
      const id = await aufbauen();
      const r = await fetch(`${base}${pfad(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: 107.0 }),
      });
      assert.equal(r.status, 200, `${name}: die Änderung muss angenommen werden`);

      const erfasst = parseFloat(
        (await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id])).purchase_price,
      );
      assert.equal(erfasst, 107.0, `${name}: die Erfassung muss den neuen Preis tragen`);
      assert.equal(
        await kachel(),
        107.0,
        `${name}: die Kachel zieht den neuen Preis nicht mit — Galerie, Finanzübersicht und ` +
          'Detail-Kachel rechnen aus den Erfassungen und zeigen dann den alten Wert',
      );
    }

    // Gegenrichtung — und hier liegt der Unterschied zu vorher.
    const alt = await aufbauen();
    // Ein anderer TAG, nicht bloss eine Stunde später: Der Index
    // idx_set_acq_tag_zustand lässt pro Tag und Set nur EINE Erfassung zu. Mit
    // „+1 hour" hing der Test an der Uhrzeit des Laufs — abends fiel die
    // zweite Zeile auf denselben Tag und der Aufbau scheiterte am Index
    // (in der Suite um 23:xx aufgefallen, mittags wäre es durchgegangen).
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,200.00,'U',1, NOW() + INTERVAL '1 day')`,
      [uid, SN],
    );
    const r2 = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${alt}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 50.0 }),
    });
    assert.equal(r2.status, 200);
    assert.equal(
      await kachel(),
      125.0,
      'Die Kachel muss den Mittelwert über BEIDE Erfassungen zeigen (50 und 200). ' +
        'Bei 200 zählt weiterhin nur die neueste — die Regel der gelöschten Spalte.',
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
