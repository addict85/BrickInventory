/**
 * The root of the internal CA: fingerprint (Base64 SHA-256 SPKI), /ca.crt,
 * the display in the settings, `fp` in the QR code only for an https address
 * and the session cookie only over TLS.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in tlsStatusFrom() hashed over the whole certificate (zert.raw) instead of over SPKI
 *      → red: “fingerprint = Base64 SHA-256 of the SPKI …”
 *   B  in tlsStand() the cache not bound to mtime → red:
 *      “/ca.crt, settings and QR code …” (old fp after swapping the file)
 *   C  the https condition for `fp` removed in /qr-token → red: the same
 *      check (fp for the http address)
 *   D  cookieSafe() without hinterTls → red: “cookie only over TLS …”
 *   E  (09.11.2026) zert_sha256 from the SPKI instead of from the whole certificate →
 *      red: “for comparison on the device …”
 *   F  (14.11.2026, HTTPS only now) in /ca.crt the refusal without req.secure
 *      deleted → red: “/ca.crt, settings and QR code …” (over HTTP 200 instead of 403);
 *      the header X-Fingerabdruck-Pruefen deleted → red: the same check
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (for session and QR code).
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });
environment({ APP_BASE_URL: 'https://lego.test' });

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-ca-'));
const CA = path.join(ordner, 'root.crt');
environment({ CA_ZERTIFIKAT: CA });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { tlsStatusFrom } = _req('src/infra/tlsWurzel.js');
const { ladeKonfig, cookieSafe } = _req('src/infra/config.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const PEM1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ca-root-1.crt'), 'utf8');
const PEM2 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ca-root-2.crt'), 'utf8');
const FP1 = '6a2+vi4vM1RWOxXv8B8h4GIn8x0V+ELcjAp3DATfCE8=';
const FP2 = 'N3/8TmZexexJN1wTiG1qcdjYhdQ/Bm3Gds0Om73H7wQ=';

test('fingerprint = Base64 SHA-256 of the SPKI, 32 bytes', () => {
  const s = tlsStatusFrom(PEM1);
  assert.equal(s.fp, FP1);
  assert.equal(Buffer.from(s.fp, 'base64').length, 32);
  assert.equal(s.fp_hex, Buffer.from(FP1, 'base64').toString('hex').toUpperCase().match(/../g).join(':'));
  assert.equal(tlsStatusFrom(PEM2).fp, FP2);
});

test("for comparison on the device: SHA-256 of the whole certificate, as in Caddy's log", () => {
  // As compose.yaml writes it into the log: sha256sum over the DER content of the PEM.
  const der = Buffer.from(PEM1.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const hex = require('node:crypto')
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .match(/../g)
    .join(':');
  const stand = _req('src/infra/tlsWurzel.js').tlsStatusFrom(PEM1);
  assert.equal(stand.zert_sha256, hex);
  assert.notEqual(stand.zert_sha256, stand.fp_hex);
});

test('cookie only over TLS: in production and behind https, can be switched off', () => {
  // Without NODE_ENV the rules of production apply; only development is relaxed.
  const ent = { NODE_ENV: 'development' };
  assert.equal(cookieSafe(ladeKonfig({})), true);
  assert.equal(cookieSafe(ladeKonfig(ent)), false);
  assert.equal(cookieSafe(ladeKonfig({ ...ent, APP_BASE_URL: 'https://lego.test' })), true);
  assert.equal(cookieSafe(ladeKonfig({ ...ent, APP_BASE_URL: 'http://192.168.1.5:3000' })), false);
  assert.equal(cookieSafe(ladeKonfig({ NODE_ENV: 'production' })), true);
  assert.equal(cookieSafe(ladeKonfig({ APP_BASE_URL: 'https://lego.test', COOKIE_SECURE: '0' })), false);
});

test('/ca.crt, settings and QR code carry the same fingerprint', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run("DELETE FROM users WHERE username = 'tls_nutzer'");
  await db.run(
    "INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ('tls_nutzer',$1,false,true,true)",
    [await bcrypt.hash('richtigesPasswort1', 4)],
  );

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      ),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(_req('routes/certificate.js').buildCertificateRouter());
  app.use(
    '/api/v1',
    _req('routes/api_v1/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/settings.js'));
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM users WHERE username = 'tls_nutzer'");
    await db.pool.end();
    fs.rmSync(ordner, { recursive: true, force: true });
  });
  const ruf = (weg, o = {}) =>
    fetch(basis + weg, {
      method: o.body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(o.cookie ? { cookie: o.cookie } : {}) },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
  const anmeldung = await ruf('/api/v1/auth/login', {
    body: { username: 'tls_nutzer', password: 'richtigesPasswort1', ohne_token: true },
  });
  await anmeldung.text(); // the session only stands in the store after the last byte
  const cookie = anmeldung.headers.get('set-cookie').split(';')[0];
  const qr = async () =>
    (await ruf('/api/v1/auth/qr-token', { cookie, body: { password: 'richtigesPasswort1' } })).json();

  const zert = (proto = 'https') => fetch(basis + '/ca.crt', { headers: { 'x-forwarded-proto': proto } });
  // No file yet (Caddy has not created the CA): no fp, 404.
  assert.equal((await zert()).status, 404);
  assert.equal((await qr()).fp, undefined);

  fs.writeFileSync(CA, PEM1);
  const r = await zert();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-x509-ca-cert/);
  assert.equal(tlsStatusFrom(await r.text()).fp, FP1, '/ca.crt liefert das Zertifikat selbst');
  // Also over HTTPS: before the installation the device does not trust the connection, name and header say so.
  assert.match(r.headers.get('content-disposition'), /filename="brickinventory-ca-fingerabdruck-pruefen\.crt"/);
  assert.match(r.headers.get('x-fingerabdruck-pruefen') ?? '', /SHA-256 vor dem Installieren/);
  const klar = await zert('http');
  assert.equal(klar.status, 403, 'über HTTP keine Wurzel');
  assert.doesNotMatch(await klar.text(), /BEGIN CERTIFICATE/);
  const tls = await (await ruf('/api/v1/settings/tls', { cookie })).json();
  assert.equal(tls.fp, FP1);
  assert.equal(tls.zert_sha256, tlsStatusFrom(PEM1).zert_sha256);
  assert.equal(tls.https, true);
  const q = await qr();
  assert.equal(q.fp, FP1);
  assert.equal(q.zert_sha256, tlsStatusFrom(PEM1).zert_sha256, 'Neben dem QR-Code steht der Wert zum Abgleich');
  assert.equal(q.url, 'https://lego.test');

  // The file is swapped (new CA): the server rereads without a restart.
  fs.writeFileSync(CA, PEM2);
  fs.utimesSync(CA, new Date(), new Date(Date.now() + 5000));
  assert.equal((await qr()).fp, FP2);

  // No fp belongs to an http address: the app then checks no certificate.
  environment({ APP_BASE_URL: 'http://192.168.1.5:3000' });
  try {
    const ohne = await qr();
    assert.equal(ohne.success, true);
    assert.equal(ohne.fp, undefined);
  } finally {
    environment({ APP_BASE_URL: 'https://lego.test' });
  }
});
