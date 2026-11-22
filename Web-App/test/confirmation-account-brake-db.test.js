/**
 * The brake for password confirmations applies per access AND across all accesses
 * of an account; if an access or the account reaches it, the owner learns of it
 * (at most once a day), and the log records it. An access without
 * own failed attempts keeps confirming.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in confirmationLocked() the account limit deleted → red: “across
 *      many accesses at most 20 …” (the 21st attempt is checked, 400) and
 *      “mail and log …”
 *   B  condition `s.count > 0` deleted → red: “the owner's clean
 *      access …” (429 instead of 200)
 *   C  in gebremst() hintInBackground() removed → red: “mail and
 *      log …” (no mail)
 *   D  accountThrottled() removed before the mail → red: “mail and log …”
 *      (two mails)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
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
const db = S.testData();
const { dataOrSkip } = require('./helpers/db');
const protokoll = _req('src/infra/log.js');
const { checkConfirmation } = _req('src/account/passwordConfirmation.js');
const { STATUS_THE_KIND } = _req('src/http/errorKind.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const PASS = 'Konto-Bremse-Passwort-1',
  FALSCH = 'Falsch-geraten-0815';

test('brake for confirmations per account', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `kbremse_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  const leere = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key = $3`, [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen-konto|${uid}`,
      `bestaetigung-hinweis|konto:${uid}`,
    ]);
  await leere();
  const zeilen = [];
  const zurueck = protokoll.installLog({ out: () => {}, err: z => zeilen.push(z), now: () => Date.now() });
  t.after(async () => {
    zurueck();
    await leere();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const versuch = async (zugang, pw = FALSCH) =>
    STATUS_THE_KIND[(await checkConfirmation(uid, zugang, pw, {}))?.kind] ?? 200;

  await t.test('across many accesses at most 20 failed attempts per day', async () => {
    const ist = [];
    // Five accesses with four attempts each: none reaches its own limit (5).
    for (let z = 0; z < 5; z++) for (let i = 0; i < 4; i++) ist.push(await versuch(`t:${z}`));
    assert.deepEqual([...new Set(ist)], [400]);
    assert.equal(await versuch('t:0'), 429, 'der 21. Versuch aus einem ratenden Zugang');
    assert.equal(await versuch('t:4', PASS), 429, 'auch mit dem richtigen Passwort, ohne Prüfung');
  });

  await t.test("the owner's clean access keeps confirming", async () => {
    assert.equal(await versuch('s:inhaber', PASS), 200);
  });

  await t.test('mail and log on reaching the brake, the mail once a day', async () => {
    for (let i = 0; i < 40 && mails.length < 1; i++) await new Promise(r => setTimeout(r, 25));
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(mails, [{ an: `${NAME}@example.org`, kind: 'confirmation_throttled' }]);
    const gebremst = zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === 'confirmation_throttled');
    assert.deepEqual(
      gebremst.map(z => [z.kontext.konto, z.kontext.kind]),
      [[uid, 'passwort']],
    );
    // Afterwards one access reaches its own limit: log yes, second mail no.
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2`, [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen-konto|${uid}`,
    ]);
    for (let i = 0; i < 5; i++) await versuch('t:neu');
    await new Promise(r => setTimeout(r, 200));
    assert.equal(mails.length, 1, JSON.stringify(mails));
    assert.equal(
      zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === 'confirmation_throttled').length,
      2,
    );
  });
});
