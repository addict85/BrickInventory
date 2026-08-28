/**
 * Kaufpreis LÖSCHEN → Marktpreis nachfüllen, auf beiden Wegen.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 68) ───────────────────
 * „Wenn ich bei einem bestehenden Set die Anzahl erhöhe und dann den Kaufpreis
 * lösche (bei einem anderen Besitzer), wird der aktuelle Preis nicht von
 * BrickLink abgefüllt." Auf seinem Screenshot stand in der Kaufpreis-Kachel
 * nur ein Strich, obwohl der Marktpreis (12.55 CHF) bekannt war.
 *
 * Ursache: In der Konfiguration der v1-Erfassungsrouten stand für SETS
 * `resolvePrice: null` — als einzige der drei Elementarten. Teile und
 * Minifiguren holen den Marktpreis seit jeher, und die Webapp-Route tut es für
 * Sets ebenfalls. Nur der Android-Weg liess das Feld leer. Weil die Kachel aus
 * `sets.purchase_price` liest und die Spiegelung den leeren Wert übernimmt,
 * stand danach in der ganzen App ein Strich.
 *
 * Wieder das Muster „dieselbe Regel fehlt am zweiten Weg" — dieselbe Zeile in
 * derselben Konfiguration wie schon bei `parentPriceSql` (Nachtrag 51).
 *
 * ZUSTAND ZÄHLT: Ein „Neu"-Eintrag muss den Neu-Preis bekommen, nicht den der
 * Gebraucht-Erfassung daneben. Genau diese Verwechslung prüft der Test mit —
 * im Cache stehen bewusst zwei verschiedene Preise.
 *
 * Gegenprobe (durchgeführt): resolvePrice zurück auf null → der
 * Android-Teilschritt bleibt leer, die Webapp füllt weiterhin.
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

test('ein geleerter Kaufpreis wird aus dem Marktpreis gefüllt — Webapp UND App',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `cp-h-${process.pid}`, SUB = `cp-s-${process.pid}`;
  const SN = `31146-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

  // Marktpreise im gemeinsamen Cache — zwei VERSCHIEDENE, damit auffällt, wenn
  // der falsche Zustand gewinnt.
  await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]);
  await db.run(`INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'CHF','N',12.55,NOW()),($1,'CHF','U',7.30,NOW())`, [SN]);
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','CHF')
                ON CONFLICT (key) DO UPDATE SET value='CHF'`);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: hauptId };
    req.apiUser = { user_id: hauptId, is_admin: 0 };
    next();
  });
  app.use('/api/sets', _req('routes/sets.js'));
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Ausgangslage: Set des UNTERKONTOS mit zwei Erfassungen (gebraucht + neu).
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'Flatbed Truck',2,'N',9.00)`, [subId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.30,'U',1, NOW() - INTERVAL '1 day')`, [subId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,9.00,'N',1)`, [subId, SN]);
    return (await db.get(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 AND condition='N'`,
      [subId, SN])).id;
  };

  // Marcos Befund (Nachtrag 69): Android füllte 12.55, die Webapp 18.90 — für
  // DENSELBEN Vorgang. Ursache war eine zweite, eigene Preisregel im
  // Webapp-Weg, die die GLOBALE Währung las statt der des Kontos. Deshalb
  // steht hier bewusst eine abweichende globale Währung mit anderen Preisen:
  // Läuft irgendwann wieder eine zweite Fassung mit, fallen die beiden Wege
  // sofort auseinander und dieser Test wird rot.
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(`INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'EUR','N',18.90,NOW()),($1,'EUR','U',9.90,NOW())`, [SN]);
  for (const u of [hauptId, subId]) {
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [u]);
  }

  try {
    const ergebnisse = {};
    for (const [name, pfad] of [
      ['Webapp',  (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
      ['Android', (id) => `/api/v1/sets/${SN}/acquisitions/${id}`],
    ]) {
      const id = await aufbauen();
      const r = await fetch(`${base}${pfad(id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: '' }),   // Feld geleert
      });
      assert.equal(r.status, 200, `${name}: das Leeren muss angenommen werden`);

      const acq = await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id]);
      assert.ok(acq.purchase_price !== null,
        `${name}: der Kaufpreis blieb LEER — er muss aus dem Marktpreis gefüllt werden`);
      assert.equal(Number(acq.purchase_price), 12.55,
        `${name}: es muss der NEU-Preis sein (12.55), nicht der Gebraucht-Preis der ` +
        'Erfassung daneben (7.30)');

      // Und die Kachel oben liest aus sets.purchase_price — dort stand Marcos Strich.
      const kachel = await db.get(
        `SELECT purchase_price FROM sets WHERE user_id=$1 AND set_number=$2`, [subId, SN]);
      assert.equal(Number(kachel.purchase_price), 12.55,
        `${name}: die Kachel muss den gefüllten Preis zeigen, keinen Strich`);
      ergebnisse[name] = Number(acq.purchase_price);
    }

    // Die eigentliche Zusage: BEIDE Wege kommen zum selben Ergebnis.
    assert.equal(ergebnisse.Webapp, ergebnisse.Android,
      `Die beiden Clients füllen verschiedene Preise ein (Webapp ${ergebnisse.Webapp}, ` +
      `Android ${ergebnisse.Android}) — die Regel existiert dann wieder zweimal`);
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
