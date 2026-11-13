/**
 * Der Preislauf holt je Set genau die Zustände, die das Konto führt oder sich merkt
 * (zustaendeJeSet in src/finanzen/preisLauf.ts).
 *
 * Gegenproben (09.11.2026 gemessen):
 *   A  in zustaendeJeSet() die Merkliste nicht mehr gelesen → rot: „ein gemerkter Gebrauchtzustand zählt mit“
 *   B  ergebnis.set(sn, ['N', 'U']) für jedes Set → rot: „ein reines Set kostet nur einen Abruf“
 *   C  den Hinweis beim Erfassen übergangen → rot: „der Zustand einer noch nicht geschriebenen Erfassung zählt“
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
const { dbOderSkip } = require('./helpers/db');

test('Zustände je Set für den Preislauf', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [`preislauf_${process.pid}`],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end();
  });
  const [GEMISCHT, REIN, GEMERKT, FREMD] = ['91001-1', '91002-1', '91003-1', '91004-1'];
  for (const sn of [GEMISCHT, REIN, GEMERKT]) await katalogSet(db, sn, { name: 'Probe' });
  const { recordAcquisition } = _req('src/sets/index.js');
  for (const [sn, z] of [
    [GEMISCHT, 'N'],
    [GEMISCHT, 'U'],
    [REIN, 'U'],
  ]) {
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, sn]);
    await recordAcquisition({ konto: uid, setNumber: sn, menge: 1, kaufpreis: 10, zustand: z });
  }
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, $2, 'U')`, [uid, GEMERKT]);
  const { zustaendeJeSet, conditionsNeededFor } = _req('src/finanzen/preisLauf.js');
  const sortiert = m => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]));

  const z = sortiert(await zustaendeJeSet(uid, [GEMISCHT, REIN, GEMERKT, FREMD]));

  await t.test('ein gemischtes Set braucht beide Preise', () => assert.deepEqual(z[GEMISCHT], ['N', 'U']));
  await t.test('ein reines Set kostet nur einen Abruf', () => assert.deepEqual(z[REIN], ['U']));
  await t.test('ein gemerkter Gebrauchtzustand zählt mit', () => assert.deepEqual(z[GEMERKT], ['U']));
  await t.test('ohne Erfassung und Merkposten gilt Neu', () => assert.deepEqual(z[FREMD], ['N']));
  await t.test('der Zustand einer noch nicht geschriebenen Erfassung zählt', async () => {
    assert.deepEqual((await conditionsNeededFor(REIN, uid, 'N')).sort(), ['N', 'U']);
  });
});
