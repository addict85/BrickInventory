/**
 * Idempotency-Key and secrets: no access, no TOTP secret and no
 * recovery code stands in plain text in the database; stored
 * responses are encrypted; the repetition of a route with a secret
 * gets 409 instead of a second run.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  dienst.ts and middleware.ts at state e21f747 → red: all five cases,
 *      first “the TOTP secret stands in no column" (idempotency: 1)
 *   B  responseIsSecret() always returns false → red: cases 1–3 (the body is stored,
 *      albeit encrypted; the repetition gets 200 with replay)
 *   C  verschluessele() omitted in beende() → red: cases 4 and 5
 *   D  migration 0086 replaced by `SELECT 1;` → red: case 5
 *   E  `geheim` removed from /auth/zweiter-faktor/codes in the contract → red:
 *      “every writing route …" (the route stands in the list of missing ones)
 *
 * Counter-check (measured 03.11.2026):
 *   J  routeForRequest() always returns undefined → red: the first four
 *      subtests and “every writing route …”
 *
 * Counter-checks for the fingerprint (measured 02.11.2026), each red: “the
 * fingerprint does not reveal the password”:
 *   F  withoutSecrets() leaves password fields in place
 *   G  suchwert() replaced by the mere text (no HMAC)
 *   H  deleteOldFingerprints() deletes nothing
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ DATA_KEY: Buffer.alloc(32, 7).toString('base64') });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const secret = _req('src/infra/secret.js');
const { idempotency, responseIsSecret } = _req('src/idempotency/http/middleware.js');
const { notRetryable } = _req('src/contract/base.js');
const { CONTRACT } = _req('src/contract/index.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** How often the text stands in any column of any table. */
async function occurrences(text) {
  const tables = await db.all(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const hits = [];
  for (const { tablename } of tables) {
    const n = (await db.get(`SELECT count(*)::int n FROM "${tablename}" x WHERE x::text LIKE '%' || $1 || '%'`, [text]))
      .n;
    if (n) hits.push(`${tablename}: ${n}`);
  }
  return hits;
}

test('Idempotency-Key without secrets in plaintext', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `idem_geheim_${process.pid}`,
    PASS = 'Geheim-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    if (!req.originalUrl.startsWith('/api/v2/auth')) req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', idempotency(require('./helpers/sources').testServices().idempotency));
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const post = (path, key, body, method = 'POST') =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v2${path}`, {
      method: method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    }).then(async r => ({ status: r.status, replay: r.headers.get('idempotent-replay'), body: await r.json() }));
  const row = k => db.get('SELECT status, response FROM idempotency WHERE user_id = $1 AND key = $2', [uid, k]);

  await t.test('the repetition gets neither PIN nor response', async () => {
    const fresh = await post('/vouchers', 'v-1', {
      number: '1234567890123456',
      pin: '4321',
      amount: 20,
      currency: 'CHF',
    });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    const path = `/vouchers/${fresh.body.voucher.id}/plaintext`;
    const erst = await post(path, 'k-1', {});
    assert.deepEqual([erst.status, erst.body.pin], [200, '4321'], JSON.stringify(erst.body));
    assert.deepEqual(await row('k-1'), { status: 200, response: null });
    const wrong = await post(path, 'k-1', {});
    assert.equal(wrong.status, 409, JSON.stringify(wrong.body));
    assert.equal(wrong.body.code, 'idempotency_not_repeatable');
    assert.equal(wrong.replay, null);
    assert.ok(!JSON.stringify(wrong.body).includes('4321'));
  });

  let g;
  await t.test('the TOTP secret is in no column of the database', async () => {
    const r = await post('/auth/second-factor/setup', 'zf-1', { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    g = r.body.secret;
    assert.match(g, /^[A-Z2-7]{32}$/);
    assert.deepEqual(await occurrences(g), []);
    assert.deepEqual(await row('zf-1'), { status: 200, response: null });
  });

  await t.test('the repetition gets 409 instead of a second secret', async () => {
    const r = await post('/auth/second-factor/setup', 'zf-1', { password: PASS });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotency_not_repeatable');
    assert.equal(r.replay, null);
  });

  await t.test('the recovery codes are nowhere in plaintext either', async () => {
    const code = zf.hotp(zf.fromBase32(g), zf.timeStep());
    const r = await post('/auth/second-factor/confirm', 'zf-2', { code });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.codes.length, 10);
    for (const wc of r.body.codes) assert.deepEqual(await occurrences(wc), [], wc);
    assert.equal((await post('/auth/second-factor/confirm', 'zf-2', { code })).status, 409);
  });

  await t.test('ordinary responses are stored encrypted and repeated', async () => {
    const erst = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.equal(erst.status, 200, JSON.stringify(erst.body));
    assert.equal(erst.replay, null);
    const z = await row('p-1');
    assert.ok(z.response.startsWith('v2:'), z.response);
    assert.equal(
      secret.decrypt(z.response, _req('src/idempotency/service.js').responseContext(uid, 'p-1')),
      JSON.stringify(erst.body),
    );
    const again = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.deepEqual(again, { ...erst, replay: 'true' });
  });

  await t.test('the fingerprint does not reveal the password', async () => {
    const serviceFn = _req('src/idempotency/service.js');
    const path = '/api/v2/auth/second-factor/setup';
    const alt = require('node:crypto')
      .createHash('sha256')
      .update(`POST ${path}\n${JSON.stringify({ password: PASS })}`)
      .digest('hex');
    assert.deepEqual(await occurrences(alt), [], 'the SHA-256 of the body with the password is in the table');
    assert.match(
      (await db.get("SELECT request FROM idempotency WHERE user_id = $1 AND key = 'zf-1'", [uid])).request,
      /^h1:[0-9a-f]{64}$/,
    );
    const fingerprint = reqBody => serviceFn.fingerprint('POST', path, reqBody);
    assert.equal(
      fingerprint({ password: 'a', current: 'b', admin_password: 'c', code: '1', factor_code: '2', pin: '3', x: 1 }),
      fingerprint({ password: 'z', current: 'y', admin_password: 'w', code: '9', factor_code: '8', pin: '7', x: 1 }),
    );
    assert.notEqual(
      fingerprint({ password: 'a', x: 1 }),
      fingerprint({ password: 'a', x: 2 }),
      'the remaining content still counts',
    );
    const prior = fingerprint({ x: 1 });
    environment({ DATA_KEY: Buffer.alloc(32, 8).toString('base64') });
    secret._forgetKey();
    try {
      assert.notEqual(fingerprint({ x: 1 }), prior, 'recomputable without a data key');
    } finally {
      environment({ DATA_KEY: Buffer.alloc(32, 7).toString('base64') });
      secret._forgetKey();
    }

    await db.run(`INSERT INTO idempotency (user_id, key, request, status) VALUES ($1, 'sha-1', $2, 200)`, [uid, alt]);
    assert.ok((await serviceFn.deleteOldFingerprints()) >= 1);
    const remaining = (await db.all('SELECT key FROM idempotency WHERE user_id = $1 ORDER BY 1', [uid])).map(
      z => z.key,
    );
    assert.ok(!remaining.includes('sha-1') && remaining.includes('zf-1'), remaining.join(', '));
  });

  await t.test('the migration removes plaintext and the repetition is refused', async () => {
    const fingerprint = _req('src/idempotency/service.js').fingerprint('POST', '/api/v2/storage/locations', {
      name: 'Alt',
    });
    await db.run(
      `INSERT INTO idempotency (user_id, key, request, status, response)
                  VALUES ($1, 'alt-1', $2, 200, '{"token":"klartext-aus-frueher"}')`,
      [uid, fingerprint],
    );
    // At the time of 0086 encrypted was equal to v1.
    await db.run(
      `INSERT INTO idempotency (user_id, key, request, status, response) VALUES ($1, 'v1-1', 'x', 200, 'v1:AAAA')`,
      [uid],
    );
    const m0086 = fs.readFileSync(path.join(ROOT, 'db/migrations/0086-idempotenz-ohne-klartext.sql'), 'utf8');
    // The migration still knows the names from before 0124; rename back briefly, then straight back again.
    await db.run(
      'ALTER TABLE idempotency RENAME TO idempotenz; ALTER TABLE idempotenz RENAME COLUMN response TO antwort',
    );
    try {
      await db.run(m0086);
    } finally {
      await db.run(
        'ALTER TABLE idempotenz RENAME COLUMN antwort TO response; ALTER TABLE idempotenz RENAME TO idempotency',
      );
    }
    assert.deepEqual(await occurrences('klartext-aus-frueher'), []);
    assert.equal((await row('v1-1')).response, 'v1:AAAA', 'encrypted rows stay');
    const r = await post('/storage/locations', 'alt-1', { name: 'Alt' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotency_not_repeatable');
  });
});

test('every writing route with access or code is on the list', () => {
  // `code` is otherwise the error code; the invitation code therefore stands separately below.
  const SECRET_FIELDS = ['token', 'codes', 'geheimnis', 'otpauth'];
  const found = [],
    missing = [];
  for (const [key, route] of Object.entries(CONTRACT)) {
    const [method, path] = key.split(' ');
    if (method === 'GET' || !route.response?.shape) continue;
    if (!SECRET_FIELDS.some(f => f in route.response.shape)) continue;
    (responseIsSecret(method, path.replace(/:\w+/g, '1')) ? found : missing).push(key);
  }
  assert.deepEqual(missing, []);
  assert.ok(found.length >= 9, `only ${found.length} routes recognized: ${found.join(', ')}`);
  assert.equal(responseIsSecret('POST', '/api/v2/settings/household/invite'), true);
  assert.equal(responseIsSecret('POST', '/api/v2/vouchers/7/plaintext'), true);
  assert.equal(responseIsSecret('PUT', '/api/v2/parts/3001/5'), false);
});

test('only secret routes are not repeatable', () => {
  // Counter-check (26.11.2026): notRetryable() always true → red (a plain route counts as secret).
  assert.equal(notRetryable({ response: undefined }), false);
  assert.equal(notRetryable({ secret: true }), true);
});
