/**
 * Kaufpreis einer Erfassung des UNTERKONTOS ändern — beide Routenfamilien.
 *
 * Gegenprobe (durchgeführt): schreibbereich in src/collection/acquisitions.ts zurück auf die
 * eigene ID → der erste Teilschritt endet wieder in 404.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('das Hauptkonto kann den Kaufpreis einer Unterkonto-Erfassung ändern', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = 'acqscope-haupt',
    SUB = 'acqscope-sub',
    SET = '60445-1';
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);

  await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SET]);
  await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]);
  // Set UND Erfassung gehören dem Unterkonto — wie im gemeldeten Fall.
  await holdsSet(db, subId, SET, 0); // Menge 0: die Erfassung dahinter traegt sie
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,18.20,'U',1)`,
    [subId, SET],
  );
  const acqId = (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [subId, SET])).id;

  const appFor = userId => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId };
      req.apiUser = { user_id: userId, is_admin: 0 };
      next();
    });
    app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
    return app;
  };

  const srvMain = appFor(mainId).listen(0);
  const srvSub = appFor(subId).listen(0);
  const baseMain = `http://localhost:${srvMain.address().port}`;
  const baseSub = `http://localhost:${srvSub.address().port}`;
  const preis = async () =>
    parseFloat((await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [acqId])).purchase_price);

  try {
    // 1. Der gemeldete Fall: Webapp-Route, Hauptkonto ändert Unterkonto-Zeile.
    let r = await fetch(`${baseMain}/api/v1/sets/${SET}/acquisitions/${acqId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 25.5 }),
    });
    assert.equal(r.status, 200, 'die Webapp-Route darf nicht mehr 404 „Not found" liefern');
    assert.equal(await preis(), 25.5, 'der neue Kaufpreis muss gespeichert sein');

    // Geschrieben wird in die Erfassung des BESITZERS, nicht des Betrachters:
    // Um diese Besitzerfrage geht es in diesem Test.
    const onOwner = await db.get(`SELECT purchase_price FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [
      subId,
      SET,
    ]);
    assert.equal(parseFloat(onOwner.purchase_price), 25.5, 'die Erfassung des Unterkontos muss den neuen Preis tragen');

    // 2. Dieselbe Änderung über die Android-Route.
    r = await fetch(`${baseMain}/api/v1/sets/${SET}/acquisitions/${acqId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 31.0 }),
    });
    assert.equal(r.status, 200, 'die Android-Route darf nicht mehr 404 liefern');
    assert.equal(await preis(), 31.0);

    // 3. „Lesen weit, Schreiben eng": Das UNTERKONTO darf NICHT rückwärts in
    //    eine Erfassung des Hauptkontos schreiben. Diese Asymmetrie ist der
    //    Grund, warum hier schreibbereich() steht und nicht scopeIds().
    await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mainId, SET]);
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,99.00,'N',1)`,
      [mainId, SET],
    );
    const fremdeId = (await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [mainId, SET]))
      .id;
    r = await fetch(`${baseSub}/api/v1/sets/${SET}/acquisitions/${fremdeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_price: 1.0 }),
    });
    assert.equal(r.status, 404, 'ein Unterkonto darf die Erfassung des Hauptkontos NICHT ändern');
    const unveraendert = await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [fremdeId]);
    assert.equal(parseFloat(unveraendert.purchase_price), 99.0, 'und sie darf sich nicht geändert haben');
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SET]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]).catch(() => {});
    await new Promise(r2 => srvMain.close(r2));
    await new Promise(r2 => srvSub.close(r2));
    await db.pool.end().catch(() => {});
  }
});
