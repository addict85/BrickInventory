/**
 * Over 24 h all wrong codes of an account count in the database; from the
 * 20th on no one-time code applies any more, only a recovery code or passkey, and
 * the owner immediately gets a mail. The test clears the other locks before
 * every attempt so that only the daily limit takes effect.
 *
 * Counter-checks (measured 13.11.2026, each on its own):
 *   A  factorCodeLocked() always delivers false → red: “above the limit
 *      even a correct one-time code does not apply”
 *   B  in checkCredentials() the call hintInBackground(…,
 *      'second_factor_locked') deleted → red: “the owner learns of it
 *      immediately, once”
 *   C  pruefeCode() checks nothing at all with mitEinmalcode=false (return
 *      null before the recovery codes) → red: “a recovery code
 *      still applies”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const mails = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, kind) => {
    mails.push({ an, kind });
    return { success: true };
  },
});
const { accessOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const zf = _req('src/factors/secondFactor.js');
const lim = _req('src/account/loginLimiter.js');
const { checkCredentials } = _req('src/account/loginCheck.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const PASS = 'Tagesschranke-Passwort-1';
const IP = '198.51.100.44';

test('daily limit for second-factor codes at login', { concurrency: 1, timeout: 120_000 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const NAME = `zfschranke_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  const lockEmpty = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE (key LIKE 'login%' AND key LIKE $1) OR key LIKE $2`, [
      `%konto:${uid}`,
      `%${IP}%`,
    ]);
  t.after(async () => {
    await lockEmpty();
    await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`faktor-anmeldung-konto|${uid}`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const secret = await zf.beginSetup(uid);
  const schluessel = zf.fromBase32(secret);
  const codes = await zf.confirmSetup(uid, zf.hotp(schluessel, zf.timeStep() - 1));
  assert.equal(codes?.length, 10, 'Einrichtung');
  const s = zf.timeStep();
  const gueltig = [-1, 0, 1].map(v => zf.hotp(schluessel, s + v));
  const FALSCH = ['000000', '111111', '222222', '333333'].find(c => !gueltig.includes(c));

  const anmelden = async code => {
    await lockEmpty();
    return checkCredentials({ ip: IP }, NAME, PASS, code);
  };

  await t.test('up to the limit: wrong code', async () => {
    for (let i = 1; i < lim.MAX_FACTOR_LOGIN_JE_ACCOUNT; i++) {
      const r = await anmelden(FALSCH);
      assert.equal(r.absage?.code, 'second_factor_wrong', `Versuch ${i}`);
    }
    const r = await anmelden(FALSCH);
    assert.equal(r.absage?.code, 'second_factor_locked', 'der 20. falsche Code erreicht die Schranke');
    assert.equal(r.absage?.secondFactor, true, 'das Codefeld bleibt offen');
    const row = await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [`faktor-anmeldung-konto|${uid}`]);
    assert.equal(Number(row?.count), lim.MAX_FACTOR_LOGIN_JE_ACCOUNT, 'gezählt in der Datenbank');
  });

  await t.test('the owner learns of it immediately, once', async () => {
    // hintInBackground sends without await; only a second look shows that it stays at one mail.
    await bis(() => mails.some(m => m.kind === 'second_factor_locked'));
    await anmelden(FALSCH);
    assert.deepEqual(
      mails.filter(m => m.kind === 'second_factor_locked'),
      [{ an: `${NAME}@example.org`, kind: 'second_factor_locked' }],
    );
  });

  await t.test('above the limit even a correct one-time code does not apply', async () => {
    const r = await anmelden(zf.hotp(schluessel, zf.timeStep()));
    assert.equal(r.ok, false, 'richtiger Einmalcode über der Schranke angenommen');
    assert.equal(r.absage?.code, 'second_factor_locked');
  });

  await t.test('a recovery code still applies', async () => {
    const r = await anmelden(codes[0]);
    assert.equal(r.ok, true, JSON.stringify(r.absage));
  });
});
