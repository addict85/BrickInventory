/**
 * Wird der letzte Kaufpreis gelöscht, bleibt NICHTS zurück.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 * „Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass der Eintrag
 * noch sichtbar war?"
 *
 * Ja — an mehreren Stellen. `parentQuantitySql` setzte die Menge auf 0 und
 * liess die Elternzeile stehen. Nachgemessen mit einem einzelnen Konto und zwei
 * Sets, bei einem davon der Kaufpreis gelöscht:
 *
 *   Galerie      beide Sets, das leere mit „Menge 0"
 *   Statistik    Sets=2 (das leere zählte mit), Einheiten=1
 *   Bewertung    das leere Set mit ×1 bewertet — 20 CHF, die es nicht gibt
 *
 * Der letzte Punkt war der schlimmste: `set.quantity || 1` in
 * utils/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen
 * NULL gedacht, trifft es den echten Wert 0 — und das Portfolio wuchs um ein
 * Set, das niemand mehr besitzt. Dieselbe Verwechslung steckt an achtzehn
 * Stellen in dieser Datei; sie einzeln zu reparieren hiesse, achtzehnmal
 * dieselbe Regel zu pflegen.
 *
 * Deshalb wird die Ursache beseitigt: Eine Menge von 0 entsteht gar nicht mehr.
 * Sie war ohnehin kein Zustand, den jemand absichtlich herstellen kann — beide
 * Mengenregler halten bei 1 (`min="1"` in der Webapp, `if (qty > 1)` in der
 * App).
 *
 * ── Warum der Test über die API geht und nicht über die Funktion ────────────
 * Weil genau dazwischen der Fehler sass: Die Erfassung war gelöscht, die
 * Elternzeile blieb. Ein Test auf `deleteSetRows()` allein hätte das nie
 * gesehen.
 *
 * Gegenprobe (durchgeführt): cleanupWhenEmpty aus der Set-Konfiguration
 * entfernt → drei der vier Teilschritte werden rot (Galerie, Statistik,
 * Bewertung).
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
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('letzter Kaufpreis gelöscht → der Eintrag verschwindet ganz',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `lk-${process.pid}`;
  const WEG    = `80${process.pid % 900 + 100}-1`;   // hier wird gelöscht
  const BLEIBT = `80${process.pid % 900 + 101}-1`;   // Kontrollgruppe

  const aufraeumen = async () => {
    for (const sn of [WEG, BLEIBT])
      for (const tab of ['sets', 'set_acquisitions', 'parts', 'minifigs', 'price_cache'])
        await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [sn]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [uid]);
  await aufraeumen();

  for (const sn of [WEG, BLEIBT]) {
    await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'N','CHF',20,20,3)`, [sn]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price,pieces)
                  VALUES ($1,$2,'T',1,'N',15,100)`, [uid, sn]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,15,'N',1)`, [uid, sn]);
    // Abgeleitete Teile und Minifiguren — sie hängen am Set und müssen
    // mitgehen. Bleiben sie liegen, tauchen sie in Teileliste und
    // Finanzsummen weiter auf, ohne dass es ein Set dazu gäbe.
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source,set_number)
                  VALUES ($1,'3001',4,'Stein',10,'set',$2)`, [uid, sn]);
    await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source,set_number)
                  VALUES ($1,'cty0001','Polizist',1,'set',$2)`, [uid, sn]);
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  const H  = require('./helpers/sources').handlerModul(_req);
  const FC = _req('utils/financeCalc.js');

  try {
    const liste = await (await fetch(`${base}/api/v1/sets/${WEG}/acquisitions`)).json();
    const acqId = liste.acquisitions?.[0]?.id;
    assert.ok(acqId, 'Vorbedingung: es gibt eine Erfassung');
    const r = await fetch(`${base}/api/v1/sets/${WEG}/acquisitions/${acqId}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).new_quantity, 0);

    await t.test('die Galerie zeigt es nicht mehr', async () => {
      const g = await H.getSets([uid], {});
      const nummern = g.sets.map(s => s.set_number);
      assert.deepEqual(nummern, [BLEIBT],
        `Galerie zeigt noch: ${nummern.join(', ')} — ein Set mit Menge 0 ist ein Geistereintrag`);
      assert.equal(g.total, 1, 'die Gesamtzahl zählt es noch mit');
    });

    await t.test('die Statistik zählt es nicht mehr', async () => {
      const st = await H.getStats([uid]);
      assert.equal(st.total_sets, 1, `Sets=${st.total_sets} statt 1`);
      assert.equal(st.total_quantity, 1);
      // Teile und Minifiguren des Sets müssen mitgegangen sein — sonst stünden
      // sie ohne Set in Teileliste und Summen.
      assert.equal(st.total_parts, 10, `Teile=${st.total_parts} — die des gelöschten Sets zählen mit`);
      assert.equal(st.total_minifigs, 1, `Minifiguren=${st.total_minifigs} — dito`);
    });

    await t.test('die Bewertung rechnet es nicht mehr mit', async () => {
      // Der eigentliche Schaden: `quantity || 1` machte aus 0 eine 1, das
      // gelöschte Set trug mit 20 CHF zum Portfolio bei.
      const val = await FC.computeSetsValuation(uid, [uid]);
      const nummern = (val.sets || []).map(s => s.set_number);
      assert.deepEqual(nummern, [BLEIBT],
        `Bewertung enthält noch: ${nummern.join(', ')}`);
      assert.equal(parseFloat(val.totals.avg), 20,
        `Summe ${val.totals.avg} statt 20.00 — ein Set ohne Bestand wird mitbewertet`);
    });

    await t.test('in der Datenbank bleibt keine Zeile zurück', async () => {
      for (const [tab, spalte] of [['sets', 'set_number'], ['parts', 'set_number'],
                                   ['minifigs', 'set_number'], ['set_acquisitions', 'set_number']]) {
        const n = (await db.get(`SELECT COUNT(*)::int c FROM ${tab} WHERE ${spalte}=$1`, [WEG])).c;
        assert.equal(n, 0, `${tab}: ${n} Zeile(n) übrig`);
      }
    });

    await t.test('die Kontrollgruppe ist unberührt', async () => {
      // Ohne diese Gegenrichtung wäre der Test auch grün, wenn das Löschen
      // einer Erfassung den ganzen Bestand mitnähme.
      const n = (await db.get(`SELECT quantity FROM sets WHERE set_number=$1`, [BLEIBT]));
      assert.equal(n?.quantity, 1, 'das andere Set wurde mitgelöscht');
      assert.equal((await db.get(`SELECT COUNT(*)::int c FROM parts WHERE set_number=$1`, [BLEIBT])).c, 1);
    });

    await t.test('eine von mehreren Erfassungen zu löschen ändert nichts am Bestand', async () => {
      // Die Regel greift NUR, wenn keine Erfassung mehr übrig ist.
      // Anderer TAG: Je Konto, Set und Tag ist genau eine Erfassung erlaubt
      // (idx_set_acq_tag) — zwei am selben Tag legt die Datenbank ab.
      await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                    VALUES ($1,$2,9,'U',2, NOW() - INTERVAL '1 day')`, [uid, BLEIBT]);
      const l = await (await fetch(`${base}/api/v1/sets/${BLEIBT}/acquisitions`)).json();
      const erste = l.acquisitions[0].id;
      await fetch(`${base}/api/v1/sets/${BLEIBT}/acquisitions/${erste}`, { method: 'DELETE' });
      const s = await db.get(`SELECT quantity FROM sets WHERE set_number=$1`, [BLEIBT]);
      assert.ok(s, 'das Set wurde gelöscht, obwohl noch eine Erfassung übrig ist');
      assert.ok(s.quantity > 0, `Menge ${s.quantity}`);
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
