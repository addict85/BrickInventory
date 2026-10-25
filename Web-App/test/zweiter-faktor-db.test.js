/**
 * Zweiter Faktor (TOTP, RFC 6238) — Rechnung gegen die RFC-Testvektoren und
 * der ganze Ablauf über die echte Anmeldung.
 *
 * Gegenproben (25.10., gemessen):
 *   A  istAktiv-Prüfung in pruefeAnmeldedaten() entfernt → rot: „ohne Code angemeldet"
 *   B  `letzter_schritt < $2` in pruefeCode() entfernt   → rot: „derselbe Code zweimal"
 *   C  recordLoginFailure beim falschen Code entfernt    → rot: „keine Sperre"
 *   D  hotp(): Offset aus dem ersten statt letzten Byte  → rot: RFC-Vektoren
 *   E  change-password wieder mit 401                    → rot: „die Clients melden dann ab"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const zf = _req('utils/zweiterFaktor.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('RFC 6238: die Testvektoren für SHA-1', () => {
  // Anhang B der RFC: Schlüssel "12345678901234567890", acht Stellen.
  const schluessel = Buffer.from('12345678901234567890');
  for (const [sekunden, erwartet] of [[59, '94287082'], [1111111109, '07081804'],
                                      [1111111111, '14050471'], [1234567890, '89005924'],
                                      [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(zf.hotp(schluessel, Math.floor(sekunden / 30), 8), erwartet, `T=${sekunden}`);
  }
  // Und Base32 hin und zurück, wie es eine Authenticator-App liest.
  assert.equal(zf.base32(schluessel), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(zf.ausBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), schluessel);
});

test('passenderSchritt: ein Schritt Spielraum, nicht mehr', () => {
  const g = zf.base32(Buffer.from('12345678901234567890'));
  const jetzt = 1234567890 * 1000, s = zf.zeitschritt(jetzt), k = zf.ausBase32(g);
  assert.equal(zf.passenderSchritt(g, zf.hotp(k, s), jetzt), s);
  assert.equal(zf.passenderSchritt(g, zf.hotp(k, s - 1), jetzt), s - 1);
  assert.equal(zf.passenderSchritt(g, zf.hotp(k, s + 1), jetzt), s + 1);
  assert.equal(zf.passenderSchritt(g, zf.hotp(k, s - 2), jetzt), null);
  assert.equal(zf.passenderSchritt(g, 'abcdef', jetzt), null);
});

test('Anmeldung mit zweitem Faktor — durchgespielt', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const NAME = `zf_${process.pid}`, PASS = 'richtigesPasswort1';
  const SPERRE = `zf_sperre_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, SPERRE]]);
  for (const n of [NAME, SPERRE])
    await db.run('INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,1,1)',
      [n, await bcrypt.hash(PASS, 4)]);

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}${AUTH}`;
  const ruf = async (weg, body, token) => {
    const r = await fetch(basis + weg, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const anmelden = (name, code) => ruf('/login', { username: name, password: PASS, ...(code !== undefined ? { code } : {}) });
  /** Ein Code, der zum aktuellen Geheimnis passt — wahlweise einen Schritt versetzt. */
  const codeFuer = async (name, versatz = 0) => {
    const z = await db.get('SELECT f.geheimnis FROM zweiter_faktor f JOIN users u ON u.id = f.user_id WHERE u.username = $1', [name]);
    return zf.hotp(zf.ausBase32(z.geheimnis), zf.zeitschritt() + versatz);
  };
  /** Einrichten bis aktiv; gibt den Token und die Wiederherstellungscodes zurück. */
  const einrichten = async (name) => {
    const token = (await anmelden(name)).body.token;
    assert.equal((await ruf('/zweiter-faktor/einrichten', { password: 'falsch' }, token)).status, 400,
      'Einrichten ohne richtiges Passwort');
    const e = await ruf('/zweiter-faktor/einrichten', { password: PASS }, token);
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.match(e.body.otpauth, /^otpauth:\/\/totp\/BrickInventory%3A/);
    // Vor der Bestätigung gilt der Faktor nicht: Anmelden geht noch ohne Code.
    assert.equal((await anmelden(name)).status, 200, 'unbestätigte Einrichtung sperrt schon');
    assert.equal((await ruf('/zweiter-faktor/bestaetigen', { code: '000000' }, token)).status, 400);
    const b = await ruf('/zweiter-faktor/bestaetigen', { code: await codeFuer(name, -1) }, token);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.codes.length, 10);
    return { token, codes: b.body.codes };
  };

  try {
    const { token, codes } = await einrichten(NAME);
    assert.deepEqual((await ruf('/zweiter-faktor', null, token)).body, { success: true, aktiv: true, codes_uebrig: 10 });
    const roh = JSON.stringify(await db.all('SELECT code_hash FROM zweiter_faktor_codes'));
    assert.ok(!codes.some(c => roh.includes(c.replace('-', ''))), 'Wiederherstellungscodes stehen im Klartext');

    // Ohne Code: Absage mit Hinweis, kein Token.
    const ohne = await anmelden(NAME);
    assert.equal(ohne.status, 401);
    assert.equal(ohne.body.zweiter_faktor, true, 'ohne Code angemeldet');
    assert.equal(ohne.body.code, 'zweiter_faktor_noetig');
    assert.equal(ohne.body.token, undefined);

    // Mit Code: angemeldet. Derselbe Code ein zweites Mal: abgewiesen.
    const code = await codeFuer(NAME);
    const mit = await anmelden(NAME, code);
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
    assert.ok(mit.body.token);
    const nochmal = await anmelden(NAME, code);
    assert.equal(nochmal.status, 401, 'derselbe Code zweimal');
    assert.equal(nochmal.body.code, 'zweiter_faktor_falsch');

    // Wiederherstellungscode: gilt einmal, auch mit anderer Schreibweise.
    assert.equal((await anmelden(NAME, codes[0].toUpperCase().replace('-', ' '))).status, 200);
    assert.equal((await anmelden(NAME, codes[0])).status, 401, 'Wiederherstellungscode gilt zweimal');
    assert.equal((await ruf('/zweiter-faktor', null, token)).body.codes_uebrig, 9);

    // Abschalten verlangt Passwort UND Code.
    assert.equal((await ruf('/zweiter-faktor/abschalten', { password: PASS, code: '000000' }, token)).status, 400);
    assert.equal((await ruf('/zweiter-faktor/abschalten', { password: 'falsch', code: codes[1] }, token)).status, 400);
    // Und beim Passwortwechsel: Ein 401 hiesse für Web und App „abgemeldet".
    const pw = await ruf('/change-password', { current: 'falsch', newPassword: 'neuesPasswort123' }, token);
    assert.equal(pw.status, 400, 'falsches aktuelles Passwort beim Wechsel ist ein 401 — die Clients melden dann ab');
    assert.equal((await ruf('/zweiter-faktor/abschalten', { password: PASS, code: codes[1] }, token)).status, 200);
    assert.equal((await anmelden(NAME)).status, 200, 'nach dem Abschalten wieder ohne Code');
    assert.equal((await db.get('SELECT COUNT(*)::int n FROM zweiter_faktor_codes f JOIN users u ON u.id=f.user_id WHERE u.username=$1', [NAME])).n, 0);

    // Falsche Codes zählen als Fehlversuche: Danach hilft auch der richtige nicht.
    await einrichten(SPERRE);
    for (let i = 0; i < 5; i++) await anmelden(SPERRE, String(100000 + i));
    const gesperrt = await anmelden(SPERRE, await codeFuer(SPERRE));
    assert.equal(gesperrt.status, 429, `keine Sperre nach fünf falschen Codes: ${JSON.stringify(gesperrt.body)}`);
  } finally {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, SPERRE]]).catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%zf_%${process.pid}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
