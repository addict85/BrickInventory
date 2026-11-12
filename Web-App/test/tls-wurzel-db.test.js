/**
 * Die Wurzel der internen CA: Fingerabdruck (Base64 SHA-256 SPKI), /ca.crt,
 * die Anzeige in den Einstellungen, `fp` im QR-Code nur zu einer https-Adresse
 * und das Sitzungscookie nur über TLS.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in tlsStandAus() über das ganze Zertifikat (zert.raw) statt über SPKI
 *      gehasht → rot: „Fingerabdruck = Base64 SHA-256 des SPKI …“
 *   B  in tlsStand() den Zwischenspeicher nicht an mtime gebunden → rot:
 *      „/ca.crt, Einstellungen und QR …“ (nach dem Tausch der Datei alter fp)
 *   C  in /qr-token die https-Bedingung für `fp` entfernt → rot: dieselbe
 *      Prüfung (fp zur http-Adresse)
 *   D  cookieSicher() ohne hinterTls → rot: „Cookie nur über TLS …“
 *   E  (09.11.2026) zert_sha256 aus dem SPKI statt aus dem ganzen Zertifikat →
 *      rot: „zum Abgleich auf dem Gerät …“
 *   F  (09.11.2026) in /ca.crt den Dateinamen ohne Unterschied nach req.secure →
 *      rot: „/ca.crt, Einstellungen und QR …“ (über HTTP kein Hinweis)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (für Sitzung und QR-Code).
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
umgebung({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });
umgebung({ APP_BASE_URL: 'https://lego.test' });

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-ca-'));
const CA = path.join(ordner, 'root.crt');
umgebung({ CA_ZERTIFIKAT: CA });

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
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

test('zum Abgleich auf dem Gerät: SHA-256 des ganzen Zertifikats, wie im Protokoll von Caddy', () => {
  // Wie compose.yaml ihn ins Protokoll schreibt: sha256sum über den DER-Inhalt des PEM.
  const der = Buffer.from(PEM1.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const hex = require('node:crypto')
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .match(/../g)
    .join(':');
  const stand = _req('src/infra/tlsWurzel.js').tlsStandAus(PEM1);
  assert.equal(stand.zert_sha256, hex);
  assert.notEqual(stand.zert_sha256, stand.fp_hex);
});

test('Cookie nur über TLS: in Produktion und hinter https, abschaltbar', () => {
  // Ohne NODE_ENV gelten die Regeln des Betriebs; locker ist nur die Entwicklung.
  const ent = { NODE_ENV: 'development' };
  assert.equal(cookieSicher(ladeKonfig({})), true);
  assert.equal(cookieSicher(ladeKonfig(ent)), false);
  assert.equal(cookieSicher(ladeKonfig({ ...ent, APP_BASE_URL: 'https://lego.test' })), true);
  assert.equal(cookieSicher(ladeKonfig({ ...ent, APP_BASE_URL: 'http://192.168.1.5:3000' })), false);
  assert.equal(cookieSicher(ladeKonfig({ NODE_ENV: 'production' })), true);
  assert.equal(cookieSicher(ladeKonfig({ APP_BASE_URL: 'https://lego.test', COOKIE_SECURE: '0' })), false);
});

test('/ca.crt, Einstellungen und QR-Code tragen denselben Fingerabdruck', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
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
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
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
  const ruf = (weg, o = {}) =>
    fetch(basis + weg, {
      method: o.body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(o.cookie ? { cookie: o.cookie } : {}) },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
  const anmeldung = await ruf('/api/v1/auth/login', {
    body: { username: 'tls_nutzer', password: 'richtigesPasswort1', ohne_token: true },
  });
  await anmeldung.text(); // die Sitzung steht erst nach dem letzten Byte im Speicher
  const cookie = anmeldung.headers.get('set-cookie').split(';')[0];
  const qr = async () =>
    (await ruf('/api/v1/auth/qr-token', { cookie, body: { password: 'richtigesPasswort1' } })).json();

  // Noch keine Datei (Caddy hat die CA nicht angelegt): kein fp, 404.
  assert.equal((await ruf('/ca.crt')).status, 404);
  assert.equal((await qr()).fp, undefined);

  fs.writeFileSync(CA, PEM1);
  const r = await ruf('/ca.crt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-x509-ca-cert/);
  assert.equal(tlsStandAus(await r.text()).fp, FP1, '/ca.crt liefert das Zertifikat selbst');
  // Über HTTP sagen Dateiname und Kopf, dass der Fingerabdruck abzugleichen ist; über HTTPS nicht.
  assert.match(r.headers.get('content-disposition'), /filename="brickinventory-ca-fingerabdruck-pruefen\.crt"/);
  assert.match(r.headers.get('x-fingerabdruck-pruefen') ?? '', /SHA-256 vor dem Installieren/);
  const sicher = await fetch(basis + '/ca.crt', { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(sicher.headers.get('content-disposition'), /filename="brickinventory-ca\.crt"/);
  assert.equal(sicher.headers.get('x-fingerabdruck-pruefen'), null);
  const tls = await (await ruf('/api/v1/settings/tls', { cookie })).json();
  assert.equal(tls.fp, FP1);
  assert.equal(tls.zert_sha256, tlsStandAus(PEM1).zert_sha256);
  assert.equal(tls.https, true);
  const q = await qr();
  assert.equal(q.fp, FP1);
  assert.equal(q.zert_sha256, tlsStandAus(PEM1).zert_sha256, 'Neben dem QR-Code steht der Wert zum Abgleich');
  assert.equal(q.url, 'https://lego.test');

  // Die Datei wird getauscht (neue CA): Der Server liest neu, ohne Neustart.
  fs.writeFileSync(CA, PEM2);
  fs.utimesSync(CA, new Date(), new Date(Date.now() + 5000));
  assert.equal((await qr()).fp, FP2);

  // Zu einer http-Adresse gehört kein fp: Die App prüft dann kein Zertifikat.
  umgebung({ APP_BASE_URL: 'http://192.168.1.5:3000' });
  try {
    const ohne = await qr();
    assert.equal(ohne.success, true);
    assert.equal(ohne.fp, undefined);
  } finally {
    umgebung({ APP_BASE_URL: 'https://lego.test' });
  }
});
