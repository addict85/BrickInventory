/**
 * Server texts follow the language of the request (UI check 17, M17): a
 * price error of the valuation comes with a code and in the language of the
 * Accept-Language header; the tiles of the background jobs carry their
 * subtitle as codes (`sub_teile`) that the UI translates. Before,
 * the English UI showed „kein BrickLink-Preis gefunden“ and
 * „Keine ausstehenden Einträge“. Real server; without BrickLink access
 * every price fails, as in the test environment.
 *
 * Counter-checks (measured 05.11.2026, each on its own):
 *   A  in routes/api/finance.ts `sets: uebersetzt(…)` removed → red:
 *      “price errors in English” (German text)
 *   B  in fetchPrice (src/finances/calculation/prices.ts) again throw new
 *      Error(`… — kein BrickLink-Preis gefunden`) → red: “price errors in
 *      English” (no error_code)
 *   C  sub_teile of the Brickset tile removed → red: “tiles with codes”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');

test('server texts in the language of the request', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
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
  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });
  const hole = async (path, language) =>
    (await fetch(`${base}/api/v2/${path}`, { headers: { 'Accept-Language': language } })).json();

  await t.test('price errors in English', async () => {
    const en = (await hole('finance/valuation', 'en')).sets.find(s => s.set_number === '10294-1');
    assert.ok(en.error_code, `without a code: ${JSON.stringify(en.error)}`);
    assert.doesNotMatch(en.error, /kein |Keine |Zugangsdaten|nicht /, en.error);
    const de = (await hole('finance/valuation', 'de')).sets.find(s => s.set_number === '10294-1');
    assert.equal(de.error_code, en.error_code);
    assert.notEqual(de.error, en.error, 'the German text is a different one');
  });

  await t.test('tiles with codes', async () => {
    const jobs = (await hole('admin/jobs', 'en')).jobs;
    assert.deepEqual(jobs.bricksetRetry.sub_parts, [{ code: 'none_pending' }]);
    assert.deepEqual(jobs.pdfJobs?.sub_parts ?? [{ code: 'no_active' }], [{ code: 'no_active' }]);
    for (const [name, k] of Object.entries(jobs))
      if (k.sub_parts) for (const s of k.sub_parts) assert.match(s.code, /^[a-z_]+$/, `${name}: ${s.code}`);
  });
});
