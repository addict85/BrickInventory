/**
 * An account without administrator rights uses at most a quarter of the
 * daily quota of a service; administrators and background jobs only count
 * against the total quota. A rejected call does not count in the total either.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the per-account count removed in kontingentPruefenUndZaehlen → red:
 *      “an account gets a quarter …”
 *   B  not rolled back at a full account limit (return instead of throw) → red:
 *      “… and the rejected call does not count in the total”
 *   C  (30.10.2026) the count “all accounts” removed → red: “all
 *      non-administrators together at most half”
 *   D  (30.10.2026) inNamesOfJob() omitted in the job worker → red:
 *      “a job counts for the account that enqueued it”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const k = _req('src/externalSources/apiQuota.js');
const { asRequest } = _req('src/infra/accountContext.js');

test('daily quota per account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const vorher = await db.get("SELECT value FROM global_settings WHERE key = 'api_limit_brickset'");
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('api_limit_brickset', '8')
                ON CONFLICT (key) DO UPDATE SET value = '8'`);
  await k.setQuotaBack('brickset');
  t.after(async () => {
    await k.setQuotaBack('brickset');
    if (vorher) await db.run("UPDATE global_settings SET value = $1 WHERE key = 'api_limit_brickset'", [vorher.value]);
    else await db.run("DELETE FROM global_settings WHERE key = 'api_limit_brickset'");
    await db.pool.end().catch(() => {});
  });
  const kind = { apiUser: { user_id: 990101, is_admin: 0 } };
  const chef = { apiUser: { user_id: 990102, is_admin: 1 } };
  const zaehle = req => asRequest(req, () => k.checkAndCountQuota('brickset'));

  await t.test('an account gets a quarter, and the rejected call does not count in the total', async () => {
    assert.equal((await zaehle(kind)).allowed, true);
    assert.equal((await zaehle(kind)).allowed, true);
    const dritter = await zaehle(kind);
    assert.equal(dritter.allowed, false);
    assert.equal(dritter.jeAccount, true);
    assert.equal((await k.quotaOverview('brickset')).count, 2);
    assert.equal((await asRequest(kind, () => k.quotaFree('brickset'))).allowed, false);
  });

  await t.test('all non-admins together at most half', async () => {
    await k.setQuotaBack('brickset');
    const konten = [990111, 990112, 990113].map(id => ({ apiUser: { user_id: id, is_admin: 0 } }));
    // Limit 8: 2 per account, 4 for all together. The third account gets nothing more.
    for (const kto of konten.slice(0, 2)) for (let i = 0; i < 2; i++) assert.equal((await zaehle(kto)).allowed, true);
    const dritter = await zaehle(konten[2]);
    assert.equal(dritter.allowed, false);
    assert.equal((await asRequest(konten[2], () => k.quotaFree('brickset'))).allowed, false);
    assert.equal((await zaehle(chef)).allowed, true, 'Verwalter haben die andere Hälfte');
    assert.equal((await k.quotaOverview('brickset')).count, 5);
  });

  await t.test('a job counts for the account that queued it', async () => {
    await k.setQuotaBack('brickset');
    await db.run("DELETE FROM users WHERE username = 'kontingent_kind'");
    await db.run(
      "INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ('kontingent_kind','x',false,true,true)",
    );
    const uid = (await db.get("SELECT id FROM users WHERE username = 'kontingent_kind'")).id;
    const { createWorker } = _req('jobs/jobWorker.js');
    const { placeJobOne } = Object.assign({}, _req('src/jobQueue/jobs.js'), {
      ..._req('src/jobQueue/service.js'),
      ...require('./helpers/sources').testArea('jobQueue').auftraege,
    });
    const results = [];
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
      {
        wechselkurse: {
          ausfuehren: async () => {
            for (let i = 0; i < 3; i++) results.push((await k.checkAndCountQuota('brickset')).allowed);
          },
        },
      },
      { parallel: 1 },
    );
    await placeJobOne('wechselkurse', {}, { userId: uid });
    while (await w.processOne()) {
      /* until the table is empty */
    }
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    assert.deepEqual(results, [true, true, false], 'Im Auftrag gilt das Viertel des Kontos');
  });

  await t.test('admins and background only count in the total', async () => {
    await k.setQuotaBack('brickset');
    for (let i = 0; i < 2; i++) assert.equal((await zaehle(kind)).allowed, true);
    for (let i = 0; i < 5; i++) assert.equal((await zaehle(chef)).allowed, true, `Verwalter ${i + 1}`);
    assert.equal((await k.checkAndCountQuota('brickset')).allowed, true, 'Hintergrund');
    assert.equal((await k.checkAndCountQuota('brickset')).allowed, false, 'gesamt voll');
    assert.equal((await k.quotaOverview('brickset')).count, 8);
  });
});
