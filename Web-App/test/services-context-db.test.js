/**
 * The services of an area read and write via the access with which
 * buildServices() built them, and a unit of work (k.transact) applies
 * entirely or not at all.
 *
 * Counter-checks (13.11.2026):
 *   A  in src/parts/queries.ts partStatsQuery() again via teileBereich() instead of k
 *      → red: „partStatsQuery fragt über den übergebenen Zugang“.
 *   B  in src/infra/area.ts buildContext(): transaktion calls fn with the outer
 *      context instead of in a.db.transaction → red: „ein Fehler nimmt alles zurück“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const sources = require('./helpers/sources');
const { accessOrSkip } = require('./helpers/db');
const { holdsPart } = require('./helpers/inventory');

const _req = sources.buildAndRequire();
const testAccess = () => sources.testAccess();
test.after(() => testAccess().pool.end());

/** An access that counts its queries; otherwise the same as the test's. */
function counting(z) {
  const zaehler = { n: 0 };
  const mit =
    f =>
    (...a) => {
      zaehler.n++;
      return f(...a);
    };
  return { zaehler, zugang: { ...z, all: mit(z.all), get: mit(z.get), run: mit(z.run), exec: mit(z.exec) } };
}

test('services take the access from their context, not from the process', async t => {
  if (!(await accessOrSkip(t, _req))) return;
  const { buildServices } = _req('startup/wiring.js');
  // Test data as the owner role (bypassing row security), the service asks as the runtime role.
  const eigen = sources.testData();
  const { asRequest } = _req('src/infra/accountContext.js');
  const db = testAccess();
  const name = `kontext_${process.pid}`;
  await eigen.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await eigen.get("INSERT INTO users (username, password_hash, email_verified) VALUES ($1, 'x', true) RETURNING id", [
      name,
    ])
  ).id;
  t.after(() => eigen.run('DELETE FROM users WHERE id = $1', [uid]));
  await holdsPart(eigen, uid, '3001', { quantity: 4 });

  const { zaehler, zugang } = counting(db);
  const d = buildServices(zugang);
  const stats = await asRequest({ session: { userId: uid } }, () => d.parts.partStats(uid));
  assert.equal(Number(stats.unique_parts), 1, 'das angelegte Teil kommt an');
  assert.ok(zaehler.n > 0, 'partStatsQuery fragt über den übergebenen Zugang');
});

test('k.transact: what is written via t applies together or not at all', async t => {
  if (!(await accessOrSkip(t, _req))) return;
  const { buildServices } = _req('startup/wiring.js');
  const contexts = {};
  buildServices(testAccess(), { contexts });
  const e = contexts.settings;
  // Only the system role writes global values (0117): the transaction in its context.
  const { inSystemContext } = _req('src/infra/accountContext.js');
  const imSystem = f => inSystemContext('test', f);
  const A = `kontext_a_${process.pid}`;
  const B = `kontext_b_${process.pid}`;
  t.after(() => imSystem(() => e.repository.deleteGlobalValues([A, B])));

  await assert.rejects(
    imSystem(() =>
      e.transact(async tx => {
        await tx.repository.writeGlobalValue(A, 'eins');
        assert.equal(await tx.repository.globalValue(A), 'eins', 'innen sichtbar');
        await tx.repository.writeGlobalValue(B, 'zwei');
        throw new Error('Abbruch');
      }),
    ),
    /Abbruch/,
  );
  assert.deepEqual(
    [await e.repository.globalValue(A), await e.repository.globalValue(B)],
    [null, null],
    'ein Fehler nimmt alles zurück',
  );

  await imSystem(() =>
    e.transact(async tx => {
      await tx.repository.writeGlobalValue(A, 'eins');
      await tx.repository.writeGlobalValue(B, 'zwei');
    }),
  );
  assert.deepEqual([await e.repository.globalValue(A), await e.repository.globalValue(B)], ['eins', 'zwei']);
});
