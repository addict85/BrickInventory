/**
 * Mails to unconfirmed addresses carry no text from the request: no
 * salutation from first, last or username, the console shows the real link,
 * and registration as well as „Passwort vergessen" are throttled per target address.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  routes/auth.ts and src/mail/mailer.ts at state 2b73e33 → all six
 *      parts red, among them “the confirmation mail names …” („Hallo Anna,“)
 *   B  nameValid() removed in POST /register → red: “names with an address or
 *      control characters are rejected” (200 instead of 400)
 *   C  targetThrottled() removed in POST /register → red: “at most three
 *      registrations per target address” (200 instead of 429)
 *   D  sendMail() again gives the text to the old URL search in
 *      linkForConsole() → red: “the console shows the real link”
 *   E  targetThrottled() removed in /forgot-password → red: “the fourth
 *      reset link to the same address does not come”
 *   F  sendVerificationMail() ignores `mehrere` → red: „die zweite Mail
 *      verweist auf die Bestätigungsseite“ (measured 04.11.2026)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'https://lego.example.org';

// The mailer builds the transport only when sending: intercept here instead of sending.
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

const P = process.pid;
const BOESE = 'Gewinn-abholen.example';

test('mails without foreign text', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const SCHLUESSEL = ['registration_enabled', 'smtp_host', 'smtp_user'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const put = async (k, v) =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, v],
    );
  await put('registration_enabled', '1');
  await put('smtp_host', '192.0.2.25'); // an address: a name would have to resolve (src/infra/targetAddress.ts)
  await put('smtp_user', 'versand');
  const emptyCounter = () => db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot)'");
  await emptyCounter();
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    await emptyCounter();
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t });
  const callIt = (methode, path, body) =>
    fetch(`${base}/api/v2/auth${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const register = (u, email, extra = {}) =>
    callIt('POST', '/register', { username: u, email, password: 'Langes-Passwort-42', ...extra });
  const waitOnMail = async an => {
    for (let i = 0; i < 50; i++) {
      const m = gesendet.find(x => x.to === an);
      if (m) return m;
      await new Promise(r => setTimeout(r, 20));
    }
    return undefined;
  };

  await t.test('names with an address or control characters are rejected', async () => {
    for (const [i, extra] of [
      { first_name: `Hallo ${BOESE}: https://boese.example/x` },
      { last_name: 'Meier\nKlick hier' },
      { first_name: 'www.boese.example' },
    ].entries()) {
      const r = await register(`name${i}_${P}`, `name${i}_${P}@example.org`, extra);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.code, 'name_invalid');
    }
    const lang = await register(`lang_${P}`, `lang_${P}@example.org`, { first_name: 'x'.repeat(101) });
    assert.equal(lang.status, 400, 'the input contract rejects more than 100 characters');
    const hash = await require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs')).hash(
      'Profil-Passwort-1',
      4,
    );
    sitzung.userId = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
      VALUES ($1, $2, true, true) RETURNING id`,
        [`profil_${P}`, hash],
      )
    ).id;
    const p = await callIt('PUT', '/profile', { first_name: 'Anna\u0007' });
    assert.equal(p.status, 400, JSON.stringify(p.body));
    assert.equal(p.body.code, 'name_invalid');
    assert.equal(
      (
        await callIt('PUT', '/profile', {
          first_name: 'Anna-Lena',
          last_name: "O'Brien",
          password_current: 'Profil-Passwort-1',
        })
      ).status,
      200,
    );
    await emptyCounter();
  });

  await t.test('the confirmation mail names no chosen name', async () => {
    const an = `anna_${P}@example.org`;
    const r = await register(`${BOESE.slice(0, 14)}_${P}`, an, { first_name: 'Anna', last_name: 'Beispiel' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await waitOnMail(an);
    assert.ok(m, 'no confirmation mail');
    for (const teil of [m.text, m.html]) {
      assert.ok(!teil.includes('Anna') && !teil.includes(BOESE.slice(0, 14)), teil.slice(0, 300));
    }
    assert.match(m.text, /https:\/\/lego\.example\.org\/verify#token=[0-9a-f]{64}/, 'the token is in the fragment');
  });

  await t.test('the mail about the taken username does not name it', async () => {
    const an = `zweiter_${P}@example.org`;
    const r = await register(`${BOESE.slice(0, 14)}_${P}`, an);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await waitOnMail(an);
    assert.ok(m, 'no mail to the second address');
    assert.ok(!m.text.includes(BOESE.slice(0, 14)) && !m.html.includes(BOESE.slice(0, 14)), m.text);
  });

  await t.test('several registrations: the mail refers to the confirmation page without names', async () => {
    await emptyCounter();
    const an = `doppelt_${P}@example.org`;
    for (const n of [`${BOESE.slice(0, 14)}x_${P}`, `echt_${P}`]) assert.equal((await register(n, an)).status, 200);
    for (let i = 0; i < 50 && gesendet.filter(m => m.to === an).length < 2; i++)
      await new Promise(r => setTimeout(r, 20));
    const [erste, zweite] = gesendet.filter(m => m.to === an);
    assert.ok(zweite, 'no second mail');
    assert.doesNotMatch(erste.text, /Mehrere Registrierungen/);
    for (const teil of [zweite.text, zweite.html]) {
      assert.match(
        teil,
        /Mehrere Registrierungen nennen diese Adresse/,
        'the second mail points to the confirmation page',
      );
      assert.ok(!teil.includes(BOESE.slice(0, 14)) && !teil.includes(`echt_${P}`), 'the mail names no name');
    }
    await emptyCounter();
  });

  await t.test('at most three registrations per target address', async () => {
    await emptyCounter();
    const an = `ziel_${P}@example.org`;
    const status = [];
    // Different names, so that only the address is shared.
    for (let i = 0; i < 4; i++) status.push((await register(`ziel${i}_${P}`, an)).status);
    assert.deepEqual(status, [200, 200, 200, 429]);
    assert.equal(
      (await register(`andere_${P}`, `andere_${P}@example.org`)).status,
      200,
      'another address from the same IP stays open',
    );
    await emptyCounter();
  });

  await t.test('the fourth reset link to the same address does not come', async () => {
    const an = `vergessen_${P}@example.org`;
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true)`,
      [`vergessen_${P}`, an],
    );
    const gesetzt = [];
    for (let i = 0; i < 4; i++) {
      const r = await callIt('POST', '/forgot-password', { email: an });
      assert.equal(r.status, 200);
      const z = await db.get('SELECT reset_token FROM users WHERE email = $1', [an]);
      gesetzt.push(!!z.reset_token);
      await db.run('UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE email = $1', [an]);
    }
    assert.deepEqual(gesetzt, [true, true, true, false]);
    const m = await waitOnMail(an);
    assert.ok(m && !m.text.includes(`vergessen_${P}`), 'the reset mail greets without a user name');
  });

  await t.test('the console shows the real link', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_host'");
    const zeilen = [];
    const alt = console.log;
    console.log = (...a) => {
      zeilen.push(a.join(' '));
    };
    try {
      await mailer.sendMail({
        to: `k_${P}@example.org`,
        subject: 'x',
        text: 'Hallo https://boese.example/gewinn\nhttps://lego.example.org/verify?token=abc123',
        link: 'https://lego.example.org/verify?token=abc123',
      });
    } finally {
      console.log = alt;
    }
    const link = zeilen.find(z => z.includes('Link:'));
    assert.ok(link, zeilen.join('\n'));
    assert.match(link, /https:\/\/lego\.example\.org\/verify\?token=…/);
    assert.ok(!link.includes('boese'), link);
  });
});
