/**
 * „Passwort vergessen“ also ends what an intruder may have left behind on the account:
 * main accounts under which he hung it (they see and change the inventory), open
 * invitations and a pending address change. The mail to the account names everything. The
 * normal password change of the logged-in owner leaves the household standing.
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in setPasswordBack() unlinkForeignAccess() replaced by an empty result → red:
 *      “the foreign main account … sees …”, “open invitations …”, “the mail names …”
 *   B  in resolveSubAccountAndInvitations() `sub_user_id` replaced by `main_user_id` → red:
 *      “the foreign main account …”, “the own sub-account stays”, “the mail names …”
 *   C  discardPendingAddress() replaced by null → red: “the pending address change
 *      is discarded”, “the mail names …”
 *   D  the DELETE on account_link_invites replaced by nothing → red: “open invitations …”,
 *      “the mail names …”
 *   E  the household part switched off in geloestSatz() → red: “the mail names …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { environment, testData, buildAndRequire } = require('./helpers/sources');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailAttrappe, enterMailServer } = require('./helpers/mail-fake');
const { bis } = require('./helpers/time');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test.after(() => db.pool.end().catch(() => {}));

test('forgot password removes foreign access', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const gesendet = mailAttrappe();
  t.after(await enterMailServer(db));
  const P = process.pid;
  const namen = [`pv_opfer_${P}`, `pv_fremd_${P}`, `pv_kind_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  t.after(() => db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {}));
  const hash = await bcrypt.hash('altes-Passwort-17', 4);
  const ids = [];
  for (const n of namen)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, email, password_hash, is_active, email_verified)
           VALUES ($1, $2, $3, true, true) RETURNING id`,
          [n, `${n}@example.org`, hash],
        )
      ).id,
    );
  const [V, A, K] = ids;
  // The intruder hung V under his account A; V itself is the main account of K.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($2, $3)', [A, V, K]);
  await db.run(
    `INSERT INTO account_link_invites (token_hash, main_user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
    [`pv-einladung-${P}`, V],
  );
  await db.run(
    `UPDATE users SET new_email = $2, new_email_token = 'x', new_email_until = NOW() + INTERVAL '1 day' WHERE id = $1`,
    [V, `boese-${P}@example.org`],
  );
  const K_ = _req('src/account/accounts.js');
  const H = _req('src/household/household.js');
  const { inSystemContext } = _req('src/infra/accountContext.js');
  const mainAccountsOf = () => inSystemContext('test', () => H.householdOf(A)).then(h => h.memberIds.includes(V));

  await t.test('the normal password change leaves the household', async () => {
    await K_.aendereEigenesPasswort(V, 'zwischen-Passwort-17');
    assert.equal(await mainAccountsOf(), true);
  });

  const link = `pv-link-${P}`;
  await db.run(`UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`, [
    _req('src/account/deviceToken.js').tokenDigest(link),
    V,
  ]);
  const { base } = testServer(_req, { t });
  const r = await fetch(`${base}${AUTH}/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: link, password: 'neues-Passwort-nach-Link-17' }),
  });
  assert.equal(r.status, 200, await r.clone().text());

  await t.test('the foreign main account no longer sees the inventory', async () => {
    assert.equal((await db.all('SELECT 1 FROM account_links WHERE sub_user_id = $1', [V])).length, 0);
    assert.equal(await mainAccountsOf(), false);
  });
  await t.test('the own sub-account stays', async () => {
    assert.equal(
      (await db.all('SELECT 1 FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [V, K])).length,
      1,
    );
  });
  await t.test('open invitations are discarded', async () => {
    assert.equal((await db.all('SELECT 1 FROM account_link_invites WHERE main_user_id = $1', [V])).length, 0);
  });
  await t.test('the pending address change is discarded', async () => {
    const z = await db.get('SELECT email, new_email, new_email_token FROM users WHERE id = $1', [V]);
    assert.deepEqual(z, { email: `${namen[0]}@example.org`, new_email: null, new_email_token: null });
  });
  await t.test('the mail names what was removed', async () => {
    const an = () => gesendet.find(m => m.to === `${namen[0]}@example.org` && /zurückgesetzt/.test(m.text));
    assert.ok(await bis(() => !!an(), 10_000), 'keine Mail an das Konto');
    const text = an().text;
    assert.match(text, new RegExp(`„${namen[1]}“`), 'das gelöste Hauptkonto fehlt');
    assert.match(text, new RegExp(`boese-${P}@example\\.org`), 'die verworfene Adresse fehlt');
    assert.match(text, /1 offene Haushaltseinladung/);
    assert.doesNotMatch(text, new RegExp(namen[2]), 'das eigene Unterkonto ist nicht gelöst');
  });
});
