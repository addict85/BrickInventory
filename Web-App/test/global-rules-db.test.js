'use strict';
/**
 * Global settings have one rule per key (GLOBAL_RULES); the
 * routes wait for the write, and an invalid value changes nothing.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  api_limit_bricklink in GLOBAL_RULES as text(200) → red: “"abc" as
 *      BrickLink limit was accepted” and “an import with an invalid limit …”
 *   B  the check removed in setGlobalSetting (only write) → red in
 *      settings-helfer-db: “a key without a rule is not written”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');

test('global settings: one rule per key', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, 'x', true, true, true) RETURNING id`,
      [`regeln_${process.pid}`],
    )
  ).id;
  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { t, session: { userId: uid, username: 'v', isAdmin: true } });
  const value = async k => (await db.get('SELECT value FROM global_settings WHERE key = $1', [k]))?.value ?? null;
  const send = (m, p, body) =>
    fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  await t.test('invalid limit values yield 400 and change nothing', async () => {
    const r0 = await send('PUT', '/api/v2/admin/api-limits', { bricklink: 4000 });
    assert.equal(r0.status, 200);
    assert.equal(await value('api_limit_bricklink'), '4000', 'the limit is in the table after the response');
    for (const wrong of ['abc', -7, '-7', 0, 100001, '12abc', 1.5]) {
      const r = await send('PUT', '/api/v2/admin/api-limits', { bricklink: wrong });
      assert.equal(r.status, 400, `${JSON.stringify(wrong)} was accepted as BrickLink limit`);
      assert.equal((await r.json()).code, 'daily_limit_area');
    }
    assert.equal(await value('api_limit_bricklink'), '4000', 'the table stays unchanged');
    const ttl = await send('POST', '/api/v2/admin/cache-ttl', { ttl: '7' });
    assert.equal(ttl.status, 400, 'a TTL outside the selection');
  });

  await t.test('an import with an invalid limit changes nothing', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify({ version: '3.0', global: { api_limit_bricklink: 'NaN' } })]),
      'k.json',
    );
    const r = await fetch(`${base}/api/v2/settings/import`, { method: 'POST', body: form });
    assert.equal(r.status, 400, 'an import with an invalid limit …');
    assert.equal(await value('api_limit_bricklink'), '4000');
    const broken = new FormData();
    broken.append('file', new Blob([JSON.stringify({ global: 'kein Objekt' })]), 'k.json');
    assert.equal(
      (await fetch(`${base}/api/v2/settings/import`, { method: 'POST', body: broken })).status,
      400,
      'an import file outside the schema',
    );
  });

  await t.test('every written key has a rule', () => {
    const { GLOBAL_RULES } = _req('src/contract/globalRules.js');
    const { GLOBAL_SETTINGS } = _req('src/contract/settings.js');
    const { DAILY_JOBS } = _req('src/management/timesOfDay.js');
    const written = [
      ...GLOBAL_SETTINGS,
      ...DAILY_JOBS.map(j => `job_time_${j.name}`),
      'app_theme',
      'einrichtung_erledigt',
    ];
    assert.deepEqual(
      written.filter(k => !Object.hasOwn(GLOBAL_RULES, k)),
      [],
    );
    assert.ok(require('node:fs').existsSync(path.join(ROOT, 'src/contract/globalRules.ts')));
  });
});
