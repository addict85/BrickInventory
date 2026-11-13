/**
 * Die Dienste eines Bereichs lesen und schreiben über den Zugang, mit dem
 * baueDienste() sie gebaut hat, und eine Arbeitseinheit (k.transaktion) gilt
 * ganz oder gar nicht.
 *
 * Gegenproben (13.11.2026):
 *   A  in src/teile/abfragen.ts getPartsStats() wieder über teileBereich() statt k
 *      → rot: „getPartsStats fragt über den übergebenen Zugang“.
 *   B  in src/infra/bereich.ts baueKontext(): transaktion ruft fn mit dem äusseren
 *      Kontext statt in a.db.transaction → rot: „ein Fehler nimmt alles zurück“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const quellen = require('./helpers/sources');
const { zugangOderSkip } = require('./helpers/db');
const { haeltTeil } = require('./helpers/bestand');

const _req = quellen.buildAndRequire();
const testZugang = () => quellen.testZugang();
test.after(() => testZugang().pool.end());

/** Ein Zugang, der seine Abfragen zählt; sonst derselbe wie der des Tests. */
function zaehlend(z) {
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
  if (!(await zugangOderSkip(t, _req))) return;
  const { baueDienste } = _req('startup/verdrahtung.js');
  const { OHNE_NACHARBEIT } = _req('src/auftraege/nacharbeit.js');
  // Testdaten als Eigentümerin (am Zeilenschutz vorbei), der Dienst fragt als Laufzeitrolle.
  const eigen = quellen.testDaten();
  const { imNamenVon } = _req('src/infra/kontoKontext.js');
  const db = testZugang();
  const name = `kontext_${process.pid}`;
  await eigen.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await eigen.get("INSERT INTO users (username, password_hash, email_verified) VALUES ($1, 'x', true) RETURNING id", [
      name,
    ])
  ).id;
  t.after(() => eigen.run('DELETE FROM users WHERE id = $1', [uid]));
  await haeltTeil(eigen, uid, '3001', { menge: 4 });

  const { zaehler, zugang } = zaehlend(db);
  const d = baueDienste(zugang, OHNE_NACHARBEIT);
  const stats = await imNamenVon({ session: { userId: uid } }, () => d.teile.getPartsStats(uid));
  assert.equal(Number(stats.unique_parts), 1, 'das angelegte Teil kommt an');
  assert.ok(zaehler.n > 0, 'getPartsStats fragt über den übergebenen Zugang');
});

test('k.transaktion: was über t geschrieben wird, gilt zusammen oder gar nicht', async t => {
  if (!(await zugangOderSkip(t, _req))) return;
  const { baueDienste } = _req('startup/verdrahtung.js');
  const { OHNE_NACHARBEIT } = _req('src/auftraege/nacharbeit.js');
  const e = baueDienste(testZugang(), OHNE_NACHARBEIT).einstellungen;
  const A = `kontext_a_${process.pid}`;
  const B = `kontext_b_${process.pid}`;
  t.after(() => e.repository.loescheGlobaleWerte([A, B]));

  await assert.rejects(
    e.transaktion(async tx => {
      await tx.repository.schreibeGlobalenWert(A, 'eins');
      assert.equal(await tx.repository.globalerWert(A), 'eins', 'innen sichtbar');
      await tx.repository.schreibeGlobalenWert(B, 'zwei');
      throw new Error('Abbruch');
    }),
    /Abbruch/,
  );
  assert.deepEqual(
    [await e.repository.globalerWert(A), await e.repository.globalerWert(B)],
    [null, null],
    'ein Fehler nimmt alles zurück',
  );

  await e.transaktion(async tx => {
    await tx.repository.schreibeGlobalenWert(A, 'eins');
    await tx.repository.schreibeGlobalenWert(B, 'zwei');
  });
  assert.deepEqual([await e.repository.globalerWert(A), await e.repository.globalerWert(B)], ['eins', 'zwei']);
});
