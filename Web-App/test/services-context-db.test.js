/**
 * Die Dienste eines Bereichs lesen und schreiben über den Zugang, mit dem
 * buildServices() sie gebaut hat, und eine Arbeitseinheit (k.transaktion) gilt
 * ganz oder gar nicht.
 *
 * Gegenproben (13.11.2026):
 *   A  in src/parts/queries.ts partStatsQuery() wieder über teileBereich() statt k
 *      → rot: „partStatsQuery fragt über den übergebenen Zugang“.
 *   B  in src/infra/area.ts buildContext(): transaktion ruft fn mit dem äusseren
 *      Kontext statt in a.db.transaction → rot: „ein Fehler nimmt alles zurück“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const quellen = require('./helpers/sources');
const { accessOrSkip } = require('./helpers/db');
const { holdsPart } = require('./helpers/bestand');

const _req = quellen.buildAndRequire();
const testAccess = () => quellen.testAccess();
test.after(() => testAccess().pool.end());

/** Ein Zugang, der seine Abfragen zählt; sonst derselbe wie der des Tests. */
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

test('Dienste nehmen den Zugang aus ihrem Kontext, nicht aus dem Prozess', async t => {
  if (!(await accessOrSkip(t, _req))) return;
  const { buildServices } = _req('startup/wiring.js');
  // Testdaten als Eigentümerin (am Zeilenschutz vorbei), der Dienst fragt als Laufzeitrolle.
  const eigen = quellen.testData();
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
  await holdsPart(eigen, uid, '3001', { menge: 4 });

  const { zaehler, zugang } = counting(db);
  const d = buildServices(zugang);
  const stats = await asRequest({ session: { userId: uid } }, () => d.parts.partStats(uid));
  assert.equal(Number(stats.unique_parts), 1, 'das angelegte Teil kommt an');
  assert.ok(zaehler.n > 0, 'partStatsQuery fragt über den übergebenen Zugang');
});

test('k.transaktion: was über t geschrieben wird, gilt zusammen oder gar nicht', async t => {
  if (!(await accessOrSkip(t, _req))) return;
  const { buildServices } = _req('startup/wiring.js');
  const contexts = {};
  buildServices(testAccess(), { contexts });
  const e = contexts.settings;
  // Globale Werte schreibt nur die Systemrolle (0117): die Transaktion in ihrem Rahmen.
  const { inSystemContext } = _req('src/infra/accountContext.js');
  const imSystem = f => inSystemContext('test', f);
  const A = `kontext_a_${process.pid}`;
  const B = `kontext_b_${process.pid}`;
  t.after(() => imSystem(() => e.repository.deleteGlobalValues([A, B])));

  await assert.rejects(
    imSystem(() =>
      e.transaktion(async tx => {
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
    e.transaktion(async tx => {
      await tx.repository.writeGlobalValue(A, 'eins');
      await tx.repository.writeGlobalValue(B, 'zwei');
    }),
  );
  assert.deepEqual([await e.repository.globalValue(A), await e.repository.globalValue(B)], ['eins', 'zwei']);
});
