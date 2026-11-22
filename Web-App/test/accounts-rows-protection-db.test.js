/**
 * In users the runtime role sees only the own account, the directly linked ones and the
 * separated ones named by the household view, and in account_links only links with the
 * own account; addresses and links are read only by the system role (migration 0121). The app's
 * paths that need foreign names (check invitation, household view) keep working.
 *
 * Counter-checks (measured 16.11.2026, each alone):
 *   A  in 0121 the policy on users replaced by `USING (true)` → red: “injected SQL
 *      sees only own account and household” (all four accounts visible)
 *   B  in 0121 the policy `lesen` on account_links unchanged (USING true) → red: the same
 *      check (the foreign link is visible)
 *   C  in 0121 the REVOKE of the address columns deleted → red: “… addresses not”
 *   D  in src/household/household.ts checkInvitation back with repo.accountName (runtime role)
 *      → red: “whoever is invited learns the name …” (the identifier instead of the name)
 *   E  in 0121 household_former_links deleted from the policy → red: “the household view
 *      names sub-accounts and separated …” (former_links empty)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = S.testData();
const { asRequest } = _req('src/infra/accountContext.js');

test('accounts only in the own household', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid;
  const namen = ['haupt', 'unter', 'fremd', 'frueher', 'fremdunter'].map(n => `kz_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, email, password_hash, is_active, email_verified)
           VALUES ($1, $1 || '@beispiel.de', 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  const [haupt, unter, fremd, frueher, fremdunter] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($3, $4)', [
    haupt,
    unter,
    fremd,
    fremdunter,
  ]);
  await db.run('INSERT INTO household_former_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, frueher]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const zugang = S.testAccess();
  const als = (uid, f) => asRequest({ session: { userId: uid } }, f);

  await t.test('injected SQL only sees the own account and household', async () => {
    const sicht = async uid => ({
      konten: (await als(uid, () => zugang.all('SELECT id FROM users WHERE id = ANY($1) ORDER BY id', [ids]))).map(
        z => z.id,
      ),
      links: (
        await als(uid, () =>
          zugang.all('SELECT main_user_id AS m FROM account_links WHERE main_user_id = ANY($1) ORDER BY 1', [ids]),
        )
      ).map(z => z.m),
    });
    assert.deepEqual(await sicht(haupt), { konten: [haupt, unter, frueher], links: [haupt] });
    assert.deepEqual(await sicht(unter), { konten: [haupt, unter], links: [haupt] });
    assert.deepEqual(await sicht(fremd), { konten: [fremd, fremdunter], links: [fremd] });
  });

  await t.test('… not addresses, not even the own one; names only on the own account', async () => {
    await assert.rejects(
      als(haupt, () => zugang.get('SELECT email FROM users WHERE id = $1', [haupt])),
      /permission denied/,
    );
    await als(haupt, () => zugang.run('UPDATE users SET first_name = $2 WHERE id = ANY($1)', [[haupt, unter], 'Neu']));
    const firstNames = await db.all('SELECT id, first_name FROM users WHERE id = ANY($1) ORDER BY id', [
      [haupt, unter],
    ]);
    assert.deepEqual(
      firstNames.map(z => z.first_name),
      ['Neu', null],
    );
  });

  await t.test('whoever is invited learns the name of the inviter', async () => {
    const haushalt = { ..._req('src/household/household.js'), ...S.testArea('household') };
    const { code } = await S.asAccount(fremd, () => haushalt.createInvitation(fremd));
    const { base } = testServer(_req, { sitzung: { userId: haupt, username: namen[0] }, t });
    const r = await fetch(`${base}/api/v1/settings/household/redeem/pruefen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await r.json();
    assert.deepEqual([r.status, body.inviter?.username], [200, namen[2]], JSON.stringify(body));
  });

  await t.test('the household view names sub-accounts and separated accounts by name', async () => {
    const { base } = testServer(_req, { sitzung: { userId: haupt, username: namen[0] }, t });
    const body = await (await fetch(`${base}/api/v1/settings/household`)).json();
    assert.deepEqual(
      [body.sub_accounts?.map(k => k.username), body.former_links?.map(k => k.username)],
      [[namen[1]], [namen[3]]],
      JSON.stringify(body),
    );
  });
});
