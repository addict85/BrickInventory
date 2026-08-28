/**
 * Set eines UNTERKONTOS löschen — beide Wege, beide Richtungen.
 *
 * ── Woher dieser Test kommt (Marcos Rückfrage, Nachtrag 53) ─────────────────
 * Nach den Funden zum Kaufpreis (45) und zur Menge (52) fragte Marco, ob ich
 * die LÖSCHlogik ebenfalls geprüft habe. Hatte ich nicht — und sie hatte
 * dieselbe Lücke: Beide Wege suchten mit der eigenen Betrachter-ID und gaben
 * für jedes Set des Unterkontos 404. Immerhin ungefährlich (es wurde nie
 * fälschlich etwas gelöscht), aber im Haushalt liess sich schlicht nichts
 * entfernen.
 *
 * Zwei Auffälligkeiten kamen dabei ans Licht:
 *   • `deleteSet()` in utils/handlers.ts KONNTE das Blickfeld längst (asIds +
 *     ANY) — es bekam vom Aufrufer nur eine nackte ID.
 *   • Die Webapp-Route führte vier einzelne DELETEs ohne Transaktion aus,
 *     obwohl der andere Weg dafür längst eine hatte. Bricht eins ab, bleiben
 *     Teile und Minifiguren ohne Set zurück. Jetzt läuft auch sie in EINER
 *     Transaktion.
 *
 * Die Gegenrichtung ist hier besonders wichtig: Löschen ist der Schritt, bei
 * dem „Lesen weit, Schreiben eng" am meisten zählt. Ein Unterkonto darf ein
 * Set des Hauptkontos NICHT löschen — deshalb writableIds() und nicht
 * scopeIds().
 *
 * Gegenprobe (durchgeführt): writableIds in beiden Routen zurück auf die
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

test('Löschen im Haushalt: vorwärts erlaubt, rückwärts nicht',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `del-haupt-${process.pid}`, SUB = `del-sub-${process.pid}`;
  const SN = `99001-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

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

  // Set mit Inhalt anlegen — der Besitzer wird je Fall gewählt.
  const anlegen = async (besitzer) => {
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'T',1)`, [besitzer, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`, [besitzer, SN]);
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                  VALUES ($1,$2,'3001',4,5,'set')`, [besitzer, SN]);
  };
  const bestand = async (besitzer) => ({
    set:   !!(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])),
    teile: (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])).c,
    acq:   (await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])).c,
  });

  try {
    // 1. VORWÄRTS: Hauptkonto löscht ein Set des Unterkontos — und zwar ganz.
    for (const [name, base, pfad] of [
      // Nachtrag 74: Es gibt nur noch EINE Adresse. Beide Zeilen prüfen sie —
      // die Unterscheidung Webapp/App liegt jetzt am Ausweis, nicht am Pfad,
      // und die Sitzung ist in diesem Test für beide gesetzt.
      ['Webapp',  baseHaupt, `/api/v1/sets/${SN}`],
      ['Android', baseHaupt, `/api/v1/sets/${SN}`],
    ]) {
      await anlegen(subId);
      const r = await fetch(`${base}${pfad}`, { method: 'DELETE' });
      assert.equal(r.status, 200, `${name}: das Löschen darf nicht mehr in 404 enden`);
      const b = await bestand(subId);
      assert.equal(b.set, false, `${name}: das Set muss weg sein`);
      assert.equal(b.teile, 0, `${name}: die Teile dürfen nicht als Waisen zurückbleiben`);
      assert.equal(b.acq, 0,
        `${name}: die Kaufpreis-Erfassungen müssen mit — sonst tauchen sie beim erneuten ` +
        'Hinzufügen desselben Sets wieder auf');
    }

    // 2. RÜCKWÄRTS: Das Unterkonto darf ein Set des HAUPTkontos NICHT löschen.
    //    Genau dafür steht dort writableIds() und nicht scopeIds().
    for (const [name, pfad] of [
      ['Webapp',  `/api/v1/sets/${SN}`],
      ['Android', `/api/v1/sets/${SN}`],
    ]) {
      await anlegen(hauptId);
      const r = await fetch(`${baseSub}${pfad}`, { method: 'DELETE' });
      assert.equal(r.status, 404, `${name}: ein Unterkonto darf rückwärts nicht löschen`);
      const b = await bestand(hauptId);
      assert.equal(b.set, true, `${name}: das Set des Hauptkontos muss unangetastet bleiben`);
      assert.equal(b.teile, 1, `${name}: auch die Teile bleiben`);
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srvHaupt.close(r));
    await new Promise(r => srvSub.close(r));
    await db.pool.end().catch(() => {});
  }
});
