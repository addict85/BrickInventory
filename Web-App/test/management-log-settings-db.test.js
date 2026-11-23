/**
 * The admin log also records changes to server settings —
 * mail server (where the reset links go), access keys,
 * registration: who, when, which keys, never the values. A form sent back
 * unchanged writes no entry.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  protokolliere() deleted in POST /settings → red: both cases
 *   B  the comparison with the old value deleted (every sent key
 *      counts) → red: “unchanged …”
 *   C  in saveSettings() the writes without kx.transact()
 *      (directly one after another) → red: “if an account value fails …” (smtp_host
 *      and log entry remained; 13.11.2026 with `language: 'xx'`)
 *   D  (13.11.2026) the currency again in the loop inside kx.transact()
 *      → red: “a valid currency …” (500: BesideTheTransaction, because the
 *      household switch needs the system frame)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = Buffer.alloc(32, 5).toString('base64');

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('server settings in the admin log', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const CHEF = `protokoll_${process.pid}`,
    PASS = 'Protokoll-Pruefung-3';
  const KEY = ['smtp_host', 'rebrickable_api_key', 'registration_enabled'];
  const prior = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [KEY]);
  await db.run('DELETE FROM users WHERE username = $1', [CHEF]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`,
      [CHEF, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [KEY]);
    for (const z of prior) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM admin_log WHERE admin_id = $1', [uid]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [KEY]);
  const { base } = routerServer(_req, {
    session: { userId: uid, isAdmin: true },
    apiAccount: { user_id: uid, is_admin: 1 },
    routes: { '/api/v2': 'routes/api/index.js' },
    t,
  });
  const storeIt = body =>
    fetch(`${base}/api/v2/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_password: PASS, ...body }),
    }).then(async r => [r.status, await r.json()]);
  const owned = async () =>
    (await (await fetch(`${base}/api/v2/admin/audit-log`)).json()).entries.filter(e => e.admin_id === uid);
  const SECRET = 'Rebrickable-Geheim-4711';

  await t.test('a change is recorded with the keys, not with the values', async () => {
    const [status, b] = await storeIt({
      smtp_host: 'mail.neu.example',
      rebrickable_api_key: SECRET,
      registration_enabled: '0',
    });
    assert.equal(status, 200, JSON.stringify(b));
    const e = await owned();
    assert.equal(e.length, 1, JSON.stringify(e));
    assert.equal(e[0].action, 'settings_changed');
    assert.deepEqual(e[0].details.split(', ').sort(), ['rebrickable_api_key', 'registration_enabled', 'smtp_host']);
    assert.ok(!JSON.stringify(e).includes(SECRET) && !JSON.stringify(e).includes('mail.neu.example'));
  });

  await t.test('sent back unchanged writes no entry', async () => {
    const [status] = await storeIt({
      smtp_host: 'mail.neu.example',
      rebrickable_api_key: SECRET,
      registration_enabled: '0',
    });
    assert.equal(status, 200);
    assert.equal((await owned()).length, 1);
  });

  await t.test('if an account value fails, global values and log stay as before', async () => {
    const [status, b] = await storeIt({ smtp_host: 'mail.halb.example', language: 'xx' });
    assert.deepEqual([status, b.code], [400, 'value_invalid']);
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'smtp_host'`))?.value,
      'mail.neu.example',
    );
    assert.equal((await owned()).length, 1, 'no entry for a change that does not apply');
  });

  await t.test('… also with an invalid currency that is checked before the transaction', async () => {
    const [status, b] = await storeIt({ smtp_host: 'mail.halb.example', currency: 'XYZ' });
    assert.deepEqual([status, b.code], [400, 'value_invalid']);
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'smtp_host'`))?.value,
      'mail.neu.example',
    );
    assert.equal((await owned()).length, 1, 'no entry for a change that does not apply');
  });

  await t.test('a valid currency applies together with the other account values', async () => {
    const [status, b] = await storeIt({ currency: 'USD', language: 'en' });
    assert.equal(status, 200, JSON.stringify(b));
    const values = await db.all(
      `SELECT key, value FROM user_settings WHERE user_id = $1 AND key IN ('currency', 'language') ORDER BY key`,
      [uid],
    );
    assert.deepEqual(
      values.map(w => `${w.key}=${w.value}`),
      ['currency=USD', 'language=en'],
    );
  });
});
