/**
 * Das Haushaltsgedächtnis und seine Abhängigen gehören einem Satz Dienste: Ein
 * neuer Satz hängt nichts an eine Liste des Prozesses, und ein anderer Satz
 * (wie ein zweiter Prozess) erfährt eine Änderung über NOTIFY.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  atHouseholdChange() wieder in eine Liste des Moduls → rot: „ein Satz
 *      leert nur seine Abhängigen“ (der Rückruf des anderen Satzes lief mit)
 *   B  listenOnChanges() ohne Leeren (Rückruf leer) → rot: „ein anderer
 *      Satz erfährt die Änderung über NOTIFY“ (altes Blickfeld)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { createDb, dbKonfigFromEnvironment } = _req('db/database.js');
const { bis } = require('./helpers/time');

test('household changes per set of services', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const db = testData();
  const { buildServices } = _req('startup/wiring.js');
  // Zwei Zugänge wie zwei Prozesse (Web und Jobs).
  const zugaenge = [createDb(dbKonfigFromEnvironment()), createDb(dbKonfigFromEnvironment())];
  const [a, b] = zugaenge.map(z => buildServices(z));
  const namen = [`hhd_h_${process.pid}`, `hhd_u_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    for (const z of zugaenge) {
      await z.notification.close();
      await z.pool.end();
    }
    await db.pool.end().catch(() => {});
  });

  await t.test('a set only clears its dependents', () => {
    const gerufen = [];
    a.household.atHouseholdChange(() => gerufen.push('a'));
    b.household.atHouseholdChange(() => gerufen.push('b'));
    a.household.reportHouseholdChange();
    assert.deepEqual(gerufen, ['a']);
  });

  await t.test('another set learns about the change via NOTIFY', async () => {
    await b.household.listenOnChanges();
    // Unter dem Zeilenschutz des Kontos: Fremde Verknüpfungen sieht die Laufzeitrolle nicht (0121).
    const blickfeld = () => asAccount(ids[0], () => b.household.scopeIds(ids[0]));
    assert.deepEqual(await blickfeld(), [ids[0]]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
    a.household.reportHouseholdChange();
    const neu = async () => (await blickfeld()).length === 2;
    assert.ok(await bis(neu, 3000), 'altes Blickfeld: die Änderung kam nicht an');
  });
});
