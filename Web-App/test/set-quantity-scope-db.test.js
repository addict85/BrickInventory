/**
 * Menge eines UNTERKONTO-Sets ändern — beide Routenfamilien.
 * Ausführlich: docs/begruendungen/test/set-quantity-scope-db.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): writableIds in updateSet zurück auf die eigene ID
 * → beide Teilschritte enden wieder in 404.
 * Gegenprobe (09.11.2026 gemessen): in requireToken den Sitzungszweig entfernt →
 * rot: „Webapp: … 401 !== 200“. Der App-Weg kommt ohne Sitzung, mit echtem Token;
 * ein falscher Token ergibt 401 (eigene Zusicherung vor der Schleife).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { haeltSet, mengeVon } = require('./helpers/bestand');

test('eine Mengenerhöhung am Unterkonto-Set landet im eigenen Konto',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

  const HAUPT = `qty-haupt-${process.pid}`, SUB = `qty-sub-${process.pid}`;
  const SN = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

  // Die Webapp kommt mit der Sitzung, die App mit einem echten Token und ohne Sitzung.
  const web = testServer(_req, { sitzung: { userId: hauptId }, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const app = testServer(_req, { sitzung: {}, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const token = await _req('src/konto/auth.js').createToken(hauptId, 'test-app', false, null, { scope: 'app' });
  const srv = web.srv;

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
    // Nur die Bestandszeile: Menge, Preis und Zustand stehen in der Erfassung
    // darunter (Migration 0032 fuer Preis und Zustand, 0036 fuer die Menge).
    await haeltSet(db, subId, SN, 0);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`, [subId, SN]);
  };

  try {
    const ohne = await fetch(`${app.base}/api/v1/sets/${SN}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 3 }) });
    assert.equal(ohne.status, 401, 'der App-Weg darf ohne Token nicht durchkommen');
    /** @type {[string, string, Record<string, string>][]} */
    const wege = [
      ['Webapp',  web.base, {}],
      ['Android', app.base, { authorization: `Bearer ${token}` }],
    ];
    for (const [name, base, ausweis] of wege) {
      await aufbauen();
      const r = await fetch(`${base}/api/v1/sets/${SN}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', ...ausweis },
        body: JSON.stringify({ quantity: 3 }),
      });
      assert.equal(r.status, 200, `${name}: die Mengenänderung darf nicht mehr in 404 enden`);

      // (Die Mengen kommen jetzt alle aus den Erfassungen — Migration 0036.)
      // ── Marcos neue Regel ────────────────────────────────
      // „Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese
      // erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag …
      // Ausführlich: docs/begruendungen/test/set-quantity-scope-db.test.js.md#beimbesitzer
      const beimBesitzer = await mengeVon(db, subId, SN);
      assert.equal(beimBesitzer, 1,
        `${name}: der Bestand des Unterkontos darf sich durch eine fremde Erhöhung nicht ändern`);

      const beimBetrachter = await mengeVon(db, hauptId, SN);
      assert.equal(beimBetrachter, 2,
        `${name}: die Differenz (3 − 1) muss im eigenen Konto liegen`);

      const gesamt = await mengeVon(db, [subId, hauptId], SN);
      assert.equal(gesamt, 3, `${name}: die Gesamtmenge muss der Eingabe entsprechen`);

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
