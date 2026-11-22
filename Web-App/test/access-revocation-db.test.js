/**
 * Revoking app accesses: only the full identifier from the device list, a
 * foreign access only with password, the own one without. “All others” goes in
 * one confirmed request and leaves the own access in place. The owner
 * gets a hint.
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in PATH (src/contract/base.ts) tokenId back to /^[A-Za-z0-9_-]{1,64}$/
 *      → red: “a prefix of the identifier is rejected” (200 instead of 400)
 *   B  in DELETE /settings/tokens/:tokenId the confirmation deleted → red:
 *      “a foreign access needs the password” (200, access gone)
 *   C  hintInBackground() deleted on revocation → red: “… the owner
 *      gets a hint”
 *   D  in andere-beenden `null` instead of the own hash passed to
 *      deleteOtherAccesses → red: “all others: … the own one stays”
 *   E  deleteAccess without `user_id = $1` → red: “a foreign account
 *      revokes nothing”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();

const gesendet = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, kind, o) => {
    gesendet.push({ an, kind, name: o.passkey });
    return { success: true };
  },
});

const db = S.testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const { testServer } = require('./helpers/server');
const { dataOrSkip } = require('./helpers/db');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Widerruf-Passwort-1';
const NAMEN = [`widerruf_a_${process.pid}`, `widerruf_b_${process.pid}`];

test('revoking app accesses', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
          [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)],
        )
      ).id,
    );
  const [uidA, uidB] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db
      .run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [`%|${uidA}|%`, `%|${uidB}|%`])
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: {}, t });
  const ruf = async (methode, weg, token, body) => {
    const r = await fetch(base + '/api/v2' + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const kennung = token => auth.tokenDigest(token).slice(0, 16);
  const gilt = async token => {
    tokenCache.emptyTokenCache();
    return (await ruf('GET', '/settings/tokens', token)).status === 200;
  };
  const hints = async (kind, count) => {
    for (let i = 0; i < 60 && gesendet.filter(m => m.kind === kind).length < count; i++)
      await new Promise(r => setTimeout(r, 25));
    return gesendet.filter(m => m.kind === kind);
  };

  const eigen = await auth.createToken(uidA, 'Telefon', true);
  const fremd = await auth.createToken(uidA, 'Tablet', true);

  await t.test('a prefix of the identifier is rejected', async () => {
    for (const teil of ['0', kennung(fremd).slice(0, 1), kennung(fremd).slice(0, 15), kennung(fremd).toUpperCase()]) {
      const r = await ruf('DELETE', `/settings/tokens/${teil}`, eigen, { password: PASS });
      assert.equal(r.status, 400, `${teil}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(await gilt(fremd), true, 'ein Präfix hat den Zugang widerrufen');
  });

  await t.test('a foreign access needs the password', async () => {
    const ohne = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen);
    assert.ok(ohne.status >= 400 && ohne.status < 500, JSON.stringify(ohne.body));
    const falsch = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen, { password: 'falsch-falsch-1' });
    assert.ok(falsch.status >= 400 && falsch.status < 500, JSON.stringify(falsch.body));
    assert.equal(await gilt(fremd), true, 'ohne richtiges Passwort widerrufen');
  });

  await t.test('a foreign account revokes nothing', async () => {
    const tokB = await auth.createToken(uidB, 'Fremd', true);
    const r = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, tokB, { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deleted, 0);
    assert.equal(await gilt(fremd), true, 'ein anderes Konto hat den Zugang widerrufen');
  });

  await t.test('with password it works, and the owner gets a notice', async () => {
    const r = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen, { password: PASS });
    assert.deepEqual([r.status, r.body.deleted], [200, 1], JSON.stringify(r.body));
    assert.equal(await gilt(fremd), false);
    assert.equal(await gilt(eigen), true, 'der eigene ist mitgegangen');
    assert.deepEqual(await hints('access_ended', 1), [
      { an: `${NAMEN[0]}@example.org`, kind: 'access_ended', name: 'Tablet' },
    ]);
  });

  await t.test('the device ends its own access without password', async () => {
    const kurz = await auth.createToken(uidA, 'Abmelden', true);
    const r = await ruf('DELETE', `/settings/tokens/${kennung(kurz)}`, kurz);
    assert.deepEqual([r.status, r.body.deleted], [200, 1], JSON.stringify(r.body));
    assert.equal(await gilt(kurz), false);
    assert.equal((await hints('access_ended', 2)).length, 1, 'das eigene Abmelden meldet sich als fremder Widerruf');
  });

  await t.test('all others: one confirmed call, the own one stays', async () => {
    const x = await auth.createToken(uidA, 'X', true),
      y = await auth.createToken(uidA, 'Y', true);
    const ohne = await ruf('POST', '/settings/sessions/end-others', eigen, { accesses: true });
    assert.ok(ohne.status >= 400 && ohne.status < 500, JSON.stringify(ohne.body));
    assert.equal(await gilt(x), true, 'ohne Passwort beendet');
    const r = await ruf('POST', '/settings/sessions/end-others', eigen, { password: PASS, accesses: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.accesses, 2);
    assert.deepEqual([await gilt(x), await gilt(y), await gilt(eigen)], [false, false, true]);
    assert.equal((await hints('accesses_ended', 1)).length, 1);
  });
});
