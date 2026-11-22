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
 * Counter-checks for confirmed routes (measured 03.11.2026):
 *   I  notRetryable() only checks `geheim`, not `bestaetigung` → red:
 *      “every route with confirmation …”; together with `geheim` removed from
 *      /vouchers/:id/klartext also “the repetition with a wrong
 *      password …” (the PIN came with Idempotent-Replay)
 *   J  routeForRequest() always returns undefined → red: the first four
 *      subtests, “every writing route …” and “every route with confirmation …”
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
const geheimnis = _req('src/infra/secret.js');
const { idempotency, responseIsSecret } = _req('src/idempotency/http/middleware.js');
const { notRetryable } = _req('src/contract/base.js');
const { CONTRACT } = _req('src/contract/index.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** How often the text stands in any column of any table. */
async function occurrences(text) {
  const tabellen = await db.all(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const treffer = [];
  for (const { tablename } of tabellen) {
    const n = (await db.get(`SELECT count(*)::int n FROM "${tablename}" x WHERE x::text LIKE '%' || $1 || '%'`, [text]))
      .n;
    if (n) treffer.push(`${tablename}: ${n}`);
  }
  return treffer;
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
    if (!req.originalUrl.startsWith('/api/v1/auth')) req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', idempotency(require('./helpers/sources').testServices().idempotency));
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const post = (pfad, key, body, methode = 'POST') =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v1${pfad}`, {
      method: methode,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    }).then(async r => ({ status: r.status, replay: r.headers.get('idempotent-replay'), body: await r.json() }));
  const zeile = k => db.get('SELECT status, response FROM idempotency WHERE user_id = $1 AND key = $2', [uid, k]);

  await t.test('the repetition with a wrong password gets neither PIN nor response', async () => {
    const neu = await post('/vouchers', 'v-1', {
      number: '1234567890123456',
      pin: '4321',
      amount: 20,
      currency: 'CHF',
    });
    assert.equal(neu.status, 200, JSON.stringify(neu.body));
    const pfad = `/vouchers/${neu.body.voucher.id}/klartext`;
    const erst = await post(pfad, 'k-1', { password: PASS });
    assert.deepEqual([erst.status, erst.body.pin], [200, '4321'], JSON.stringify(erst.body));
    assert.deepEqual(await zeile('k-1'), { status: 200, response: null });
    const falsch = await post(pfad, 'k-1', { password: 'falsch-falsch-falsch' });
    assert.equal(falsch.status, 409, JSON.stringify(falsch.body));
    assert.equal(falsch.body.code, 'idempotenz_nicht_wiederholbar');
    assert.equal(falsch.replay, null);
    assert.ok(!JSON.stringify(falsch.body).includes('4321'));
  });

  let g;
  await t.test('the TOTP secret is in no column of the database', async () => {
    const r = await post('/auth/zweiter-faktor/einrichten', 'zf-1', { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    g = r.body.geheimnis;
    assert.match(g, /^[A-Z2-7]{32}$/);
    assert.deepEqual(await occurrences(g), []);
    assert.deepEqual(await zeile('zf-1'), { status: 200, response: null });
  });

  await t.test('the repetition gets 409 instead of a second secret', async () => {
    const r = await post('/auth/zweiter-faktor/einrichten', 'zf-1', { password: PASS });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotenz_nicht_wiederholbar');
    assert.equal(r.replay, null);
  });

  await t.test('the recovery codes are nowhere in plaintext either', async () => {
    const code = zf.hotp(zf.fromBase32(g), zf.timeStep());
    const r = await post('/auth/zweiter-faktor/bestaetigen', 'zf-2', { code });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.codes.length, 10);
    for (const wc of r.body.codes) assert.deepEqual(await occurrences(wc), [], wc);
    assert.equal((await post('/auth/zweiter-faktor/bestaetigen', 'zf-2', { code })).status, 409);
  });

  await t.test('ordinary responses are stored encrypted and repeated', async () => {
    const erst = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.equal(erst.status, 200, JSON.stringify(erst.body));
    assert.equal(erst.replay, null);
    const z = await zeile('p-1');
    assert.ok(z.response.startsWith('v2:'), z.response);
    assert.equal(
      geheimnis.decrypt(z.response, _req('src/idempotency/service.js').responseContext(uid, 'p-1')),
      JSON.stringify(erst.body),
    );
    const nochmal = await post('/storage/locations', 'p-1', { name: 'Kiste 1' });
    assert.deepEqual(nochmal, { ...erst, replay: 'true' });
  });

  await t.test('the fingerprint does not reveal the password', async () => {
    const dienst = _req('src/idempotency/service.js');
    const pfad = '/api/v1/auth/zweiter-faktor/einrichten';
    const alt = require('node:crypto')
      .createHash('sha256')
      .update(`POST ${pfad}\n${JSON.stringify({ password: PASS })}`)
      .digest('hex');
    assert.deepEqual(await occurrences(alt), [], 'der SHA-256 des Rumpfs mit Passwort liegt in der Tabelle');
    assert.match(
      (await db.get("SELECT request FROM idempotency WHERE user_id = $1 AND key = 'zf-1'", [uid])).request,
      /^h1:[0-9a-f]{64}$/,
    );
    const abdruck = rumpf => dienst.fingerprint('POST', pfad, rumpf);
    assert.equal(
      abdruck({ password: 'a', current: 'b', admin_password: 'c', code: '1', faktor_code: '2', pin: '3', x: 1 }),
      abdruck({ password: 'z', current: 'y', admin_password: 'w', code: '9', faktor_code: '8', pin: '7', x: 1 }),
    );
    assert.notEqual(
      abdruck({ password: 'a', x: 1 }),
      abdruck({ password: 'a', x: 2 }),
      'der übrige Inhalt zählt weiter',
    );
    const vorher = abdruck({ x: 1 });
    environment({ DATA_KEY: Buffer.alloc(32, 8).toString('base64') });
    geheimnis._forgetKey();
    try {
      assert.notEqual(abdruck({ x: 1 }), vorher, 'ohne Datenschlüssel nachrechenbar');
    } finally {
      environment({ DATA_KEY: Buffer.alloc(32, 7).toString('base64') });
      geheimnis._forgetKey();
    }

    await db.run(`INSERT INTO idempotency (user_id, key, request, status) VALUES ($1, 'sha-1', $2, 200)`, [uid, alt]);
    assert.ok((await dienst.deleteOldFingerprints()) >= 1);
    const uebrig = (await db.all('SELECT key FROM idempotency WHERE user_id = $1 ORDER BY 1', [uid])).map(z => z.key);
    assert.ok(!uebrig.includes('sha-1') && uebrig.includes('zf-1'), uebrig.join(', '));
  });

  await t.test('the migration removes plaintext and the repetition is refused', async () => {
    const abdruck = _req('src/idempotency/service.js').fingerprint('POST', '/api/v1/storage/locations', {
      name: 'Alt',
    });
    await db.run(
      `INSERT INTO idempotency (user_id, key, request, status, response)
                  VALUES ($1, 'alt-1', $2, 200, '{"token":"klartext-aus-frueher"}')`,
      [uid, abdruck],
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
    assert.equal((await zeile('v1-1')).response, 'v1:AAAA', 'verschlüsselte Zeilen bleiben');
    const r = await post('/storage/locations', 'alt-1', { name: 'Alt' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'idempotenz_nicht_wiederholbar');
  });
});

test('every writing route with access or code is on the list', () => {
  // `code` is otherwise the error code; the invitation code therefore stands separately below.
  const SECRET_FIELDS = ['token', 'codes', 'geheimnis', 'otpauth'];
  const gefunden = [],
    fehlt = [];
  for (const [key, route] of Object.entries(CONTRACT)) {
    const [methode, pfad] = key.split(' ');
    if (methode === 'GET' || !route.antwort?.shape) continue;
    if (!SECRET_FIELDS.some(f => f in route.antwort.shape)) continue;
    (responseIsSecret(methode, pfad.replace(/:\w+/g, '1')) ? gefunden : fehlt).push(key);
  }
  assert.deepEqual(fehlt, []);
  assert.ok(gefunden.length >= 9, `nur ${gefunden.length} Routen erkannt: ${gefunden.join(', ')}`);
  assert.equal(responseIsSecret('POST', '/api/v1/settings/household/invite'), true);
  assert.equal(responseIsSecret('POST', '/api/v1/vouchers/7/klartext'), true);
  assert.equal(responseIsSecret('PUT', '/api/v1/parts/3001/5'), false);
});

test('every route with confirmation is not repeatable', () => {
  const withConfirmation = Object.entries(CONTRACT).filter(([, r]) => r.bestaetigung);
  assert.ok(withConfirmation.length >= 20, `nur ${withConfirmation.length} Routen mit Bestätigung`);
  const retryable = withConfirmation
    .map(([k]) => k.split(' '))
    .filter(([m, p]) => !responseIsSecret(m, p.replace(/:\w+/g, '1')))
    .map(x => x.join(' '));
  assert.deepEqual(retryable, []);
  assert.equal(notRetryable({ response: undefined }), false);
});
