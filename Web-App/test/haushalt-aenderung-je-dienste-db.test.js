/**
 * Das Haushaltsgedächtnis und seine Abhängigen gehören einem Satz Dienste: Ein
 * neuer Satz hängt nichts an eine Liste des Prozesses, und ein anderer Satz
 * (wie ein zweiter Prozess) erfährt eine Änderung über NOTIFY.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  beiHaushaltsaenderung() wieder in eine Liste des Moduls → rot: „ein Satz
 *      leert nur seine Abhängigen“ (der Rückruf des anderen Satzes lief mit)
 *   B  horcheAufAenderungen() ohne Leeren (Rückruf leer) → rot: „ein anderer
 *      Satz erfährt die Änderung über NOTIFY“ (altes Blickfeld)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { erzeugeDb, dbKonfigAusUmgebung } = _req('db/database.js');
const N = _req('src/auftraege/nacharbeit.js');
const { bis } = require('./helpers/zeit');

test('Haushaltsänderungen je Satz Dienste', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const db = testDaten();
  const { baueDienste } = _req('startup/verdrahtung.js');
  // Zwei Zugänge wie zwei Prozesse (Web und Jobs).
  const zugaenge = [erzeugeDb(dbKonfigAusUmgebung()), erzeugeDb(dbKonfigAusUmgebung())];
  const [a, b] = zugaenge.map(z => baueDienste(z, { nacharbeit: N.OHNE_NACHARBEIT }));
  const namen = [`hhd_h_${process.pid}`, `hhd_u_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    for (const z of zugaenge) {
      await z.benachrichtigung.close();
      await z.pool.end();
    }
    await db.pool.end().catch(() => {});
  });

  await t.test('ein Satz leert nur seine Abhängigen', () => {
    const gerufen = [];
    a.haushalt.beiHaushaltsaenderung(() => gerufen.push('a'));
    b.haushalt.beiHaushaltsaenderung(() => gerufen.push('b'));
    a.haushalt.leereHaushaltCache();
    assert.deepEqual(gerufen, ['a']);
  });

  await t.test('ein anderer Satz erfährt die Änderung über NOTIFY', async () => {
    await b.haushalt.horcheAufAenderungen();
    assert.deepEqual((await b.haushalt.haushaltVon(ids[0])).memberIds, [ids[0]]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
    a.haushalt.meldeHaushaltsaenderung();
    const neu = async () => (await b.haushalt.haushaltVon(ids[0])).memberIds.length === 2;
    assert.ok(await bis(neu, 3000), 'altes Blickfeld: die Änderung kam nicht an');
  });
});
