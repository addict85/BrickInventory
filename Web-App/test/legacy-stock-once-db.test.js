/**
 * Die Umschlüsselung des Altbestands läuft einmal je Datenbank, nicht bei
 * jedem Start: Danach steht eine Marke im Laufzustand. Fehlt sie (frische
 * Datenbank, zurückgespielte ältere Sicherung), läuft sie wieder.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  die Abfrage der Marke in legacyStockUpgrade(require('./helpers/sources').testServices()) gestrichen → rot:
 *      „der zweite Start lässt den Altbestand in Ruhe“
 *   B  setzeZustand(LEGACY_STOCK_BRAND, …) gestrichen → rot: „der erste Start
 *      rüstet auf und setzt die Marke“ und „der zweite Start …“
 *
 * Dass die Umschlüsselung selbst wirkt, zeigen geheimnis-kontext-db und
 * gutscheinnummer-verschluesselt-db auf frischer Datenbank.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('legacy data once per database', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { legacyStockUpgrade, LEGACY_STOCK_BRAND } = _req('startup/database.js');
  const { liesZustand, deleteState } = require('./helpers/sources').testArea('jobQueue').laufzustand;
  await deleteState(LEGACY_STOCK_BRAND);

  await t.test('the first start upgrades and sets the marker', async () => {
    const r = await legacyStockUpgrade(require('./helpers/sources').testServices());
    assert.ok(r && typeof r.umgeschluesselt === 'number', JSON.stringify(r));
    assert.ok(await liesZustand(LEGACY_STOCK_BRAND));
  });

  await t.test('the second start leaves the legacy data alone', async () => {
    assert.equal(await legacyStockUpgrade(require('./helpers/sources').testServices()), null);
  });

  await t.test('without the marker (older backup restored) it runs again', async () => {
    await deleteState(LEGACY_STOCK_BRAND);
    assert.notEqual(await legacyStockUpgrade(require('./helpers/sources').testServices()), null);
  });
});
