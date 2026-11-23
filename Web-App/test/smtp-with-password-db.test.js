/**
 * An admin only changes the mail server with his password. The reset links
 * go via it; with a captured session alone it could otherwise be
 * bent. Saving without a change does not ask.
 *
 * Counter-check (measured on 28.10.2026): the password check in POST
 * /api/v2/settings removed → red: “without a password the mail server stays”.
 * Counter-check (measured on 29.10.2026): smtp_* again in the key list
 * of POST /import → red: “the import does not switch the mail server”
 * (smtp_host was mail.angreifer.example afterwards).
 *
 * Registration and API keys likewise (since 04.11.2026), the admins
 * learn of it by mail. Counter-checks (measured 04.11.2026, each on its own):
 *   A  isSensitive() again only smtp_* → red: “without a password registration
 *      and API key stay” (200 instead of 400)
 *   B  adminHintInBackground() removed in POST /settings → red: “changed with
 *      password, the administrators learn of it”
 *   C  the refusal without admin_password before the check removed → red: “without
 *      a password the mail server stays”, “without a password registration …”
 *      (current_password_wrong, counts toward the brake)
 *
 * A first API key (empty before) needs no password as long as the
 * setup is open: otherwise the wizard asks in the middle of the step.
 * Afterwards the password requirement applies to it too (round 12, H1).
 * Counter-checks (measured 04.11.2026):
 *   D  the exception for empty values removed → red: “a first API key
 *      needs no password during setup” (400 instead of 200)
 *   E  the exception again without `einrichtung &&` → red: “after setup
 *      even a first key only with password” (200 instead of 400)
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

test('SMTP only with password', { concurrency: 1 }, async t => {
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
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${uid}|%`]);
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

  await t.test('without a password the mail server stays', async () => {
    const r = await store({ smtp_host: 'mail.angreifer.example' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'current_password_required');
    assert.equal(await host(), 'mail.alt.example');
  });

  await t.test('saving unchanged does not ask', async () => {
    const r = await store({ smtp_host: 'mail.alt.example', language: 'de' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('with a password it is changed', async () => {
    const r = await store({ smtp_host: 'mail.neu.example', admin_password: PASS });
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

  await t.test('after setup even a first key only with password', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'brickset_api_key'");
    await db.run("INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1')");
    const r = await store({ brickset_api_key: 'erster-fremder' });
    assert.deepEqual([r.status, r.body.code], [400, 'current_password_required']);
    assert.equal(await value('brickset_api_key'), undefined);
  });

  await t.test('without a password registration and API key stay', async () => {
    await db.run(
      "INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '0') ON CONFLICT (key) DO UPDATE SET value = '0'",
    );
    for (const body of [{ registration_enabled: '1' }, { rebrickable_api_key: 'fremder-schluessel' }]) {
      const r = await store(body);
      assert.deepEqual([r.status, r.body.code], [400, 'current_password_required'], JSON.stringify(body));
    }
    assert.equal(await value('registration_enabled'), '0');
    assert.notEqual(await value('rebrickable_api_key'), 'fremder-schluessel');
  });

  await t.test('changed with password, the administrators learn of it', async () => {
    mails.length = 0;
    const r = await store({ registration_enabled: '1', admin_password: PASS });
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
