/**
 * Währungswechsel stösst den Preis-Job an — gegen echte Routen und Tabelle.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Der Preis-Cache ist über set_number + condition + currency_code
 * verschlüsselt. Nach einem Währungswechsel ist deshalb JEDER Cache-Zugriff
 * ein Fehlschlag, und die Bewertung versucht je Set einen Live-Abruf bei
 * BrickLink — im Anfragepfad. Das Lastprofil (Nachtrag 27b) hat es gemessen:
 * 21 Sekunden statt 53 Millisekunden für den Finanzreiter.
 *
 * Seit Nachtrag 28 stösst eine ECHTE Währungsänderung den Preis-Job an, der
 * den Cache im Hintergrund für die neue Währung füllt. Die Regel liegt in
 * setUserSetting() (utils/settings.ts) — der EINEN Schreibstelle für
 * Benutzereinstellungen — und gilt damit für alle drei Wege: Webapp-Formular,
 * Einstellungs-Import und /api/v1.
 *
 * Geprüft wird VERHALTEN, nicht Wortlaut — über die Wirkung des echten
 * triggerNow(): Mit Fake-Zugangsdaten und leerer sets-Tabelle endet der Lauf
 * gefahrlos im "No sets"-Zweig und setzt state.lastRun (getJobStatus()).
 * Ein Monkeypatch auf priceJob.triggerNow funktioniert NICHT — esbuild
 * exportiert per Getter, die Zuweisung verpufft still. Erwartung:
 *   • Währung EUR → CHF        : genau EIN Anstoss
 *   • dieselbe Währung nochmal : KEIN Anstoss (das Formular schickt bei jedem
 *     Speichern alle Felder — jedes Speichern dürfte sonst einen Lauf kosten)
 *   • v1-Route                 : gleiches Verhalten (Parität)
 *
 * Gegenprobe (durchgeführt): den Anstoss in setUserSetting() entfernt →
 * die beiden „stösst an"-Schritte hier werden rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
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

test('eine echte Währungsänderung stösst den Preis-Job an, ein No-op-Speichern nicht',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Beobachtet wird die WIRKUNG des Jobs, nicht ein Monkeypatch: esbuild
  // exportiert per Getter, eine Zuweisung auf priceJob.triggerNow verpufft
  // still (erster Anlauf dieses Tests — der Zähler blieb bei 0, obwohl der
  // Anstoss lief). Stattdessen: Fake-Zugangsdaten, damit runPriceRefresh()
  // nicht am Credentials-Check abbricht, und eine LEERE sets-Tabelle, damit
  // er ohne Netzzugriff im "No sets"-Zweig endet — der setzt state.lastRun,
  // ablesbar über getJobStatus(). Ein Anstoss = lastRun ändert sich.
  const priceJob = _req('jobs/priceJob.js');
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('bricklink_consumer_key','test-nur-fuer-diesen-test')
                ON CONFLICT (key) DO UPDATE SET value='test-nur-fuer-diesen-test'`);
  // MUSS leer sein: Mit Sets im Bestand nimmt runPriceRefresh() den langen Weg
  // und versucht echte BrickLink-Abrufe — in der vollständigen Suite (wo
  // andere Testdateien Sets hinterlassen) lief diese Datei dadurch in den
  // 60-s-Timeout des Runners, einzeln aber grün. Testreihenfolge ist keine
  // Voraussetzung, auf die man sich verlassen darf.
  await db.run(`DELETE FROM sets`);

  const lastRun = () => priceJob.getJobStatus().lastRun;
  const warteAufLauf = async (vorher) => {
    for (let i = 0; i < 100; i++) {
      if (lastRun() !== vorher) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  };

  const USERNAME = 'currencytest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',0,1)`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username = $1`, [USERNAME])).id;
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','EUR')
     ON CONFLICT (user_id, key) DO UPDATE SET value='EUR'`, [uid]);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid, username: USERNAME, isAdmin: false },
    apiNutzer: { user_id: uid },
    routen: { '/api/settings': 'routes/settings.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  const postWeb = (body) => fetch(`${base}/api/settings/`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  try {
    // 1) Echte Änderung über die Webapp-Route → ein Lauf (lastRun ändert sich).
    let vorher = lastRun();
    let r = await postWeb({ currency: 'CHF' });
    assert.equal(r.status, 200);
    assert.ok(await warteAufLauf(vorher), 'EUR → CHF muss den Preis-Job anstossen');
    assert.equal((await db.get(
      `SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'`, [uid])).value, 'CHF');

    // 2) Dieselbe Währung nochmal (Formular schickt immer alle Felder) → kein Lauf.
    vorher = lastRun();
    r = await postWeb({ currency: 'CHF', language: 'de' });
    assert.equal(r.status, 200);
    await new Promise(res => setTimeout(res, 700));
    assert.equal(lastRun(), vorher, 'ein Speichern OHNE Währungsänderung darf keinen Lauf kosten');

    // 3) Parität: dieselbe Regel auf der v1-Route.
    r = await fetch(`${base}/api/v1/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'EUR' }),
    });
    assert.equal(r.status, 200, `v1-Settings-Route antwortete ${r.status}`);
    assert.ok(await warteAufLauf(vorher), 'CHF → EUR über /api/v1 muss den Preis-Job ebenfalls anstossen');
  } finally {
    // Der "No sets"-Zweig ruft scheduleNext() — ohne stop() hielte der
    // gestellte Intervall-Timer den Testprozess bis zu 60 Minuten am Leben.
    priceJob.stop();
    await db.run(`DELETE FROM global_settings WHERE key='bricklink_consumer_key' AND value='test-nur-fuer-diesen-test'`);
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
