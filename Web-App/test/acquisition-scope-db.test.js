/**
 * Kaufpreis einer Erfassung des UNTERKONTOS ändern — beide Routenfamilien.
 *
 * ── Woher dieser Test kommt (Marcos Fehlerbericht, Nachtrag 45) ─────────────
 * „Wenn ich den Kaufpreis im Kaufpreis-Dialog anpasse (Android oder Webapp),
 * wird er nicht gespeichert. In der Webapp kommt die Meldung Not found."
 * Sein Server-Log zeigte zwei 404 aus derselben Wurzel:
 *   routes/sets.js:1225            → „Not found"
 *   routes/api_v1/acquisitions.js  → „Erfassung nicht gefunden"
 *
 * Ursache: Beide Wege suchten die Zeile mit `WHERE id=$1 AND user_id=$2` und
 * der EIGENEN Betrachter-ID. Im Haushalt gehört die Erfassung aber oft einem
 * Unterkonto — das Hauptkonto darf sie sehen UND ändern, fand sie hier aber
 * nicht. Wieder das Muster „Regel fehlt am zweiten Weg", diesmal an vier
 * Stellen gleichzeitig (Ändern und Löschen, Webapp und App).
 *
 * Bewusst NICHT scopeIds(): Das ist das LESE-Blickfeld und enthält für ein
 * Unterkonto auch dessen Hauptkonto — damit dürfte es rückwärts schreiben.
 * writableIds() ist enger und deckt sich mit canWriteFor(). Die Asymmetrie
 * „Lesen weit, Schreiben eng" prüft der letzte Teilschritt ausdrücklich mit.
 *
 * Zweiter Teil des Fixes: Nach dem Finden zählt der BESITZER der Zeile, nicht
 * der Betrachter. Sonst liefe die Spiegelung nach `sets` (Menge, Preis,
 * Zustand) in das falsche Konto. Beim ersten Anlauf hatte ich genau das
 * übersehen — drei `latest`-Abfragen suchten weiter mit der Betrachter-ID, und
 * die Spiegelung blieb still auf dem alten Wert stehen.
 *
 * Gegenprobe (durchgeführt): writableIds in routes/sets.ts zurück auf die
 * eigene ID → der erste Teilschritt endet wieder in 404.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
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

test('das Hauptkonto kann den Kaufpreis einer Unterkonto-Erfassung ändern',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = 'acqscope-haupt', SUB = 'acqscope-sub', SET = '60445-1';
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [hauptId, subId]);

  await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]);
  // Set UND Erfassung gehören dem Unterkonto — wie im gemeldeten Fall.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                VALUES ($1,$2,'F1 Truck',1,'U',18.20)`, [subId, SET]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,18.20,'U',1)`, [subId, SET]);
  const acqId = (await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [subId, SET])).id;

  const appFuer = (userId) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId };
      req.apiUser = { user_id: userId, is_admin: 0 };
      next();
    });
    app.use('/api/sets', _req('routes/sets.js'));
    app.use('/api/v1', _req('routes/api_v1/index.js'));
    return app;
  };

  const srvHaupt = appFuer(hauptId).listen(0);
  const srvSub   = appFuer(subId).listen(0);
  const baseHaupt = `http://localhost:${srvHaupt.address().port}`;
  const baseSub   = `http://localhost:${srvSub.address().port}`;
  const preis = async () => parseFloat(
    (await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [acqId])).purchase_price);

  try {
    // 1. Der gemeldete Fall: Webapp-Route, Hauptkonto ändert Unterkonto-Zeile.
    let r = await fetch(`${baseHaupt}/api/v1/sets/${SET}/acquisitions/${acqId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 25.50 }),
    });
    assert.equal(r.status, 200, 'die Webapp-Route darf nicht mehr 404 „Not found" liefern');
    assert.equal(await preis(), 25.50, 'der neue Kaufpreis muss gespeichert sein');

    // Die Spiegelung nach sets gehört dem BESITZER, nicht dem Betrachter.
    const gespiegelt = await db.get(
      `SELECT purchase_price FROM sets WHERE user_id=$1 AND set_number=$2`, [subId, SET]);
    assert.equal(parseFloat(gespiegelt.purchase_price), 25.50,
      'sets.purchase_price des Unterkontos muss mitgezogen werden');

    // 2. Dieselbe Änderung über die Android-Route.
    r = await fetch(`${baseHaupt}/api/v1/sets/${SET}/acquisitions/${acqId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 31.00 }),
    });
    assert.equal(r.status, 200, 'die Android-Route darf nicht mehr 404 liefern');
    assert.equal(await preis(), 31.00);

    // 3. „Lesen weit, Schreiben eng": Das UNTERKONTO darf NICHT rückwärts in
    //    eine Erfassung des Hauptkontos schreiben. Diese Asymmetrie ist der
    //    Grund, warum hier writableIds() steht und nicht scopeIds().
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,99.00,'N',1)`, [hauptId, SET]);
    const fremdeId = (await db.get(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [hauptId, SET])).id;
    r = await fetch(`${baseSub}/api/v1/sets/${SET}/acquisitions/${fremdeId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 1.00 }),
    });
    assert.equal(r.status, 404, 'ein Unterkonto darf die Erfassung des Hauptkontos NICHT ändern');
    const unveraendert = await db.get(
      `SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [fremdeId]);
    assert.equal(parseFloat(unveraendert.purchase_price), 99.00, 'und sie darf sich nicht geändert haben');
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]).catch(() => {});
    await new Promise(r2 => srvHaupt.close(r2));
    await new Promise(r2 => srvSub.close(r2));
    await db.pool.end().catch(() => {});
  }
});
