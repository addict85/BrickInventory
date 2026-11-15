/**
 * Marktpreis und Preisverlauf für HAUSHALTS-Sets — gegen echte Routen.
 *
 * Gegenprobe (durchgeführt): blickfeldIds in der Preisroute wieder durch die
 * nackte ID ersetzt → der 404-Schritt hier wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für
 * account_links). Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');
const db = testDaten();

test('das Hauptkonto sieht Marktpreis und Verlauf eines Unterkonto-Sets', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  // account_links kommt aus den Migrationen, nicht aus initSchema
  // (Muster wie in test/household-db.test.js).
  const mc = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(mc);
  } finally {
    mc.release();
  }

  const HAUPT = 'hhprice-haupt',
    SUB = 'hhprice-sub',
    SET = '42200-1';
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    hauptId,
    subId,
  ]);
  await db.run(
    `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
    [hauptId],
  );
  // Im Haushalt gilt eine Währung (src/haushalt/haushalt.ts) — auch für das Unterkonto.
  await db.run(
    `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
    [subId],
  );

  await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]);
  await db.run(`DELETE FROM price_history WHERE set_number=$1`, [SET]);
  // Das Set gehört dem UNTERKONTO — wie im Screenshot.
  await haeltSet(db, subId, SET, 0); // Menge 0: die Erfassung dahinter traegt sie
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity) VALUES ($1,$2,18.20,'U',1)`,
    [subId, SET],
  );
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
                VALUES ($1,'U','CHF',15,22.50,30,23,4,NOW())
                ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET avg_price=22.50, fetched_at=NOW()`,
    [SET],
  );
  await db.run(
    `INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                SELECT $1,'U','CHF',20+d*0.1,20,(CURRENT_DATE-d)::timestamptz FROM generate_series(1,10) d`,
    [SET],
  );

  // Betrachter ist das HAUPTKONTO.
  const { base, srv } = testServer(_req, { sitzung: { userId: hauptId, username: HAUPT, isAdmin: false }, t });

  try {
    // 1. Der eigentliche Fund: Die Preisroute darf nicht mehr 404 geben.
    let r = await fetch(`${base}/api/v1/sets/${SET}/price`);
    assert.equal(r.status, 200, 'Preisroute muss das Haushalts-Set finden (vorher: 404 Set not found)');
    let j = await r.json();
    assert.equal(parseFloat(j.avg_price), 22.5, 'der CHF-Cache-Preis muss ankommen');
    assert.ok(!j.no_price, 'kein no_price — genau das war der leere Marktpreis in der App');

    // 2. Verlauf: Chartpunkte UND by_condition mit Kaufpreis des Unterkontos.
    r = await fetch(`${base}/api/v1/sets/${SET}/price-history`);
    assert.equal(r.status, 200);
    j = await r.json();
    const punkte = (j.chart?.values || []).reduce((a, s) => a + (s.values || []).length, 0);
    assert.ok(punkte >= 10, `der Chart braucht die Verlaufspunkte (bekommen: ${punkte})`);
    assert.ok(j.by_condition?.U, 'by_condition.U muss existieren — die Erfassung des Unterkontos zählt');
    assert.equal(parseFloat(j.by_condition.U.purchase_price), 18.2, 'Kaufpreis des Unterkontos');
    assert.equal(parseFloat(j.by_condition.U.market_price), 22.5);

    // 3. Dieselbe Logik am Webapp-Weg (gemeinsamer Helfer).
    r = await fetch(`${base}/api/finance/price-history/${SET}`);
    if (r.status === 404) {
      // Pfadform prüfen, ohne die Webapp-Route zu raten: query-Variante.
      r = await fetch(`${base}/api/finance/price-history?set=${SET}`);
    }
    if (r.status === 200) {
      j = await r.json();
      assert.ok(j.by_condition?.U, 'auch die Webapp-Route liefert by_condition.U für das Haushalts-Set');
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]).catch(() => {});
    await db.run(`DELETE FROM price_history WHERE set_number=$1`, [SET]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SET]).catch(() => {});
    await new Promise(r2 => srv.close(r2));
    await db.pool.end().catch(() => {});
  }
});
