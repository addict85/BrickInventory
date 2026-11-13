/**
 * Ein Arbeiter, der beim Abschalten gerade einen Auftrag belegt, gibt ihn
 * zurück: stoppe() wartet auf die laufende Belegung, und was danach noch
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

const { buildAndRequire, testDaten, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { warte } = require('./helpers/zeit');

test('Abschalten während einer Belegung', async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const A = { ..._req('src/auftraege/dienst.js'), ...require('./helpers/sources').testBereich('auftraege').auftraege };
  const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
  const ART = `abschalten-${process.pid}`;
  const MARKE = `abschalten-${process.pid}`;
  // Eine Testart braucht wie jede andere ein Schema für ihre Nutzlast.
  _req('src/auftraege/nutzlasten.js').NUTZLASTEN[ART] = require('zod').looseObject({});
  await db.run('INSERT INTO auftrags_arten (art) VALUES ($1) ON CONFLICT DO NOTHING', [ART]);
  const sperre = await db.pool.connect();
  let loslassen = () => {};
  const haengt = new Promise(r => {
    loslassen = r;
  });
  t.after(async () => {
    loslassen();
    await sperre.query('ROLLBACK').catch(() => {});
    sperre.release();
    await db.run(`DELETE FROM auftraege WHERE nutzlast->>'marke' = $1`, [MARKE]).catch(() => {});
    await testZugang()
      .benachrichtigung.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const id = await A.stelleAuftragEin(ART, { marke: MARKE });
  let angefangen = false;
  // Hängt bis zum Testende: Ein angelaufener Auftrag bliebe so auf 'laeuft'.
  const w = erzeugeWorker(
    require('./helpers/sources').testDienste().auftraege,
    {
      [ART]: {
        ausfuehren: () => {
          angefangen = true;
          return haengt;
        },
      },
    },
    { fristSek: 600, taktMs: 60_000 },
  );

  await sperre.query('BEGIN');
  await sperre.query('LOCK TABLE auftraege IN SHARE MODE');
  w.starte();
  // Die Belegung steht jetzt in der Sperre.
  for (let i = 0; i < 50; i++) {
    const r = await db.get(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                             WHERE c.relname = 'auftraege' AND NOT l.granted
                               AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    if (r.n > 0) break;
    await warte(20);
  }
  const gestoppt = w.stoppe(3000);
  await warte(200);
  await sperre.query('COMMIT');
  await gestoppt;
  await warte(300);

  const z = await db.get('SELECT status FROM auftraege WHERE id = $1', [id]);
  assert.equal(angefangen, false, 'nach stoppe() läuft kein Bearbeiter mehr an');
  assert.notEqual(z.status, 'laeuft', 'der Auftrag bleibt nicht belegt');
});
