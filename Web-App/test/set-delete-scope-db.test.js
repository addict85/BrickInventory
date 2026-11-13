/**
 * Set eines UNTERKONTOS löschen — beide Wege, beide Richtungen.
 *
 * Lesen weit, Schreiben eng: Ein Hauptkonto löscht Sets seiner Unterkonten,
 * ein Unterkonto aber kein Set des Hauptkontos. Beide Löschwege laufen in
 * einer Transaktion, damit kein Teil ohne Set zurückbleibt.
 *
 * Gegenprobe (durchgeführt): schreibbereich in beiden Routen zurück auf die
 * eigene ID → der erste Teilschritt endet wieder in 404.
 * Gegenprobe (09.11.2026 gemessen): in requireToken den Sitzungszweig entfernt →
 * rot: „Webapp: … 401 !== 200“. Der App-Weg kommt ohne Sitzung, mit echtem Token;
 * ein falscher Token ergibt 401 (eigene Zusicherung vor der Schleife).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const db = testDaten();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Löschen im Haushalt: vorwärts erlaubt, rückwärts nicht', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const HAUPT = `del-haupt-${process.pid}`,
    SUB = `del-sub-${process.pid}`;
  const SN = `99001-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    hauptId,
    subId,
  ]);

  // Die Webapp kommt mit der Sitzung, die App mit einem echten Token und ohne Sitzung.
  const { createToken } = _req('src/konto/geraeteToken.js');
  const token = {
    [hauptId]: await createToken(hauptId, 'test-app', false, null, { scope: 'app' }),
    [subId]: await createToken(subId, 'test-app', false, null, { scope: 'app' }),
  };
  const appFuer = userId => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = req.headers.authorization ? {} : { userId };
      next();
    });
    app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'));
    return app;
  };
  const srvHaupt = appFuer(hauptId).listen(0);
  const srvSub = appFuer(subId).listen(0);
  const baseHaupt = `http://localhost:${srvHaupt.address().port}`;
  const baseSub = `http://localhost:${srvSub.address().port}`;

  // Set mit Inhalt anlegen — der Besitzer wird je Fall gewählt.
  const anlegen = async besitzer => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]);
    await haeltSet(db, besitzer, SN, 0); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`,
      [besitzer, SN],
    );
    await haeltTeil(db, besitzer, '3001', { setNumber: SN, menge: 5, colorId: 4 });
  };
  const bestand = async besitzer => ({
    set: !!(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])),
    teile: (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])).c,
    acq: (
      await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [besitzer, SN])
    ).c,
  });

  try {
    // 1. VORWÄRTS: Hauptkonto löscht ein Set des Unterkontos — und zwar ganz.
    // Ohne Token und ohne Sitzung kein Zugang: Der App-Weg prüft wirklich den Token.
    const ohne = await fetch(`${baseHaupt}/api/v1/sets/${SN}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer falsch' },
    });
    assert.equal(ohne.status, 401, 'der App-Weg darf nicht über die Sitzung laufen');
    // Eine Adresse, zwei Ausweise: Sitzung (Webapp) und Token (App).
    const ausweis = (name, uid) => (name === 'Android' ? { authorization: `Bearer ${token[uid]}` } : {});
    for (const [name, base, pfad] of [
      ['Webapp', baseHaupt, `/api/v1/sets/${SN}`],
      ['Android', baseHaupt, `/api/v1/sets/${SN}`],
    ]) {
      await anlegen(subId);
      const r = await fetch(`${base}${pfad}`, { method: 'DELETE', headers: ausweis(name, hauptId) });
      assert.equal(r.status, 200, `${name}: das Löschen darf nicht mehr in 404 enden`);
      const b = await bestand(subId);
      assert.equal(b.set, false, `${name}: das Set muss weg sein`);
      assert.equal(b.teile, 0, `${name}: die Teile dürfen nicht als Waisen zurückbleiben`);
      assert.equal(
        b.acq,
        0,
        `${name}: die Kaufpreis-Erfassungen müssen mit — sonst tauchen sie beim erneuten ` +
          'Hinzufügen desselben Sets wieder auf',
      );
    }

    // 2. RÜCKWÄRTS: Das Unterkonto darf ein Set des HAUPTkontos NICHT löschen.
    //    Genau dafür steht dort schreibbereich() und nicht blickfeldIds().
    for (const [name, pfad] of [
      ['Webapp', `/api/v1/sets/${SN}`],
      ['Android', `/api/v1/sets/${SN}`],
    ]) {
      await anlegen(hauptId);
      const r = await fetch(`${baseSub}${pfad}`, { method: 'DELETE', headers: ausweis(name, subId) });
      assert.equal(r.status, 404, `${name}: ein Unterkonto darf rückwärts nicht löschen`);
      const b = await bestand(hauptId);
      assert.equal(b.set, true, `${name}: das Set des Hauptkontos muss unangetastet bleiben`);
      assert.equal(b.teile, 1, `${name}: auch die Teile bleiben`);
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srvHaupt.close(r));
    await new Promise(r => srvSub.close(r));
    await db.pool.end().catch(() => {});
  }
});
