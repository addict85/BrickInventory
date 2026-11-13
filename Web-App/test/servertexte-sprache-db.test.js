/**
 * Servertexte folgen der Sprache der Anfrage (UI-Prüfung 17, M17): Ein
 * Preisfehler der Bewertung kommt mit Code und in der Sprache des
 * Accept-Language-Kopfs; die Kacheln der Hintergrundarbeiten tragen ihren
 * Untertitel als Codes (`sub_teile`), die die Oberfläche übersetzt. Vorher
 * stand in der englischen Oberfläche „kein BrickLink-Preis gefunden“ und
 * „Keine ausstehenden Einträge“. Echter Server; ohne BrickLink-Zugang
 * scheitert jeder Preis, wie in der Prüfumgebung.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in routes/api_v1/finance.ts `sets: uebersetzt(…)` entfernt → rot:
 *      „Preisfehler auf Englisch“ (deutscher Text)
 *   B  in fetchPrice (src/finanzen/rechnung/preise.ts) wieder throw new
 *      Error(`… — kein BrickLink-Preis gefunden`) → rot: „Preisfehler auf
 *      Englisch“ (kein error_code)
 *   C  sub_teile der Brickset-Kachel entfernt → rot: „Kacheln mit Codes“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');

test('Servertexte in der Sprache der Anfrage', { concurrency: 1 }, async t => {
  const db = testDaten();
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `sprache-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (
    await db.get(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, '10294-1']);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition) VALUES ($1,'10294-1',1,600,'N')`,
    [uid],
  );
  await verwalterMitFaktor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });
  const hole = async (pfad, sprache) =>
    (await fetch(`${base}/api/v1/${pfad}`, { headers: { 'Accept-Language': sprache } })).json();

  await t.test('Preisfehler auf Englisch', async () => {
    const en = (await hole('finance/valuation', 'en')).sets.find(s => s.set_number === '10294-1');
    assert.ok(en.error_code, `ohne Code: ${JSON.stringify(en.error)}`);
    assert.doesNotMatch(en.error, /kein |Keine |Zugangsdaten|nicht /, en.error);
    const de = (await hole('finance/valuation', 'de')).sets.find(s => s.set_number === '10294-1');
    assert.equal(de.error_code, en.error_code);
    assert.notEqual(de.error, en.error, 'der deutsche Text ist ein anderer');
  });

  await t.test('Kacheln mit Codes', async () => {
    const jobs = (await hole('admin/jobs', 'en')).jobs;
    assert.deepEqual(jobs.bricksetRetry.sub_teile, [{ code: 'keine_ausstehenden' }]);
    assert.deepEqual(jobs.pdfJobs?.sub_teile ?? [{ code: 'no_active' }], [{ code: 'no_active' }]);
    for (const [name, k] of Object.entries(jobs))
      if (k.sub_teile) for (const s of k.sub_teile) assert.match(s.code, /^[a-z_]+$/, `${name}: ${s.code}`);
  });
});
