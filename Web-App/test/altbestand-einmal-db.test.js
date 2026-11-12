/**
 * Die Umschlüsselung des Altbestands läuft einmal je Datenbank, nicht bei
 * jedem Start: Danach steht eine Marke im Laufzustand. Fehlt sie (frische
 * Datenbank, zurückgespielte ältere Sicherung), läuft sie wieder.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  die Abfrage der Marke in altbestandAufruesten() gestrichen → rot:
 *      „der zweite Start lässt den Altbestand in Ruhe“
 *   B  setzeZustand(ALTBESTAND_MARKE, …) gestrichen → rot: „der erste Start
 *      rüstet auf und setzt die Marke“ und „der zweite Start …“
 *
 * Dass die Umschlüsselung selbst wirkt, zeigen geheimnis-kontext-db und
 * gutscheinnummer-verschluesselt-db auf frischer Datenbank.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');

test('Altbestand einmal je Datenbank', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { altbestandAufruesten, ALTBESTAND_MARKE } = _req('startup/datenbank.js');
  const { liesZustand, loescheZustand } = _req('src/auftraege/prozess.js').auftraegeBereich().laufzustand;
  await loescheZustand(ALTBESTAND_MARKE);

  await t.test('der erste Start rüstet auf und setzt die Marke', async () => {
    const r = await altbestandAufruesten();
    assert.ok(r && typeof r.umgeschluesselt === 'number', JSON.stringify(r));
    assert.ok(await liesZustand(ALTBESTAND_MARKE));
  });

  await t.test('der zweite Start lässt den Altbestand in Ruhe', async () => {
    assert.equal(await altbestandAufruesten(), null);
  });

  await t.test('ohne Marke (ältere Sicherung zurückgespielt) läuft es wieder', async () => {
    await loescheZustand(ALTBESTAND_MARKE);
    assert.notEqual(await altbestandAufruesten(), null);
  });
});
