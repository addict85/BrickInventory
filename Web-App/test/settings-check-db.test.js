/**
 * Settings of an account only accept known values, and the
 * configuration backup of a non-admin carries no installation along.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  NUTZER_REGELN.currency set to `() => true` → red: “a foreign currency
 *      is rejected” (200 instead of 400, "<img>" stored)
 *   B  NUTZER_REGELN.language set to `() => true` → red: “a foreign currency
 *      is rejected” (language "xx") and “an object as value is
 *      rejected” ("[object Object]" stored)
 *   C  `if (istVerwalter(req))` removed before the export → red: “a
 *      non-administrator does not export SMTP data”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('settings: validation of the values and export per role', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const NAME = `einst-pruef-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  // Already CHF so that saving triggers no price job (its timer
  // would keep the test process open).
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [uid]);
  const smtpBefore = (await db.get(`SELECT value FROM global_settings WHERE key='smtp_host'`))?.value ?? null;
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('smtp_host','mail.intern.example')
                ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);

  const appFor = isAdmin => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: uid, isAdmin };
      next();
    });
    app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
    app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/settings.js'));
    return app.listen(0);
  };
  const user = appFor(false),
    admin = appFor(true);
  const url = (srv, p) => `http://localhost:${srv.address().port}/api/v2/settings${p}`;
  const send = body =>
    fetch(url(user, '/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const value = async key =>
    (await db.get('SELECT value FROM user_settings WHERE user_id=$1 AND key=$2', [uid, key]))?.value ?? null;

  try {
    await t.test('known values are saved', async () => {
      const r = await send({ currency: 'CHF', language: 'de', user_default_condition: 'U' });
      assert.equal(r.status, 200);
      assert.equal(await value('language'), 'de');
      assert.equal(await value('user_default_condition'), 'U');
    });

    await t.test('a foreign currency is rejected', async () => {
      const r = await send({ currency: '<img src=x>' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'value_invalid');
      assert.equal(await value('currency'), 'CHF', 'the old value stays');
      assert.equal((await send({ language: 'xx' })).status, 400);
      assert.equal((await send({ user_default_condition: 'Z' })).status, 400);
    });

    await t.test('an object as value is rejected', async () => {
      const r = await send({ language: { a: 1 } });
      assert.equal(r.status, 400);
      assert.equal(await value('language'), 'de');
    });

    await t.test('a non-administrator does not export SMTP data', async () => {
      const j = await (await fetch(url(user, '/export'))).json();
      assert.deepEqual(j.global, {});
      assert.equal(j.user_settings.currency, 'CHF', 'the own settings are included');
      const v = await (await fetch(url(admin, '/export'))).json();
      assert.equal(v.global.smtp_host, 'mail.intern.example', 'the admin gets them');
    });
  } finally {
    if (smtpBefore === null) await db.run(`DELETE FROM global_settings WHERE key='smtp_host'`);
    else await db.run(`UPDATE global_settings SET value=$1 WHERE key='smtp_host'`, [smtpBefore]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await new Promise(r => user.close(r));
    await new Promise(r => admin.close(r));
    await db.pool.end().catch(() => {});
  }
});
