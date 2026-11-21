/**
 * An open reset link (1 h) falls as soon as the password is set anew
 * in another way or a new email address is confirmed. Otherwise a link to
 * an abandoned address or from the time before an admin reset stayed valid.
 *
 * Counter-check (measured 01.11.2026): OHNE_RUECKSETZLINK in
 * src/account/repository/accounts.ts set to an empty addition
 * (`reset_token = reset_token`) → red: all three paths (200 instead of 400).
 * Counter-check (measured 11.11.2026): the state cded051 (token read in the route,
 * password written afterwards via `WHERE id = …`) → red: “two
 * concurrent …” (both 200).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const K = { ..._req('src/account/accounts.js'), ...require('./helpers/sources').testArea('account').konten };
const { tokenDigest } = _req('src/account/deviceToken.js');

test('reset links fall with password and address change', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const namen = [];
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { t });
  /** An account with an open link; the change runs, then the link is redeemed. */
  const afterSwitch = async (name, wechsel) => {
    namen.push(name);
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
    const token = crypto.randomBytes(32).toString('hex');
    assert.ok(await K.setRuecksetzTokenIfFree(uid, tokenDigest(token), 60, 15));
    await wechsel(uid);
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
    const r = await fetch(`${base}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: 'Neu-Sicher-2026x' }),
    });
    return [r.status, (await r.json()).code ?? null];
  };
  const p = process.pid;

  await t.test('without a change the link applies (precondition)', async () => {
    assert.deepEqual(await afterSwitch(`link_ohne_${p}`, async () => {}), [200, null]);
  });

  await t.test('own password, admin reset, new address: the link falls', async () => {
    assert.deepEqual(
      [
        await afterSwitch(`link_eigen_${p}`, uid => K.aendereEigenesPasswort(uid, 'Eigenes-Neu-2026')),
        await afterSwitch(`link_fremd_${p}`, uid => K.setForeignPassword(uid, 'Verwalter-Neu-2026')),
        await afterSwitch(`link_mail_${p}`, async uid => {
          await K.rememberEmailNew(uid, `neu_${p}@example.org`, tokenDigest(`mail${p}`), new Date(Date.now() + 60_000));
          assert.equal(
            !!(await require('./helpers/sources')
              .testArea('account')
              .verifyEmailToken(`mail${p}`)
              .catch(() => null)),
            true,
          );
        }),
      ],
      [
        [400, 'token_ungueltig'],
        [400, 'token_ungueltig'],
        [400, 'token_ungueltig'],
      ],
    );
  });

  await t.test('two concurrent requests with the same link: only one sets its password', async () => {
    const name = `link_doppelt_${p}`;
    namen.push(name);
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
    const token = crypto.randomBytes(32).toString('hex');
    assert.ok(await K.setRuecksetzTokenIfFree(uid, tokenDigest(token), 60, 15));
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
    const setze = password =>
      fetch(`${base}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      }).then(async r => [r.status, (await r.json()).code ?? null, password]);
    const antworten = await Promise.all([setze('Erstes-Neu-2026x'), setze('Zweites-Neu-2026x')]);
    assert.deepEqual(antworten.map(a => a[0]).sort(), [200, 400], JSON.stringify(antworten));
    const sieger = antworten.find(a => a[0] === 200)[2];
    const { password_hash } = await db.get('SELECT password_hash FROM users WHERE id = $1', [uid]);
    assert.ok(
      await _req('src/account/passwordHash.js').passwordFits(sieger, password_hash),
      'es gilt das Passwort der Anfrage, die 200 bekam',
    );
  });
});
