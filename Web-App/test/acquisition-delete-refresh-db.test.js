/**
 * Eine Erfassung löschen → Preis und Zustand der ANTWORT werden NEU bestimmt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet, mengeVon, haltZeile } = require('./helpers/bestand');
const db = _req('db/database.js');

test('Löschen einer Erfassung bestimmt Preis und Zustand der Elternzeile neu',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

  const USER = `delp-${process.pid}`;
  const SN = `41439-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  // Zwei Erfassungen; die Elternzeile trägt den Wert der NEUESTEN.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    // Nur die Bestandszeile, ohne Zahlen: Menge, Preis und Zustand stehen in
    // den beiden Erfassungen darunter (Migration 0032 fuer Preis und Zustand,
    // 0036 fuer die Menge). Menge 0 heisst hier „die Erfassungen tragen sie" —
    // 1 + 1 = 2, wie vorher in der Spalte.
    await haeltSet(db, uid, SN, 0);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.41,'U',1, NOW() - INTERVAL '2 days')`, [uid, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,9.48,'N',1, NOW() - INTERVAL '1 day')`, [uid, SN]);
  };
  const neueste = async () => (await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at DESC, id DESC LIMIT 1`, [uid, SN])).id;
  // Was die Kachel sieht: das Aggregat aus den Erfassungen plus die Menge der
  // sets-Zeile (die der Lösch-Weg weiterhin nachrechnet).
  const eltern = async () => {
    // „Gibt es die Zeile?" und „wie viele Exemplare?" sind seit Migration 0036
    // zwei Fragen an zwei Tabellen — vorher beantwortete die Spalte beide
    // zugleich. Die Reihenfolge bleibt: ohne Bestandszeile gibt es keine
    // Elternangabe, auch wenn noch Erfassungen herumliegen sollten.
    if (!(await haltZeile(db, uid, SN))) return undefined;
    const agg = await _req('src/sets/index.js').getSetConditionAggregate([uid], SN);
    return { purchase_price: agg.avg_purchase_price, condition: agg.condition,
             quantity: await mengeVon(db, uid, SN) };
  };

  try {
    // 0. Vor dem Löschen: zwei Erfassungen, 7.41 und 9.48, je ein Exemplar.
    //    Die alte Spalte hätte 9.48 geführt (Preis der neuesten Erfassung).
    //    Die Antwort muss den mengengewichteten Mittelwert zeigen.
    await aufbauen();
    const vorher = await eltern();
    assert.equal(Number(vorher.purchase_price), 8.445,
      'Der gezeigte Preis ist nicht der Mittelwert über die Erfassungen — ' +
      'bei 9.48 steht dort weiterhin der Wert der NEUESTEN Erfassung');
    assert.equal(vorher.condition, 'U',
      'Eine gebrauchte Erfassung macht das Set gebraucht');

    // 1. Marcos Fall: die neueste Erfassung löschen.
    await aufbauen();
    let r = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${await neueste()}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    let e = await eltern();
    assert.equal(Number(e.purchase_price), 7.41,
      'Die Kachel zeigt den Preis der GELÖSCHTEN Zeile — sie muss der verbliebenen folgen');
    // 7.41 ist hier gleichzeitig der Mittelwert, weil nur eine Erfassung übrig
    // ist. Teilschritt 2 unten trennt die beiden Lesarten.
    assert.equal(e.condition, 'U',
      'Auch der Zustand muss der verbliebenen Erfassung folgen, nicht der gelöschten');
    assert.equal(Number(e.quantity), 1, 'Die Menge muss weiterhin stimmen');

    // 2. Gegenrichtung: Löscht man eine ÄLTERE Erfassung, darf sich am Preis
    //    nichts ändern — die neueste bleibt ja bestehen.
    await aufbauen();
    const alte = (await db.all(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
        ORDER BY created_at ASC, id ASC`, [uid, SN]))[0].id;
    r = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${alte}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    e = await eltern();
    assert.equal(Number(e.purchase_price), 9.48,
      'Beim Löschen einer älteren Erfassung darf der Preis der neuesten stehen bleiben');

    // 3. Letzte Erfassung löschen: Es bleibt keine übrig — und seit
    //  auch keine Elternzeile mehr.
    await aufbauen();
    for (const row of await db.all(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, SN])) {
      await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${row.id}`, { method: 'DELETE' });
    }
    assert.equal(await eltern(), undefined,
      'Ohne Erfassungen darf keine Set-Zeile mit Menge 0 zurückbleiben');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r2 => srv.close(r2));
    await db.pool.end().catch(() => {});
  }
});
