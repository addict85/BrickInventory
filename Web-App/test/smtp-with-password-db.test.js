/**
 * Mail server, registration and API keys change with the administrator login alone,
 * no password (docs/SICHERHEIT.md); the administrators learn of a changed
 * registration or key by mail. The import still never switches the mail server.
 *
 * Counter-checks:
 *   A  (26.11.2026) a password check back into POST /settings → red: “the mail server
 *      changes without a password”, “registration and API key …” (400 instead of 200)
 *   B  (04.11.2026) adminHintInBackground() removed in POST /settings → red: “…
 *      the administrators learn of it”
 *   C  (29.10.2026) smtp_* again in the key list of POST /import → red: “the import
 *      does not switch the mail server” (smtp_host was mail.angreifer.example afterwards)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Registration can only be switched on with mail sending (mailReady: mail server and address).
process.env.APP_BASE_URL = 'https://inventar.example.org';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const mails = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _n, kind, o) => {
    mails.push({ an, kind, konto: o.account });
    return { success: true };
  },
});
const { routerServer } = require('./helpers/server');
const db = S.testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtp_chef_${process.pid}`,
  PASS = 'chef-Passwort-1';

test('sensitive settings with the login', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $3, $2, true, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4), `${NAME}@example.org`],
    )
  ).id;
  const SENSITIVE = ['registration_enabled', 'rebrickable_api_key', 'brickset_api_key', 'einrichtung_erledigt'];
  const sensitiveBefore = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SENSITIVE]);
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.alt.example'), ('smtp_user', 'versand')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const landBefore = (await db.get("SELECT value FROM global_settings WHERE key = 'voucher_country'"))?.value;
  t.after(async () => {
    await db.run(
      "DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'smtp_insecure_tls', 'voucher_country')",
    );
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SENSITIVE]);
    for (const z of sensitiveBefore)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    if (landBefore !== undefined)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('voucher_country', $1)", [landBefore]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = routerServer(_req, {
    session: { userId: uid, isAdmin: true },
    routes: { '/api/v2': 'routes/api/settings.js' },
    t,
  });
  const store = body =>
    fetch(`${base}/api/v2/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const host = async () => (await db.get("SELECT value FROM global_settings WHERE key = 'smtp_host'"))?.value;

  await t.test('the mail server changes without a password', async () => {
    const r = await store({ smtp_host: 'mail.neu.example' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await host(), 'mail.neu.example');
  });

  await t.test('the import does not switch the mail server', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_insecure_tls'");
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(
        [
          JSON.stringify({
            global: {
              smtp_host: 'mail.angreifer.example',
              smtp_insecure_tls: '1',
              gutschein_land: 'AT',
            },
          }),
        ],
        { type: 'application/json' },
      ),
      'config.json',
    );
    const r = await fetch(`${base}/api/v2/settings/import`, { method: 'POST', body: fd }).then(async x => ({
      status: x.status,
      body: await x.json(),
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await host(), 'mail.neu.example', 'smtp_host came in via the import');
    assert.equal(
      (await db.get("SELECT value FROM global_settings WHERE key = 'smtp_insecure_tls'"))?.value,
      undefined,
      'smtp_insecure_tls came in via the import',
    );
    // The rest of the file arrives — otherwise the case would check an import that does nothing at all.
    assert.equal((await db.get("SELECT value FROM global_settings WHERE key = 'voucher_country'"))?.value, 'AT');
    assert.deepEqual(r.body.smtp_skipped, ['smtp_host', 'smtp_insecure_tls']);
  });

  const value = async k => (await db.get('SELECT value FROM global_settings WHERE key = $1', [k]))?.value;
  await t.test('a first API key needs no password during setup', async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('rebrickable_api_key', 'einrichtung_erledigt')");
    const r = await store({ rebrickable_api_key: 'erster-schluessel' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await _req('src/settings/settings.js').getGlobalSetting('rebrickable_api_key'), 'erster-schluessel');
  });

  await t.test('registration and API key change without a password, the administrators learn of it', async () => {
    await db.run("INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1')");
    await db.run(
      "INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '0') ON CONFLICT (key) DO UPDATE SET value = '0'",
    );
    const key = await store({ rebrickable_api_key: 'neuer-schluessel' });
    assert.equal(key.status, 200, JSON.stringify(key.body));
    assert.equal(await _req('src/settings/settings.js').getGlobalSetting('rebrickable_api_key'), 'neuer-schluessel');
    const own = kind => mails.some(m => m.an === `${NAME}@example.org` && m.konto === kind);
    for (let i = 0; i < 60 && !own('rebrickable_api_key'); i++) await new Promise(x => setTimeout(x, 25));
    assert.ok(own('rebrickable_api_key'), 'a changed key reaches the administrators');
    mails.length = 0;
    const r = await store({ registration_enabled: '1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await value('registration_enabled'), '1');
    for (let i = 0; i < 60 && !mails.some(m => m.an === `${NAME}@example.org`); i++)
      await new Promise(x => setTimeout(x, 25));
    assert.deepEqual(
      mails.filter(m => m.an === `${NAME}@example.org`),
      [{ an: `${NAME}@example.org`, kind: 'settings_changed', konto: 'registration_enabled' }],
    );
  });
});
