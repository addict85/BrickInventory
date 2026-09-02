/**
 * Menge eines UNTERKONTO-Sets ändern — beide Routenfamilien.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 52) ───────────────────
 * „Wenn die Anzahl eines Sets erhöht wird, welches einem Unterkonto gehört,
 * funktioniert die ganze Logik nicht mit dem Kaufpreis und die Anzahl wird
 * nicht gespeichert."
 *
 * Ursache: `updateSet()` suchte das Set mit `WHERE user_id=$1` und der EIGENEN
 * Betrachter-ID — 404 für jedes Set des Unterkontos. Beim Nachmessen zeigte
 * sich, dass es BEIDE Wege trifft, auch die Webapp, die Marco noch nicht
 * getestet hatte.
 *
 * Dieselbe Klasse wie Nachtrag 45 (dort der Kaufpreis, hier die Menge) — und
 * weil die Mengenänderung über adjustAcquisitionsToQuantity() auch Erfassungen
 * anlegt und Preise bestimmt, blieb gleich die ganze Kette wirkungslos. Genau
 * das beschreibt Marcos Satz „die ganze Logik mit dem Kaufpreis".
 *
 * Nach dem Finden zählt der BESITZER der Zeile, nicht der Betrachter — sonst
 * entstünden die Erfassungen im falschen Konto. Das prüft der Test mit.
 *
 * Gegenprobe (durchgeführt): writableIds in updateSet zurück auf die eigene ID
 * → beide Teilschritte enden wieder in 404.
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
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('eine Mengenerhöhung am Unterkonto-Set landet im eigenen Konto',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `qty-haupt-${process.pid}`, SUB = `qty-sub-${process.pid}`;
  const SN = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: hauptId },
    apiNutzer: { user_id: hauptId, is_admin: 0 },
    routen: { '/api/sets': 'routes/sets.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    // Set UND Erfassung gehören dem Unterkonto.
    // Marktpreis im Cache: Die neue Erfassung soll IHN bekommen und nicht den
    // Kaufpreis des anderen Kontos — dessen Kauf ist nicht meiner.
    await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                  ON CONFLICT (key) DO UPDATE SET value='EUR'`);
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]);
    await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'U','EUR',77.00,77.00,4)`, [SN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'Space Roller Coaster',1,'U',108.00)`, [subId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`, [subId, SN]);
  };

  try {
    for (const [name, pfad] of [
      ['Webapp',  `/api/v1/sets/${SN}`],
      ['Android', `/api/v1/sets/${SN}`],
    ]) {
      await aufbauen();
      const r = await fetch(`${base}${pfad}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: 3 }),
      });
      assert.equal(r.status, 200, `${name}: die Mengenänderung darf nicht mehr in 404 enden`);

      const set = await db.get(
        `SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2`, [subId, SN]);
      // ── Marcos neue Regel (Nachtrag 85) ────────────────────────────────
      // „Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese
      // erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag
      // erstellen."
      //
      // Bis Nachtrag 52 endete das hier in einem 404 — das bleibt geprüft.
      // Bis Nachtrag 84 landete die Erhöhung dann beim BESITZER der Zeile, und
      // dieser Test verlangte ausdrücklich, dass im Konto des Betrachters
      // KEINE Erfassung entsteht. Genau das ist jetzt umgekehrt: Die
      // angezeigte 3 ist die Gesamtmenge des Haushalts, die Differenz gehört
      // dem, der sie auslöst.
      const beimBesitzer = await db.get(
        `SELECT COALESCE(SUM(quantity),0)::int AS q FROM sets WHERE user_id=$1 AND set_number=$2`,
        [subId, SN]);
      assert.equal(beimBesitzer.q, 1,
        `${name}: der Bestand des Unterkontos darf sich durch eine fremde Erhöhung nicht ändern`);

      const beimBetrachter = await db.get(
        `SELECT COALESCE(SUM(quantity),0)::int AS q FROM sets WHERE user_id=$1 AND set_number=$2`,
        [hauptId, SN]);
      assert.equal(beimBetrachter.q, 2,
        `${name}: die Differenz (3 − 1) muss im eigenen Konto liegen`);

      const gesamt = await db.get(
        `SELECT COALESCE(SUM(quantity),0)::int AS q FROM sets WHERE set_number=$1`, [SN]);
      assert.equal(gesamt.q, 3, `${name}: die Gesamtmenge muss der Eingabe entsprechen`);

      // Und die Erfassungen ziehen mit — im eigenen Konto, mit Preis.
      const acq = await db.get(
        `SELECT COALESCE(SUM(quantity),0)::int AS q,
                COUNT(*) FILTER (WHERE purchase_price IS NOT NULL)::int AS mit_preis
           FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [hauptId, SN]);
      assert.equal(acq.q, 2, `${name}: die Erfassungsmenge des eigenen Kontos muss folgen`);
      assert.ok(acq.mit_preis > 0,
        `${name}: die neue Erfassung braucht einen Kaufpreis — sonst fehlt sie in jeder Summe`);
      const preis = await db.get(
        `SELECT purchase_price FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
          ORDER BY id DESC LIMIT 1`, [hauptId, SN]);
      assert.equal(Number(preis.purchase_price), 77,
        `${name}: es muss der MARKTPREIS sein (77), nicht der Kaufpreis des anderen Kontos (108)`);
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
