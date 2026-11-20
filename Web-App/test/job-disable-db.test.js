/**
 * Ein Arbeiter, der beim Abschalten gerade einen Auftrag belegt, gibt ihn
 * zurück: stoppe() waiting auf die laufende Belegung, und was danach noch
 * ankommt, wird nicht mehr ausgeführt, sondern freigegeben.
 *
 * Die Zeitfolge wird erzwungen: Eine Sperre auf der Tabelle hält die
 * Belegung (UPDATE … RETURNING) an, während stoppe() aufgerufen wird.
 *
 * Gegenprobe (01.11.2026 gemessen): in pumpe() die Prüfung `if (beendet)`
 * nach der Belegung und das Warten auf pumpLauf in stoppe() entfernt → rot:
 * „der Auftrag bleibt nicht belegt“ (status 'laeuft', der Bearbeiter lief an).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte } = require('./helpers/time');

test('Abschalten während einer Belegung', async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const A = { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').auftraege };
  const { createWorker } = _req('jobs/jobWorker.js');
  const ART = `abschalten-${process.pid}`;
  const MARKE = `abschalten-${process.pid}`;
  // Eine Testart braucht wie jede andere ein Schema für ihre Nutzlast.
  require('./helpers/sources')
    .testServices()
    .jobQueue.reportKindAn({ art: ART, nutzlast: require('zod').looseObject({}), ausfuehren: async () => {} });
  await db.run('INSERT INTO job_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [ART]);
  const sperre = await db.pool.connect();
  let loslassen = () => {};
  const haengt = new Promise(r => {
    loslassen = () => r(null);
  });
  t.after(async () => {
    loslassen();
    await sperre.query('ROLLBACK').catch(() => {});
    sperre.release();
    await db.run(`DELETE FROM jobs WHERE payload->>'marke' = $1`, [MARKE]).catch(() => {});
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const id = await A.placeJobOne(ART, { marke: MARKE });
  let started = false;
  // Hängt bis zum Testende: Ein angelaufener Auftrag bliebe so auf 'laeuft'.
  const w = createWorker(
    require('./helpers/sources').testServices().jobQueue,
    {
      [ART]: {
        ausfuehren: () => {
          started = true;
          return haengt;
        },
      },
    },
    { deadlineSec: 600, taktMs: 60_000 },
  );

  await sperre.query('BEGIN');
  await sperre.query('LOCK TABLE jobs IN SHARE MODE');
  w.starte();
  // Die Belegung steht jetzt in der Sperre.
  for (let i = 0; i < 50; i++) {
    const r = await db.get(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                             WHERE c.relname = 'jobs' AND NOT l.granted
                               AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    if (r.n > 0) break;
    await warte(20);
  }
  const stopped = w.stop(3000);
  await warte(200);
  await sperre.query('COMMIT');
  await stopped;
  await warte(300);

  const z = await db.get('SELECT status FROM jobs WHERE id = $1', [id]);
  assert.equal(started, false, 'nach stoppe() läuft kein Bearbeiter mehr an');
  assert.notEqual(z.status, 'laeuft', 'der Auftrag bleibt nicht belegt');
});
