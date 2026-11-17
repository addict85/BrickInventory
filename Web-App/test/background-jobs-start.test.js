/**
 * Der Start des Job-Prozesses trägt jede Hintergrundarbeit als Auftrag ein.
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
Module.prototype.require = function (name, ...rest) {
  const m = echtesRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /jobs[/\\]auftraegeStarten(\.js)?$/.test(name))
    return {
      ...m,
      starteAuftragsWorker: () => {
        workerGestartet++;
        return { letzteRunde: () => Date.now(), stoppe: async () => {} };
      },
    };
  return m;
};

const { buildAndRequire, testDaten, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { warte } = require('./helpers/zeit');

test('der Start des Job-Prozesses stellt alles als Auftrag ein', { concurrency: 1 }, async t => {
  const db = testDaten();
  /** Was starteJobs zurückgibt: Der Test hält es wie server.ts. */
  const laeufe = [];
  t.after(async () => {
    for (const lauf of laeufe)
      await _req('startup/jobsProzess.js').stoppeJobs(require('./helpers/sources').testDienste(), lauf);
    await testZugang()
      .benachrichtigung.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  });
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DELETE FROM jobs');
  laeufe.push(await _req('startup/jobsProzess.js').starteJobs(require('./helpers/sources').testDienste()));

  const zeilen = await db.all(`SELECT type, dedupe_key, payload, EXTRACT(EPOCH FROM due_at - NOW())::int AS in_sek
                                 FROM jobs WHERE status = 'offen'`);
  const plan = type => zeilen.find(z => z.dedupe_key === `plan:${type}`);

  await t.test('jede geplante Art hat einen Termin', () => {
    for (const { art } of require('./helpers/sources')
      .testDienste()
      .auftraege.angemeldeteArten()
      .filter(a => a.zeitplan))
      assert.ok(plan(art), `kein Termin für ${art}; da sind: ${zeilen.map(z => z.dedupe_key).join(', ')}`);
    assert.ok(
      plan('csv_sync').in_sek <= 0 && plan('csv_sync').payload.beimStart,
      'der Katalog wird beim Start sofort geprüft',
    );
    assert.ok(plan('preise').in_sek <= 30, 'der Preis-Job läuft 30 s nach dem Start');
    assert.ok(
      zeilen.some(z => z.type === 'wechselkurse'),
      'kein Wechselkurs-Auftrag',
    );
  });

  await t.test('jeder Nachlauf ist einmal eingestellt', async () => {
    const { NACHLAEUFE } = _req('src/verwaltung/startNachlaeufe.js');
    for (const schritt of Object.keys(NACHLAEUFE))
      assert.ok(
        zeilen.some(z => z.dedupe_key === `nachlauf:${schritt}`),
        `Nachlauf ${schritt} fehlt`,
      );
    laeufe.push(await _req('startup/jobsProzess.js').starteJobs(require('./helpers/sources').testDienste()));
    const doppelt = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE status = 'offen'
                                    GROUP BY dedupe_key HAVING COUNT(*) > 1 LIMIT 1`);
    assert.equal(doppelt, undefined, 'ein zweiter Start legt Termine doppelt an');
  });

  await t.test('der Worker läuft an', () => {
    assert.ok(workerGestartet >= 1);
  });

  await t.test('das Lebenszeichen folgt dem Worker', async () => {
    const jp = _req('startup/jobsProzess.js');
    const { liesZustand, loescheZustand } = require('./helpers/sources').testBereich('auftraege').laufzustand;
    for (let i = 0; i < 50 && !(await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL)); i++) await warte(20);
    assert.ok(await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL), 'nach dem Start fehlt das Lebenszeichen');
    for (const lauf of laeufe) await jp.stoppeJobs(require('./helpers/sources').testDienste(), lauf);
    await loescheZustand(jp.LEBENSZEICHEN_SCHLUESSEL);
    await jp.erneuereLebenszeichen(require('./helpers/sources').testDienste(), laeufe[0].worker);
    assert.equal(await liesZustand(jp.LEBENSZEICHEN_SCHLUESSEL), null, 'ohne Worker kein Lebenszeichen');
  });
});
