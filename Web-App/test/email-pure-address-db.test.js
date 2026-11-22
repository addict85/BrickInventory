/**
 * An e-mail address is a pure address: no display name, no list,
 * no whitespace or control character. nodemailer read `x1<opfer@…>` as a display name
 * and delivered to opfer@…, while assignment check and target throttle counted a
 * different string. Sending checks that a second time and sets
 * the one address as the envelope.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  EMAIL_RE back to /^[^\s@]+@[^\s@]+\.[^\s@]+$/ → red: “registration
 *      only takes pure addresses”, “forgot password and confirmation …”,
 *      “the profile …” (200 instead of 400), “existing data is reported”
 *   B  the check isSingleRecipient() removed in sendMail() → red: “sending
 *      rejects a stored list”
 *   C  `envelope` removed in sendMail() → red: “the envelope names exactly the
 *      one address”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'https://lego.example.org';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const nodemailer = require(path.join(__dirname, '..', 'node_modules', 'nodemailer'));
const gesendet = [];
nodemailer.createTransport = () => ({
  sendMail: async m => {
    gesendet.push(m);
    return { messageId: 'x' };
  },
});

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const mailer = _req('src/mail/mailer.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const P = process.pid,
  PASS = 'Reine-Adresse-Pass-1';
const UNREIN = [
  'x1<opfer@example.org>',
  '"Opfer" <opfer@example.org>',
  'opfer@example.org,dritter@example.org',
  'opfer@example.org;x',
  'op fer@example.org',
  'opfer@example.org\u0007',
  '(k)opfer@example.org',
];

test('only plain email addresses', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const SCHLUESSEL = ['registration_enabled', 'smtp_host', 'smtp_user', 'smtp_from'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const put = (k, v) =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, v],
    );
  await put('registration_enabled', '1');
  await put('smtp_host', '192.0.2.25'); // one address: a name would have to resolve (src/infra/targetAddress.ts)
  await put('smtp_user', 'versand');
  await put('smtp_from', 'BrickInventory <absender@example.org>');
  const NAME = `rein_${P}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    await db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot|bestaetigung)'");
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  // The IP throttle (5/h) should not hide the check of the address.
  const callIt = async (methode, path, body) => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot|bestaetigung)'");
    const r = await fetch(`${base}/api/v2/auth${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json()).code };
  };

  await t.test('registration only accepts plain addresses', async () => {
    for (const [i, email] of UNREIN.entries()) {
      const r = await callIt('POST', '/register', { username: `spam${i}_${P}`, email, password: 'Langes-Passwort-42' });
      assert.deepEqual(r, { status: 400, code: 'email_invalid' }, email);
    }
    assert.equal((await db.get('SELECT count(*)::int AS n FROM users WHERE username LIKE $1', [`spam%_${P}`])).n, 0);
    const gut = await callIt('POST', '/register', {
      username: `gut_${P}`,
      email: `o'brien.gut_${P}@example.org`,
      password: 'Langes-Passwort-42',
    });
    assert.equal(gut.status, 200, 'an ordinary address with an apostrophe goes through');
  });

  await t.test('forgot password and confirmation only accept plain addresses', async () => {
    for (const weg of ['/forgot-password', '/resend-confirmation'])
      for (const email of UNREIN)
        assert.deepEqual(
          await callIt('POST', weg, { email }),
          { status: 400, code: 'email_invalid' },
          `${weg} ${email}`,
        );
  });

  await t.test('the profile only accepts plain addresses', async () => {
    const r = await callIt('PUT', '/profile', { email: 'x<opfer@example.org>', password_current: PASS });
    assert.deepEqual(r, { status: 400, code: 'email_invalid' });
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, `${NAME}@example.org`);
  });

  await t.test('sending rejects a stored list', async () => {
    gesendet.length = 0;
    for (const to of UNREIN) {
      const r = await mailer.sendMail({ to, subject: 'Probe', text: 'x' });
      assert.equal(r.success, false, to);
    }
    assert.deepEqual(gesendet, [], 'mail was sent to an impure address');
  });

  await t.test('the envelope names exactly the one address', async () => {
    gesendet.length = 0;
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Probe', text: 'x' });
    assert.equal(r.success, true);
    assert.deepEqual(
      gesendet.map(m => m.envelope),
      [{ from: 'absender@example.org', to: ['ziel@example.org'] }],
    );
  });

  await t.test('existing data is reported, not changed', async () => {
    const alt = (
      await db.get(
        `INSERT INTO users (username, email, password_hash) VALUES ($1, 'x1<opfer@example.org>', 'x')
      RETURNING id`,
        [`alt_${P}`],
      )
    ).id;
    const warn = console.warn,
      zeilen = [];
    console.warn = (...a) => zeilen.push(a.join(' '));
    let ids;
    try {
      ids = await _req('src/account/accounts.js').reportInvalidAddresses();
    } finally {
      console.warn = warn;
    }
    assert.ok(ids.includes(alt) && !ids.includes(uid), JSON.stringify(ids));
    assert.match(zeilen.join('\n'), new RegExp(`IDs [0-9, ]*\\b${alt}\\b`));
    assert.doesNotMatch(zeilen.join('\n'), /opfer@/, 'the message names no address');
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [alt])).email, 'x1<opfer@example.org>');
  });
});
