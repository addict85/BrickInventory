/**
 * Recovery codes of the old kind (before 01.11.2026: 10 characters, unsalted SHA-256)
 * only apply until `old_valid_until` (migration 0122, src/factors/secondFactor.ts). Whoever logs in with
 * one gets a mail with the deadline; the profile page names it. A code of the new
 * kind lifts the deadline for its set. Via the real login.
 *
 * Counter-checks (measured 16.11.2026, each on its own):
 *   A  in verbraucheCode the condition `old_valid_until > NOW()` deleted → red: “an expired
 *      code of the old kind no longer applies” (200 instead of 401)
 *   B  in anmeldepruefung.ts the mail for 'wiederherstellung_alt' deleted → red: “a code
 *      of the old kind applies until the deadline, with mail …”
 *   C  pruefeCode without codesSindNeu() → red: “a code of the new kind lifts the deadline …”
 *   D  in 0122 the check for the already existing column deleted → red: “the migration
 *      is repeatable …” (column already exists)
 *   E  (27.11.2026) the `old_codes_expiry` mail delayed by 200 ms in loginCheck.ts, so `token_added`
 *      arrives first as under load in CI → red with the old wait for any mail, green with this one
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { until } = require('./helpers/time');

const sent = [];
S.replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (_an, _name, type, o) => {
    sent.push({ type, until: o.bis });
    return { success: true };
  },
});
const db = S.testData();
const { hashPassword } = _req('src/account/passwordHash.js');
const { searchValue } = _req('src/infra/secret.js');

test('recovery codes of the old kind expire', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `altcode_${process.pid}`,
    PASS = 'Alte-Codes-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
       VALUES ($1, $1 || '@beispiel.de', $2, true, true) RETURNING id`,
      [NAME, await hashPassword(PASS)],
    )
  ).id;
  await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [uid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts').catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const alt = code => crypto.createHash('sha256').update(code.replace(/-/g, '')).digest('hex');
  const code = async (hash, deadline) =>
    db.run('INSERT INTO second_factor_codes (user_id, code_hash, old_valid_until) VALUES ($1, $2, $3)', [
      uid,
      hash,
      deadline,
    ]);
  const { base } = testServer(_req, { session: {}, t });
  const signIn = async c => {
    await db.run('DELETE FROM rate_limit_attempts');
    const r = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, code: c, without_token: false, label: 'Probe' }),
    });
    return r.status;
  };
  // The login with a token also mails `token_added`, in the background too: which of the two
  // arrives first varies under load, so wait for this one and look only at it.
  const expiryMails = () => sent.filter(g => g.type === 'old_codes_expiry');
  const waitOnMail = () => until(() => expiryMails().length > 0, 1000);

  await t.test('a code of the old kind applies until the deadline, with mail and hint in the profile', async () => {
    const until = new Date(Date.now() + 3 * 86_400_000);
    await code(alt('abcde12345'), until);
    await code(alt('fghij67890'), until);
    sent.length = 0;
    assert.equal(await signIn('abcde-12345'), 200);
    await waitOnMail();
    assert.deepEqual(
      expiryMails().map(g => [g.type, Date.parse(g.until)]),
      [['old_codes_expiry', until.getTime()]],
    );
    const state = await S.asAccount(uid, () => _req('src/factors/secondFactor.js').status(uid));
    assert.equal(Date.parse(state.old_codes_until), until.getTime());
  });

  await t.test('an expired code of the old kind no longer applies', async () => {
    await code(alt('klmno13579'), new Date(Date.now() - 60_000));
    assert.equal(await signIn('klmno-13579'), 401);
  });

  await t.test('a code of the new kind lifts the deadline for its set', async () => {
    await db.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
    const fresh = 'abcd-efgh-ijkl-mnop';
    const deadline = new Date(Date.now() + 86_400_000);
    await code(searchValue('zweiter-faktor-code', `${uid}:${fresh.replace(/-/g, '')}`), deadline);
    await code('anderer-code-desselben-satzes', deadline);
    assert.equal(await signIn(fresh), 200);
    const state = await S.asAccount(uid, () => _req('src/factors/secondFactor.js').status(uid));
    assert.deepEqual([state.codes_left, state.old_codes_until], [1, null]);
  });

  await t.test('the migration is repeatable and leaves new codes without a deadline', async () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '0122-alte-wiederherstellungscodes-befristet.sql'),
      'utf8',
    );
    await db.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
    await code('neu-ohne-frist', null);
    // The migration still knows the names from before 0124; for the repeatability
    // test rename back briefly, then immediately back again.
    await db.run(`ALTER TABLE second_factor_codes RENAME TO zweiter_faktor_codes;
                  ALTER TABLE zweiter_faktor_codes RENAME COLUMN old_valid_until TO alt_gilt_bis;
                  ALTER TABLE zweiter_faktor_codes RENAME COLUMN consumed_at TO verbraucht_am`);
    try {
      await db.run(sql);
    } finally {
      await db.run(`ALTER TABLE zweiter_faktor_codes RENAME COLUMN alt_gilt_bis TO old_valid_until;
                    ALTER TABLE zweiter_faktor_codes RENAME COLUMN verbraucht_am TO consumed_at;
                    ALTER TABLE zweiter_faktor_codes RENAME TO second_factor_codes`);
    }
    const z = await db.get('SELECT old_valid_until FROM second_factor_codes WHERE user_id = $1', [uid]);
    assert.equal(z.old_valid_until, null);
  });
});
