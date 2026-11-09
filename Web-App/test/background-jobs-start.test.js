/**
 * Der Start des Job-Prozesses trägt jede Hintergrundarbeit als Auftrag ein.
 * Ausführlich: docs/begruendungen/test/background-jobs-start.test.js.md#kopf
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in starteJobs() `ziehePlanVor('csv_sync', …)` entfernt → rot: „jede
 *      geplante Art hat einen Termin“ (der Katalog stand erst um 03:00 an).
 *      `planeAlle()` allein zu entfernen bleibt grün: Heute zieht der Start
 *      jede geplante Art vor und legt sie dabei an; planeAlle() deckt eine
 *      künftige Art ab, die nicht vorgezogen wird.
 *   B  in starteJobs() die Schleife über NACHLAEUFE entfernt → rot: „jeder
 *      Nachlauf ist einmal eingestellt“
 *   C  starteAuftragsWorker() aus starteJobs() entfernt → rot: „der Worker läuft an“
 *   D  (05.11.2026) das Lebenszeichen ohne Blick auf den Worker geschrieben →
 *      rot: „das Lebenszeichen folgt dem Worker“ (es kam auch ohne Worker)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let workerGestartet = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /jobs[/\\]auftraegeStarten(\.js)?$/.test(name))
    return { ...m, starteAuftragsWorker: () => { workerGestartet++; return { letzteRunde: () => Date.now() }; },
      stoppeAuftragsWorker: async () => {} };
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { warte } = require('./helpers/zeit');

test('der Start des Job-Prozesses stellt alles als Auftrag ein', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  t.after(async () => {
    await _req('startup/jobsProzess.js').stoppeJobs();
    await _req('db/pgNotify.js').close().catch(() => {});
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  });
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await db.run('DELETE FROM auftraege');
  await _req('startup/jobsProzess.js').starteJobs(true);

  const zeilen = await db.all(`SELECT art, schluessel, nutzlast, EXTRACT(EPOCH FROM faellig_ab - NOW())::int AS in_sek
                                 FROM auftraege WHERE status = 'offen'`);
  const plan = (art) => zeilen.find(z => z.schluessel === `plan:${art}`);

  await t.test('jede geplante Art hat einen Termin', () => {
    for (const art of Object.keys(_req('src/auftraege/zeitplan.js').ZEITPLAENE))
      assert.ok(plan(art), `kein Termin für ${art}; da sind: ${zeilen.map(z => z.schluessel).join(', ')}`);
    assert.ok(plan('csv_sync').in_sek <= 0 && plan('csv_sync').nutzlast.beimStart, 'der Katalog wird beim Start sofort geprüft');
    assert.ok(plan('preise').in_sek <= 30, 'der Preis-Job läuft 30 s nach dem Start');
    assert.ok(zeilen.some(z => z.art === 'wechselkurse'), 'kein Wechselkurs-Auftrag');
  });

  await t.test('jeder Nachlauf ist einmal eingestellt', async () => {
    const { NACHLAEUFE } = _req('src/verwaltung/startNachlaeufe.js');
    for (const schritt of Object.keys(NACHLAEUFE))
      assert.ok(zeilen.some(z => z.schluessel === `nachlauf:${schritt}`), `Nachlauf ${schritt} fehlt`);
    await _req('startup/jobsProzess.js').starteJobs(true);
    const doppelt = await db.get(`SELECT COUNT(*)::int AS n FROM auftraege WHERE status = 'offen'
                                    GROUP BY schluessel HAVING COUNT(*) > 1 LIMIT 1`);
    assert.equal(doppelt, undefined, 'ein zweiter Start legt Termine doppelt an');
  });

  await t.test('der Worker läuft an', () => {
    assert.ok(workerGestartet >= 1);
  });

  await t.test('das Lebenszeichen folgt dem Worker', async () => {
    const jp = _req('startup/jobsProzess.js');
    const { liesZustand, loescheZustand } = _req('src/auftraege/laufzustand.js');
    for (let i = 0; i < 50 && !await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL); i++) await warte(20);
    assert.ok(await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL), 'nach dem Start fehlt das Lebenszeichen');
    await jp.stoppeJobs();
    await loescheZustand(jp.LEBENSZEICHEN_SCHLUESSEL);
    jp.erneuereLebenszeichen();
    await warte(200);
    assert.equal(await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL), null, 'ohne Worker kein Lebenszeichen');
  });
});
