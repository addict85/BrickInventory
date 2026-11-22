/**
 * A Unicode spelling of the same address is the same account — for the
 * login, for the lock and for the reset mail. PostgreSQL lowercases „İ“ as
 * „i“, JavaScript as „i̇“; before, the login found the account, but the lock
 * counted under a new identifier, and the reset mail went to the
 * typed-in spelling.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  accountKey() again with JavaScript toLowerCase() and `= $1` → red:
 *      “after five failed attempts the Unicode spelling is locked too”
 *   B  sendPasswordResetMail again to `email` from the request → red: “the
 *      reset mail goes to the stored address”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Links in mails only exist with a fixed address (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
// Otherwise the console shows the recipient address only masked (src/mail/mailer.ts).
process.env.MAIL_CONSOLE_WITH_TOKEN = '1';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `unicode_${process.pid}`;
const MAIL = `opfer${process.pid}@mailbox.example`;
const VARIANT = MAIL.replace('mailbox', 'maİlbox');

test('Unicode spellings of the same address', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, MAIL, bcrypt.hashSync('richtig-geheim', 4)],
    )
  ).id;
  const aufraeumen = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2`, [
      `%konto:${uid}`,
      `%${MAIL.split('@')[0]}%`,
    ]);
  await aufraeumen();
  await db.run("DELETE FROM global_settings WHERE key LIKE 'smtp_%'");
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { checkCredentials } = _req('src/account/loginCheck.js');

  await t.test('after five failed attempts the Unicode spelling is locked too', async () => {
    const anfrage = { ip: '203.0.113.9', socket: {}, headers: {} };
    for (let i = 0; i < 5; i++) {
      const r = await checkCredentials(anfrage, MAIL, 'falsch');
      assert.equal(r.absage?.kind, 'not_signed_in', `Versuch ${i + 1}`);
    }
    const r = await checkCredentials(anfrage, VARIANT, 'richtig-geheim');
    assert.equal(r.absage?.kind, 'too_many', 'die Variante bekam frische Zähler');
  });

  await t.test('the reset mail goes to the stored address', async () => {
    const app = express();
    app.use(express.json());
    app.use(einhaengung('auth'), require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
    const srv = app.listen(0);
    const zeilen = [];
    const echt = console.log;
    console.log = (...a) => {
      zeilen.push(a.join(' '));
    };
    try {
      const r = await fetch(`http://localhost:${srv.address().port}${einhaengung('auth')}/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VARIANT.toUpperCase() }),
      });
      assert.equal(r.status, 200);
      for (let i = 0; i < 50 && !zeilen.some(z => z.includes('An:')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.log = echt;
      srv.close();
    }
    const an = zeilen.find(z => z.includes('An:')) || '';
    assert.ok(an.includes(MAIL), `Empfänger: ${an}`);
  });
});
