/**
 * Concurrent failed attempts do not get past the login lock: an
 * attempt occupies its slot BEFORE the password is checked. Before, 50
 * parallel failed attempts resulted in 49 password checks instead of 5. The same applies to
 * the confirmation of password and code in a running session.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  loginAllowed again with _read instead of _reserviere (address and
 *      account) → red: “20 concurrent failed attempts, at most 5 checks”
 *   B  confirmationLocked again with _read → red: “confirmation: …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('login lock under concurrent attempts', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `parallel_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync('richtig-geheim', 4)],
    )
  ).id;
  const aufraeumen = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key LIKE $3`, [
      `%|${NAME}`,
      `%konto:${uid}`,
      `%-bestaetigen|${uid}|%`,
    ]);
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { checkCredentials } = _req('src/account/loginCheck.js');
  const lim = _req('src/account/loginLimiter.js');

  await t.test('20 concurrent failed attempts, at most 5 checks', async () => {
    const anfrage = { ip: '203.0.113.7', socket: {}, headers: {} };
    const r = await Promise.all(Array.from({ length: 20 }, () => checkCredentials(anfrage, NAME, 'falsch')));
    const geprueft = r.filter(x => x.refusal?.kind === 'not_signed_in').length;
    const gesperrt = r.filter(x => x.refusal?.kind === 'too_many').length;
    assert.ok(geprueft <= lim.MAX_ATTEMPTS, `${geprueft} Passwortprüfungen, ${gesperrt} gesperrt`);
    assert.equal(geprueft + gesperrt, 20);
  });

  await t.test('confirmation: 20 concurrent attempts, at most 5 free', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => lim.confirmationLocked(uid)));
    const frei = r.filter(x => x === null).length;
    assert.ok(frei <= lim.MAX_ATTEMPTS, `${frei} Versuche durchgelassen`);
  });
});
