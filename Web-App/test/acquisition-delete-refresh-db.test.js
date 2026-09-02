/**
 * Eine Erfassung löschen → Preis und Zustand der Elternzeile werden NEU
 * bestimmt.
 *
 * ── Woher dieser Test kommt (Marcos Screenshot, Nachtrag 75) ────────────────
 * „Wenn ich in der Android-App einen Kaufpreis entferne, wird der Preis auf der
 * Detailseite nicht aktualisiert." Auf dem Bild: die verbliebene Erfassung
 * zeigt 7.41 CHF, die Kachel oben weiterhin 9.48 — den Preis der GELÖSCHTEN
 * Zeile.
 *
 * Ursache: Der Lösch-Weg der gemeinsamen Fabrik aktualisierte nur die MENGE
 * (parentQuantitySql). Preis und Zustand blieben stehen. Das fällt weiter auf
 * als es klingt: Kachel, Galerie und Finanzübersicht lesen alle aus
 * sets.purchase_price.
 *
 * Der ÄNDERN-Weg macht es seit jeher richtig („es gilt der Wert der neuesten
 * Erfassung") — der LÖSCHEN-Weg hatte diese Regel nie. Wieder das Muster
 * „dieselbe Regel fehlt am zweiten Weg", diesmal zwischen zwei Zweigen
 * derselben Datei.
 *
 * Gegenprobe (durchgeführt): den Neubestimmungs-Block auskommentiert → der
 * erste Teilschritt zeigt wieder den Preis der gelöschten Zeile.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
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

test('Löschen einer Erfassung bestimmt Preis und Zustand der Elternzeile neu',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

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
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'Katzensalon',2,'N',9.48)`, [uid, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.41,'U',1, NOW() - INTERVAL '2 days')`, [uid, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,9.48,'N',1, NOW() - INTERVAL '1 day')`, [uid, SN]);
  };
  const neueste = async () => (await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at DESC, id DESC LIMIT 1`, [uid, SN])).id;
  const eltern = async () => await db.get(
    `SELECT purchase_price, condition, quantity FROM sets WHERE user_id=$1 AND set_number=$2`, [uid, SN]);

  try {
    // 1. Marcos Fall: die neueste Erfassung löschen.
    await aufbauen();
    let r = await fetch(`${base}/api/v1/sets/${SN}/acquisitions/${await neueste()}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    let e = await eltern();
    assert.equal(Number(e.purchase_price), 7.41,
      'Die Kachel zeigt den Preis der GELÖSCHTEN Zeile — sie muss der verbliebenen folgen');
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
    //    Nachtrag 84 auch keine Elternzeile mehr.
    //
    //    Vorher stand hier „Ohne Erfassungen ist die Menge 0". Genau diese 0
    //    war Marcos Fund: Ein Set mit Menge 0 blieb in Galerie, Statistik und
    //    Bewertung sichtbar — und `quantity || 1` in utils/financeCalc.ts
    //    machte daraus beim Rechnen wieder eine 1. Eine Menge von 0 ist auch
    //    kein Zustand, den jemand herstellen kann: Beide Mengenregler halten
    //    bei 1. Sie entstand ausschliesslich hier, und jetzt gar nicht mehr.
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
