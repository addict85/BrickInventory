/**
 * Googles Widerrufsliste kommt als geplanter Auftrag in laufzustand; der Abruf ist
 * über die Fremdquellen gestellt (testQuellen), kein Netz. Eine unlesbare Antwort
 * oder ein Netzfehler lässt die letzte gute Liste stehen.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  in jobs/auftraegeStarten.ts den Bearbeiter `widerrufsliste` umbenannt → rot:
 *      „der geplante Auftrag legt die Liste ab …“ und „eine unlesbare Antwort …“
 *   B  in ladeWiderrufsliste() (src/katalog) erst den Rohtext speichern, dann lesen → rot: „eine
 *      unlesbare Antwort …“ (und „der geplante Auftrag …“: keine Seriennummern)
 *   C  ZEITPLAENE.widerrufsliste entfernt → rot: „… und plant den nächsten Lauf“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testQuellen, testDienste, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const db = testDaten();

const AUSZUG = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-auszug.json'));
const gespeichert = async () => {
  const z = await db.get("SELECT wert FROM laufzustand WHERE schluessel = 'attestation_widerruf'");
  return z ? JSON.parse(z.wert) : null;
};

test('Widerrufsliste als Auftrag', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  t.after(async () => {
    await testZugang().benachrichtigung.close();
    await db.pool.end().catch(() => {});
  });
  await db.run("DELETE FROM laufzustand WHERE schluessel = 'attestation_widerruf'");
  await db.run("DELETE FROM auftraege WHERE art = 'widerrufsliste'");
  let antwort = async () => AUSZUG;
  const abrufe = [];
  testQuellen(t, {
    widerrufslisteAbruf: async signal => {
      abrufe.push(signal);
      return antwort();
    },
  });
  const d = testDienste();

  await t.test('der geplante Auftrag legt die Liste ab und plant den nächsten Lauf', async () => {
    await d.auftraege.ziehePlanVor('widerrufsliste', 0);
    const worker = _req('jobs/auftraegeStarten.js').starteAuftragsWorker(d, { arten: ['widerrufsliste'], taktMs: 50 });
    try {
      await bis(async () => (await gespeichert()) !== null, 10_000);
    } finally {
      await worker.stoppe(0);
    }
    const l = await gespeichert();
    assert.equal(l.nummern.length, 5);
    assert.ok(l.nummern.includes('c35747a084470c3135aeefe2b8d40cd6'));
    assert.ok(Math.abs(Date.now() - new Date(l.stand).getTime()) < 60_000);
    assert.ok(abrufe[0] instanceof AbortSignal, 'Der Abruf bekommt das Signal des Auftrags');
    const planZeile = () =>
      db.get(
        `SELECT EXTRACT(EPOCH FROM faellig_ab - NOW())::int AS in_sek FROM auftraege
          WHERE schluessel = 'plan:widerrufsliste' AND status = 'offen'`,
      );
    await bis(async () => (await planZeile())?.in_sek > 60, 5000);
    const plan = await planZeile();
    assert.ok(plan?.in_sek > 5 * 3600 && plan.in_sek <= 6 * 3600, `nächster Lauf in ${plan?.in_sek} s`);
  });

  await t.test('eine unlesbare Antwort oder ein Netzfehler lässt die letzte gute Liste stehen', async () => {
    const vorher = await gespeichert();
    const lauf = () =>
      _req('jobs/auftraegeStarten.js')
        .bearbeiter(d)
        .widerrufsliste.ausfuehren({}, { signal: new AbortController().signal });
    for (const kaputt of ['<html>Wartung</html>', '{"entries": {"zz": {"status": "REVOKED"}}}', '{}']) {
      antwort = async () => Buffer.from(kaputt);
      await assert.rejects(lauf(), kaputt);
      assert.deepEqual(await gespeichert(), vorher, kaputt);
    }
    antwort = async () => {
      throw new Error('ECONNRESET');
    };
    await assert.rejects(lauf(), /ECONNRESET/);
    assert.deepEqual(await gespeichert(), vorher);
  });
});
