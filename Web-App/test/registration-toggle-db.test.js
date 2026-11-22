/**
 * Registration is only open at exactly '1' — display and enforcement
 * ask the same function. Yes/no settings only accept 0 or 1 when writing,
 * via the form as well as via the import.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  routes/auth.ts at state e21f747 (lock only at `=== '0'`) → red from
 *      „ohne Zeile bleibt sie zu" on (account created, 200)
 *   B  registrationOpen() with `!== '0'` → red: „ohne Zeile …" and “"false"
 *      is closed” (the display reports enabled: true)
 *   C  isValidGlobalValue() always delivers true → red: “the form only takes
 *      0 or 1” (200, "false" stored)
 *   E  (04.11.) registration_enabled again without confirmation in the import → red:
 *      “the import skips the registration”
 *   D  (02.11.) passkey/passwort_vergessen fixed true → red: “login methods
 *      only when the server supports them” (without APP_BASE_URL true); only
 *      basisUrl() without mailConfigured() → red (without SMTP true)
 *   F  (04.11.) registration-status and /register without mailReady() → red:
 *      “without mail sending it stays closed …”; likewise the check when switching on
 *      in POST /settings removed
 *   G  (04.11.) switchRegistrationFree() leaves registration_pending standing or
 *      the route does not log → red: “the administrator approves …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const { mailAttrappe } = require('./helpers/mail-fake');
mailAttrappe();
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('registration and yes/no settings', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const CHEF = `reg_chef_${process.pid}`,
    PASS = 'Chef-Passwort-1',
    NEU = `reg_neu_${process.pid}`;
  const vorher = await db.all(
    "SELECT key, value FROM global_settings WHERE key IN ('registration_enabled', 'smtp_secure', 'smtp_host', 'smtp_user')",
  );
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NEU]]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`,
      [CHEF, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%'");
  t.after(async () => {
    await db.run(
      "DELETE FROM global_settings WHERE key IN ('registration_enabled', 'smtp_secure', 'smtp_host', 'smtp_user')",
    );
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NEU]]);
    await db.pool.end().catch(() => {});
  });

  const { base } = routerServer(_req, {
    sitzung: { userId: uid, isAdmin: true },
    t,
    routen: { '/api/v2/auth': 'routes/auth.js', '/api/v2': 'routes/api/settings.js' },
  });
  const rufe = (methode, path, body) =>
    fetch(`${base}/api/v2${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const setze = async wert => {
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (wert !== null)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [wert]);
  };
  const register = () =>
    rufe('POST', '/auth/register', { username: NEU, email: `${NEU}@example.org`, password: 'Neues-Passwort-1' });
  const gespeichert = async key => (await db.get('SELECT value FROM global_settings WHERE key = $1', [key]))?.value;

  for (const [fall, wert] of [
    ['ohne Zeile bleibt sie zu', null],
    ['"false" ist zu', 'false'],
    ['"0" ist zu', '0'],
  ]) {
    await t.test(fall, async () => {
      await setze(wert);
      assert.equal((await rufe('GET', '/auth/registration-status')).body.enabled, false);
      const r = await register();
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.code, 'registration_disabled');
      assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [NEU]), undefined);
    });
  }

  await t.test('login methods only when the server supports them', async () => {
    const alt = process.env.APP_BASE_URL;
    t.after(() => {
      if (alt === undefined) environment({ APP_BASE_URL: undefined });
      else environment({ APP_BASE_URL: alt });
    });
    const wege = async () => {
      const b = (await rufe('GET', '/auth/registration-status')).body;
      return [b.passkey, b.forgot_password];
    };
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user')");
    environment({ APP_BASE_URL: undefined });
    assert.deepEqual(await wege(), [false, false], 'ohne Adresse');
    environment({ APP_BASE_URL: 'http://192.168.1.20:3000' });
    assert.deepEqual(await wege(), [false, false], 'IP-Adresse, ohne Mail');
    environment({ APP_BASE_URL: 'https://inventar.example.org' });
    assert.deepEqual(await wege(), [true, false], 'Domäne, ohne Mail');
    await db.run(
      "INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.example.org'), ('smtp_user', 'inventar')",
    );
    assert.deepEqual(await wege(), [true, true], 'Domäne und Mail');
  });

  await t.test('"1" opens it', async () => {
    await setze('1');
    assert.equal((await rufe('GET', '/auth/registration-status')).body.enabled, true);
    const r = await register();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(await db.get('SELECT id FROM users WHERE username = $1', [NEU]));
  });

  await t.test('without mail sending it stays closed and cannot be switched on', async () => {
    environment({ APP_BASE_URL: 'https://inventar.example.org' });
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user')");
    const s = (await rufe('GET', '/auth/registration-status')).body;
    assert.deepEqual([s.enabled, s.mail_delivery], [false, false], 'trotz "1"');
    const r = await rufe('POST', '/auth/register', {
      username: `${NEU}_x`,
      email: `${NEU}_x@example.org`,
      password: 'Neues-Passwort-1',
    });
    assert.deepEqual([r.status, r.body.code], [403, 'registration_disabled']);
    await setze('0');
    const ein = await rufe('POST', '/settings', { registration_enabled: '1', admin_password: PASS });
    assert.deepEqual([ein.status, ein.body.code], [400, 'registration_needs_mail']);
    assert.equal(await gespeichert('registration_enabled'), '0');
    const withMail = await rufe('POST', '/settings', {
      registration_enabled: '1',
      smtp_host: 'mail.example.org',
      smtp_user: 'inventar',
      admin_password: PASS,
    });
    assert.equal(withMail.status, 200, JSON.stringify(withMail.body));
    assert.equal(await gespeichert('registration_enabled'), '1');
  });

  await t.test('the administrator approves an open registration', async () => {
    const { assertLoginAllowed } = _req('src/account/loginCheck.js');
    const neu = (await db.get('SELECT id FROM users WHERE username = $1', [NEU])).id;
    const row = () => db.get('SELECT * FROM users WHERE id = $1', [neu]);
    const inList = async () => (await rufe('GET', '/auth/users')).body.users.find(u => u.id === neu);
    assert.equal((await inList()).awaiting_confirmation, true);
    assert.equal(assertLoginAllowed(await row())?.code, 'email_not_confirmed');
    assert.equal((await rufe('PUT', `/auth/users/${neu}/approve`, {})).status, 400, 'ohne Passwort');
    const r = await rufe('PUT', `/auth/users/${neu}/approve`, { admin_password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const z = await row();
    assert.deepEqual(
      [z.email, z.email_verified, z.registration_pending, z.new_email],
      [`${NEU}@example.org`, true, false, null],
    );
    assert.equal(assertLoginAllowed(z), null);
    assert.equal((await inList()).awaiting_confirmation, false);
    assert.equal(
      (await db.get('SELECT action FROM admin_log WHERE target_id = $1 ORDER BY id DESC LIMIT 1', [neu])).action,
      'account_unlocked',
    );
    const nochmal = await rufe('PUT', `/auth/users/${neu}/approve`, { admin_password: PASS });
    assert.deepEqual([nochmal.status, nochmal.body.code], [409, 'account_not_pending']);
  });

  await t.test('the form only takes 0 or 1', async () => {
    for (const falsch of ['false', 'true', 'ja', '']) {
      const r = await rufe('POST', '/settings', { registration_enabled: falsch });
      assert.equal(r.status, 400, `${falsch}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'value_invalid');
    }
    const smtpBefore = await gespeichert('smtp_secure');
    assert.equal((await rufe('POST', '/settings', { smtp_secure: 'yes', admin_password: PASS })).status, 400);
    assert.equal(await gespeichert('registration_enabled'), '1');
    assert.equal(await gespeichert('smtp_secure'), smtpBefore);
    assert.equal((await rufe('POST', '/settings', { registration_enabled: '0', admin_password: PASS })).status, 200);
    assert.equal(await gespeichert('registration_enabled'), '0');
  });

  await t.test('the import skips the registration', async () => {
    const fd = new FormData();
    fd.append(
      'file',
      new Blob([JSON.stringify({ global: { registration_enabled: '1' } })], { type: 'application/json' }),
      'config.json',
    );
    const r = await fetch(`${base}/api/v2/settings/import`, { method: 'POST', body: fd }).then(async x => ({
      status: x.status,
      body: await x.json(),
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await gespeichert('registration_enabled'), '0', 'der Import öffnete die Registrierung');
    assert.deepEqual(r.body.smtp_skipped, ['registration_enabled']);
  });
});
