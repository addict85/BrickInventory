/**
 * Preisverlauf im Haushalt — Set, manuelles Teil UND manuelle Minifigur.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * Der Set-Verlauf bekam sein Blickfeld in Nachtrag 33, das manuelle Teil in
 * Nachtrag 96/97. Die Minifigur fiel durch: Beide Routen (Webapp und v1)
 * reichten die nackte Betrachter-ID an getMinifigPriceHistory() durch.
 * conditionRows() filtert die Erfassungen mit `user_id = ANY(...)` — mit nur
 * der eigenen ID fand es für eine Minifigur des Unterkontos keine, und ohne
 * Erfassung entsteht überhaupt keine Zeile: Marktpreis, Kaufpreis und
 * Prozentangabe blieben im Detail leer, `accounts=` wirkte dort gar nicht.
 *
 * Weil BEIDE Routen denselben Stand hatten, war die Paritätsprüfung grün —
 * sie vergleicht die Clients miteinander, nicht gegen die Regel. Deshalb
 * dieser Verhaltenstest, und deshalb über alle drei Arten statt nur über die
 * eine reparierte: Genau diese Familie ist in dieser Reihe schon dreimal
 * einzeln aufgefallen.
 *
 * Gegenprobe (durchgeführt): scopeIds() in den beiden Minifiguren-Routen
 * zurück auf `uid` → beide Minifiguren-Teilschritte werden rot, Set und Teil
 * bleiben grün.
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

test('Preisverlauf: das Hauptkonto sieht die Erfassungen des Unterkontos',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `ph-haupt-${process.pid}`, SUB = `ph-sub-${process.pid}`;
  const SN  = `98001-${process.pid}`;
  const PN  = `ph-part-${process.pid}`;
  const FN  = `ph-fig-${process.pid}`;
  const CUR = 'EUR';

  const aufraeumen = async () => {
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM part_acquisitions WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM part_price_cache WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM minifigs WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM minifig_acquisitions WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM minifig_price_cache WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);
  // Beide Konten auf dieselbe Währung — sonst liest der Verlauf einen anderen
  // Cache-Schlüssel als der Seed schreibt.
  for (const id of [hauptId, subId])
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)
                  ON CONFLICT (user_id,key) DO UPDATE SET value=$2`, [id, CUR]);

  await aufraeumen();

  // ── Bestand ANLEGEN, und zwar durchgehend beim UNTERKONTO ────────────────
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,purchase_price,condition)
                VALUES ($1,$2,'T',1,10,'N')`, [subId, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,10,'N',1)`, [subId, SN]);
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,total_quantity)
                VALUES ($1,'N',$2,20,1)`, [SN, CUR]);

  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source)
                VALUES ($1,$2,4,'T',1,'manual')`, [subId, PN]);
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,unit_price,condition,quantity)
                VALUES ($1,$2,4,3,'N',1)`, [subId, PN]);
  await db.run(`INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price)
                VALUES ($1,4,'N',$2,6)`, [PN, CUR]);

  await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
                VALUES ($1,$2,'T',1,'manual')`, [subId, FN]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,unit_price,condition,quantity)
                VALUES ($1,$2,4,'N',1)`, [subId, FN]);
  await db.run(`INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price)
                VALUES ($1,'N',$2,8)`, [FN, CUR]);

  const appFuer = (userId) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId };
      req.apiUser = { user_id: userId, is_admin: 0 };
      next();
    });
    app.use('/api/v1', _req('routes/api_v1/index.js'));
    return app;
  };
  const srv = appFuer(hauptId).listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Seit Etappe 5 gibt es je Art nur noch EINE Adresse; beide Clients rufen
  // sie auf (requireToken nimmt Sitzung oder Token). Geprüft wird hier die
  // Regel, nicht der Ausweis — die Gleichwertigkeit der Ausweise steht in
  // api-parity.
  const FAELLE = [
    ['Set',       `/api/v1/sets/${SN}/price-history`],
    ['Teil',      `/api/v1/parts/${PN}/4/price-history`],
    ['Minifigur', `/api/v1/minifigs/${FN}/price-history`],
  ];

  try {
    for (const [art, pfad] of FAELLE) {
      const r = await fetch(base + pfad);
      assert.equal(r.status, 200, `${art}: ${pfad} -> ${r.status}`);
      const b = await r.json();
      const n = b.by_condition?.N;
      assert.ok(n,
        `${art}: keine Zeile für „Neu" — die Erfassung des Unterkontos ` +
        'wurde nicht gefunden (fehlendes Blickfeld)');
      assert.ok(n.purchase_price > 0, `${art}: der Kaufpreis des Unterkontos fehlt`);
      assert.ok(n.pnl_pct != null, `${art}: ohne Kaufpreis gibt es auch keine Prozentangabe`);
    }

    // Gegenrichtung: Mit accounts=own schaut das Hauptkonto ausdrücklich nur
    // auf SICH — dann darf die Zeile NICHT erscheinen. Ohne diese Prüfung wäre
    // der Test auch grün, wenn jemand das Blickfeld durch „alle Konten der
    // Installation\" ersetzt.
    for (const [art, pfad] of FAELLE) {
      const r = await fetch(`${base}${pfad}?accounts=own`);
      const b = await r.json();
      assert.equal(b.by_condition?.N, undefined,
        `${art}: mit accounts=own darf die Erfassung des Unterkontos nicht mitzählen`);
    }
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [hauptId]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id IN ($1,$2)`, [hauptId, subId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
