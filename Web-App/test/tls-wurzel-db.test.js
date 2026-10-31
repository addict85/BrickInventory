/**
 * Die Wurzel der internen CA: Fingerabdruck (Base64 SHA-256 SPKI), /ca.crt,
 * die Anzeige in den Einstellungen, `fp` im QR-Code nur zu einer https-Adresse
 * und das Sitzungscookie nur über TLS.
 *
 * Feste Testvektoren: test/fixtures/ca-wurzel-{1,2}.crt, Fingerabdrücke mit
 * openssl gerechnet (x509 -pubkey | pkey -pubin -outform der | dgst -sha256
 * -binary | base64), nicht mit dem Code unter Prüfung.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in tlsStandAus() über das ganze Zertifikat (zert.raw) statt über SPKI
 *      gehasht → rot: „Fingerabdruck = Base64 SHA-256 des SPKI …“
 *   B  in tlsStand() den Zwischenspeicher nicht an mtime gebunden → rot:
 *      „/ca.crt, Einstellungen und QR …“ (nach dem Tausch der Datei alter fp)
 *   C  in /qr-token die https-Bedingung für `fp` entfernt → rot: dieselbe
 *      Prüfung (fp zur http-Adresse)
 *   D  cookieSicher() ohne hinterTls → rot: „Cookie nur über TLS …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (für Sitzung und QR-Code).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'https://lego.test';

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-ca-'));
const CA = path.join(ordner, 'root.crt');
process.env.CA_ZERTIFIKAT = CA;

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { tlsStandAus } = _req('src/infra/tlsWurzel.js');
const { ladeKonfig, cookieSicher } = _req('src/infra/konfig.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const PEM1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ca-wurzel-1.crt'), 'utf8');
const PEM2 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ca-wurzel-2.crt'), 'utf8');
const FP1 = '6a2+vi4vM1RWOxXv8B8h4GIn8x0V+ELcjAp3DATfCE8=';
const FP2 = 'N3/8TmZexexJN1wTiG1qcdjYhdQ/Bm3Gds0Om73H7wQ=';

test('Fingerabdruck = Base64 SHA-256 des SPKI, 32 Byte', () => {
  const s = tlsStandAus(PEM1);
  assert.equal(s.fp, FP1);
  assert.equal(Buffer.from(s.fp, 'base64').length, 32);
  assert.equal(s.fp_hex, Buffer.from(FP1, 'base64').toString('hex').toUpperCase().match(/../g).join(':'));
  assert.equal(tlsStandAus(PEM2).fp, FP2);
});

test('Cookie nur über TLS: in Produktion und hinter https, abschaltbar', () => {
  assert.equal(cookieSicher(ladeKonfig({})), false);
  assert.equal(cookieSicher(ladeKonfig({ APP_BASE_URL: 'https://lego.test' })), true);
  assert.equal(cookieSicher(ladeKonfig({ APP_BASE_URL: 'http://192.168.1.5:3000' })), false);
  assert.equal(cookieSicher(ladeKonfig({ NODE_ENV: 'production' })), true);
  assert.equal(cookieSicher(ladeKonfig({ APP_BASE_URL: 'https://lego.test', COOKIE_SECURE: '0' })), false);
});

test('/ca.crt, Einstellungen und QR-Code tragen denselben Fingerabdruck', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }
  await db.run("DELETE FROM users WHERE username = 'tls_nutzer'");
  await db.run("INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ('tls_nutzer',$1,0,1,1)",
    [await bcrypt.hash('richtigesPasswort1', 4)]);

  const app = express();
  app.use(express.json());
  app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(_req('routes/zertifikat.js'));
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', _req('routes/api_v1/settings.js'));
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM users WHERE username = 'tls_nutzer'");
    await db.pool.end();
    fs.rmSync(ordner, { recursive: true, force: true });
  });
  const ruf = (weg, o = {}) => fetch(basis + weg, { method: o.body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(o.cookie ? { cookie: o.cookie } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}) });
  const cookie = (await ruf('/api/v1/auth/login', { body: { username: 'tls_nutzer', password: 'richtigesPasswort1', ohne_token: true } }))
    .headers.get('set-cookie').split(';')[0];
  const qr = async () => (await ruf('/api/v1/auth/qr-token', { cookie, body: { password: 'richtigesPasswort1' } })).json();

  // Noch keine Datei (Caddy hat die CA nicht angelegt): kein fp, 404.
  assert.equal((await ruf('/ca.crt')).status, 404);
  assert.equal((await qr()).fp, undefined);

  fs.writeFileSync(CA, PEM1);
  const r = await ruf('/ca.crt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-x509-ca-cert/);
  assert.equal(tlsStandAus(await r.text()).fp, FP1, '/ca.crt liefert das Zertifikat selbst');
  const tls = await (await ruf('/api/v1/settings/tls', { cookie })).json();
  assert.equal(tls.fp, FP1);
  assert.equal(tls.https, true);
  const q = await qr();
  assert.equal(q.fp, FP1);
  assert.equal(q.url, 'https://lego.test');

  // Die Datei wird getauscht (neue CA): Der Server liest neu, ohne Neustart.
  fs.writeFileSync(CA, PEM2);
  fs.utimesSync(CA, new Date(), new Date(Date.now() + 5000));
  assert.equal((await qr()).fp, FP2);

  // Zu einer http-Adresse gehört kein fp: Die App prüft dann kein Zertifikat.
  process.env.APP_BASE_URL = 'http://192.168.1.5:3000';
  try {
    const ohne = await qr();
    assert.equal(ohne.success, true);
    assert.equal(ohne.fp, undefined);
  } finally { process.env.APP_BASE_URL = 'https://lego.test'; }
});
