/**
 * QR login with confirmation in the browser: the scan alone gives no token.
 * The app registers and shows a code; only when the logged-in session
 * types it in does the app pick up its access. A wrong code counts, after
 * three the pairing is rejected; the pairing of another account cannot
 * be seen and cannot be confirmed.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  in holeQrTokenAb() (src/account/qrPairing.ts) `wartet` treated like `bestaetigt`
 *      too → red: “without confirmation no token”
 *   B  codeFits() always returns true → red: “a wrong code counts …”
 *   C  qrPairingOfAccount() without `AND user_id = $2` → red: “another account's pairing …”
 *   D  in melde() (repository) `used_at IS NULL` deleted → red: “a code reports only one device”
 *   E  (11.11.2026) in /qr-login/abholen `vorschau` not passed on → red: “the preview
 *      names the account …” (token already in the preview)
 *   F  (11.11.2026) markRejected() deleted in discardPickup() → red: “a no
 *      from the app …” (picking up gives a token after all)
 *   G  (11.11.2026) in putQrPairingAn() the count condition deleted → red:
 *      “above the limit of open pairings …” (200 instead of 503)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('QR pairing with confirmation', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAMEN = [`qrk_${process.pid}`, `qrk2_${process.pid}`];
  const PASS = 'Kopplung-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // The throttles count per address across test files (serial run on one database).
  await db.run(`DELETE FROM rate_limit_attempts WHERE key ~ '^(qr-login|qr-abholen)\\|'`);
  const ids = [];
  for (const n of NAMEN)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
      VALUES ($1, $2, true, true) RETURNING id`,
          [n, await bcrypt.hash(PASS, 4)],
        )
      ).id,
    );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
    await db.pool.end().catch(() => {});
  });
  const sitzung = { userId: ids[0], username: NAMEN[0] };
  const { base } = testServer(_req, { sitzung, t });
  // Via IPv4: with „localhost“ the CI runner asks via ::1, and the checked network would be 0:0:0::/48.
  const adresse = base.replace('localhost', '127.0.0.1');
  const ruf = async (methode, pfad, body) => {
    const r = await fetch(`${adresse}/api/v1/auth${pfad}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const newCode = async () => {
    const qr = await ruf('POST', '/qr-token', { password: PASS });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    return qr.body;
  };
  const melde = async qr => {
    const m = await ruf('POST', '/qr-login', { token: qr.token, label: 'Pixel Probe' });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    return m.body;
  };
  const abholen = m => ruf('POST', '/qr-login/abholen', { abholung: m.abholung });
  const confirm = (qr, code) => ruf('POST', `/qr-kopplung/${qr.kopplung}/bestaetigen`, { code });

  await t.test('without confirmation no token, afterwards exactly one', async () => {
    const qr = await newCode();
    const m = await melde(qr);
    assert.equal(m.token, undefined, 'Der Scan allein gibt keinen Token');
    assert.match(m.code, /^\d{6}$/);
    const vorher = await abholen(m);
    assert.deepEqual([vorher.status, vorher.body.wartet, vorher.body.token], [200, true, undefined]);
    const stand = await ruf('GET', `/qr-kopplung/${qr.kopplung}`);
    assert.deepEqual(
      [stand.body.stand, stand.body.geraet, stand.body.ip_range],
      ['wartet', 'Pixel Probe', '127.0.0.0/24'],
    );
    assert.equal((await confirm(qr, m.code)).status, 200);
    const da = await abholen(m);
    assert.equal(da.status, 200, JSON.stringify(da.body));
    assert.equal(da.body.userId, ids[0]);
    assert.equal(da.body.token_info.scope, 'app');
    const zeile = await db.get('SELECT label FROM api_tokens WHERE token = $1', [
      _req('src/account/deviceToken.js').tokenDigest(da.body.token),
    ]);
    assert.equal(zeile.label, 'Pixel Probe');
    assert.equal((await abholen(m)).status, 401, 'Ein zweites Abholen gibt keinen zweiten Token');
  });

  await t.test('the preview names the account, the token only comes with the yes', async () => {
    const qr = await newCode();
    const m = await melde(qr);
    const vorschau = { abholung: m.abholung, vorschau: true };
    assert.equal((await ruf('POST', '/qr-login/abholen', vorschau)).body.wartet, true);
    assert.equal((await confirm(qr, m.code)).status, 200);
    for (let i = 0; i < 2; i++) {
      const v = await ruf('POST', '/qr-login/abholen', vorschau);
      assert.equal(v.status, 200, JSON.stringify(v.body));
      assert.deepEqual([v.body.username, v.body.vorschau, v.body.token], [NAMEN[0], true, undefined]);
    }
    const ja = await abholen(m);
    assert.equal(ja.status, 200, JSON.stringify(ja.body));
    assert.equal(ja.body.username, NAMEN[0]);
    // The nonce for the device key belongs to the family of the new token.
    const n = await db.get(
      `SELECT n.from_qr FROM device_nonces n JOIN api_tokens t ON t.user_id = n.user_id
         AND date_trunc('milliseconds', t.created_at) = n.token_family WHERE n.nonce = $1 AND t.token = $2`,
      [ja.body.schluessel_nonce, _req('src/account/deviceToken.js').tokenDigest(ja.body.token)],
    );
    assert.equal(n?.from_qr, true);
  });

  await t.test('a no from the app discards the pairing, no token is created', async () => {
    const qr = await newCode();
    const m = await melde(qr);
    assert.equal((await confirm(qr, m.code)).status, 200);
    const tokens = async () =>
      (await db.get('SELECT count(*)::int AS n FROM api_tokens WHERE user_id = $1', [ids[0]])).n;
    const vorher = await tokens();
    assert.equal((await ruf('POST', '/qr-login/abholen', { abholung: m.abholung, vorschau: true })).status, 200);
    assert.equal((await ruf('POST', '/qr-login/verwerfen', { abholung: m.abholung })).status, 200);
    const r = await abholen(m);
    assert.deepEqual([r.status, r.body.code], [403, 'qr_abgelehnt']);
    assert.equal(await tokens(), vorher);
    assert.equal((await ruf('GET', `/qr-kopplung/${qr.kopplung}`)).body.stand, 'abgelehnt');
    assert.equal((await ruf('POST', '/qr-login/verwerfen', { abholung: 'unbekannt' })).status, 401);
  });

  await t.test('a code reports only one device', async () => {
    const qr = await newCode();
    await melde(qr);
    assert.equal((await ruf('POST', '/qr-login', { token: qr.token })).status, 401);
  });

  await t.test('a wrong code counts, after three the pairing is rejected', async () => {
    const qr = await newCode();
    const m = await melde(qr);
    const falsch = m.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 2; i++) assert.deepEqual([(await confirm(qr, falsch)).body.code], ['qr_code_falsch']);
    assert.equal((await confirm(qr, falsch)).body.code, 'qr_abgelehnt');
    assert.equal((await confirm(qr, m.code)).status, 409, 'Nach der Ablehnung hilft auch der richtige Code nicht');
    const r = await abholen(m);
    assert.deepEqual([r.status, r.body.code], [403, 'qr_abgelehnt']);
  });

  await t.test('rejecting in the browser ends the pairing', async () => {
    const qr = await newCode();
    const m = await melde(qr);
    assert.equal((await ruf('POST', `/qr-kopplung/${qr.kopplung}/ablehnen`, {})).status, 200);
    assert.equal((await abholen(m)).status, 403);
  });

  await t.test("another account's pairing can neither be seen nor confirmed", async () => {
    const qr = await newCode();
    const m = await melde(qr);
    Object.assign(sitzung, { userId: ids[1], username: NAMEN[1] });
    try {
      assert.equal((await ruf('GET', `/qr-kopplung/${qr.kopplung}`)).status, 404);
      assert.equal((await confirm(qr, m.code)).status, 404);
    } finally {
      Object.assign(sitzung, { userId: ids[0], username: NAMEN[0] });
    }
    assert.equal((await abholen(m)).body.wartet, true);
  });

  await t.test('above the limit of open pairings there is 503, collected ones do not count', async tt => {
    const { OPEN_PAIRINGS_AT_MOST } = _req('src/account/qrPairing.js');
    await db.run(`DELETE FROM qr_login_tokens`);
    tt.after(() => db.run(`DELETE FROM qr_login_tokens`));
    await db.run(
      `INSERT INTO qr_login_tokens (token, user_id, expires_at, picked_up_at)
      SELECT 'abgeholt' || g, $1, NOW() + INTERVAL '5 minutes', NOW() FROM generate_series(1, 5) g`,
      [ids[1]],
    );
    await db.run(
      `INSERT INTO qr_login_tokens (token, user_id, expires_at)
      SELECT 'voll' || g, $1, NOW() + INTERVAL '5 minutes' FROM generate_series(1, $2::int - 1) g`,
      [ids[1], OPEN_PAIRINGS_AT_MOST],
    );
    await newCode();
    const r = await ruf('POST', '/qr-token', { password: PASS });
    assert.deepEqual([r.status, r.body?.code], [503, 'server_ausgelastet']);
    await db.run(`UPDATE qr_login_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token LIKE 'voll%'`);
    await newCode();
  });
});
