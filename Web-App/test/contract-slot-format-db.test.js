/**
 * Der Vertrag ist die einzige Eingabeprüfung und liefert das Fachformat: Was er annimmt,
 * nimmt die Route an, so wie er es umgeformt hat (src/contract/base.ts, z.transform).
 * Geprüft über die echten Routen gegen die Datenbank.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  ZUSTAND ohne `.transform(v => v.toUpperCase() …)` → rot: „klein geschriebener Zustand
 *      gilt wie gross“ (400 statt 200: 'n' geht unverändert durch und hält den Antwortvertrag nicht)
 *   B  KENNUNG ohne `.transform(Number)` → `npm run typecheck` rot (settings.ts, parts.ts:
 *      string | number ist keine Zahl); die Dienste lesen Text wie Zahl, der Lauf sähe es nicht.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('der Vertrag liefert der Route das Fachformat', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const namen = [`fachformat_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  const [a] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const basis = testServer(_req, { sitzung: { userId: a }, t }).base;
  const rufe = async (methode, pfad, rumpf) => {
    const r = await fetch(`${basis}/api/v1${pfad}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      ...(rumpf ? { body: JSON.stringify(rumpf) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('klein geschriebener Zustand gilt wie gross', async () => {
    const r = await rufe('POST', '/settings/user/default-condition', { condition: 'n' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.condition, 'N');
    assert.equal((await rufe('GET', '/settings/user/default-condition')).body.condition, 'N');
    const u = await rufe('POST', '/settings/user/default-condition', { condition: 'u' });
    assert.equal(u.body.condition, 'U');
    // Was der Vertrag nicht kennt, weist er ab; die Route sieht es nie.
    assert.equal((await rufe('POST', '/settings/user/default-condition', { condition: 'x' })).status, 400);
  });
});
