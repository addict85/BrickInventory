/**
 * Passkeys (WebAuthn): Registrieren, Anmelden ohne Passwort und als zweiter
 * Faktor — mit einem in Node erzeugten P-256-Schlüssel, der die Attestation
 * „none“ und jede Assertion selbst signiert. Geprüft wird über die echten
 * Routen gegen eine echte Datenbank.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in loeseChallengeEin() das DELETE … RETURNING durch ein SELECT ersetzt
 *      (Challenge mehrfach gültig) → rot: „eine Antwort gilt nur einmal …“
 *      (beim Passkey ohne Zähler ging die Wiederholung durch)
 *   B  in anmeldungPruefen() zusätzlich 'https://boese.test' als Origin
 *      erlaubt → rot: „fremde Herkunft wird abgewiesen“
 *   C  requireUserVerification beim Anmelden ohne Passwort auf false → rot:
 *      „ohne Passwort braucht es User Verification“
 *   D  in pruefeAnmeldedaten() die Bindung an das Konto weggelassen (uid null)
 *      → rot: „Passkey als zweiter Faktor …“ (Berts Passkey öffnete Annas Konto)
 *   E  gespeicherten Zähler ignoriert (counter: 0, UPDATE ohne Zählerbedingung)
 *      → rot: „… und ein alter Zähler nicht“
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.WEB_WORKERS = '1';
process.env.APP_BASE_URL = 'https://lego.test';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const zf = _req('utils/zweiterFaktor.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { isoCBOR } = require(path.join(ROOT, 'node_modules', '@simplewebauthn', 'server', 'script', 'helpers', 'index.js'));

const PASS = 'richtigesPasswort1';
const ORIGIN = 'https://lego.test', RP = 'lego.test';
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();

/** Ein Authenticator aus einem Schlüsselpaar: erzeugt Attestation und Assertions. */
function authenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(16);
  let zaehler = 0;
  const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const zahl = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    id: b64u(id),
    registrieren(challenge, origin = ORIGIN) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const authData = Buffer.concat([sha(RP), Buffer.from([0x45]), zahl(0), Buffer.alloc(16), len, id, Buffer.from(cose)]);
      const att = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(client), attestationObject: b64u(att), transports: ['internal'] } };
    },
    /** @param o.uv User Verification gesetzt @param o.zaehler fester Zählerstand */
    anmelden(challenge, o = {}) {
      const origin = o.origin ?? ORIGIN;
      const stand = o.zaehler ?? ++zaehler;
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(RP), Buffer.from([o.uv === false ? 0x01 : 0x05]), zahl(stand)]);
      const sig = crypto.sign('sha256', Buffer.concat([authData, sha(client)]), privateKey);
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(client), authenticatorData: b64u(authData), signature: b64u(sig) } };
    },
  };
}

test('Passkeys', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const hash = await bcrypt.hash(PASS, 4);
  const ids = {};
  for (const n of ['pk_anna', 'pk_bert']) {
    await db.run('DELETE FROM users WHERE username = $1', [n]);
    await db.run('INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,0,1,1)', [n, hash]);
    ids[n] = (await db.get('SELECT id FROM users WHERE username=$1', [n])).id;
  }

  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1/auth', _req('routes/auth.js'));
  app.use('/api/v1/auth', _req('routes/passkeys.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1/auth`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM users WHERE username IN ('pk_anna', 'pk_bert')");
    await db.pool.end();
  });

  const ruf = async (weg, body, cookie) => {
    const r = await fetch(basis + weg, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], body: await r.json().catch(() => null) };
  };
  const sitzung = async (name) => (await ruf('/login', { username: name, password: PASS, ohne_token: true })).cookie;
  const registriere = async (name, schluessel) => {
    const c = await sitzung(name);
    const o = await ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.optionen.rp.id, RP);
    const r = await ruf('/passkey/registrieren', { antwort: schluessel.registrieren(o.body.optionen.challenge), name: 'Laptop' }, c);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return c;
  };
  const optionen = async (zweck) => (await ruf('/passkey/anmelden/optionen', { zweck })).body.optionen.challenge;

  const anna = authenticator(), bert = authenticator(), ohneZaehler = authenticator();

  await t.test('registrieren und ohne Passwort anmelden', async () => {
    const c = await registriere('pk_anna', anna);
    const liste = await ruf('/passkeys', undefined, c);
    assert.equal(liste.body.passkeys.length, 1);
    assert.equal(liste.body.passkeys[0].name, 'Laptop');

    const a = await ruf('/passkey/anmelden', { antwort: anna.anmelden(await optionen()) });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.user.id, ids.pk_anna);
    const ich = await ruf('/me', undefined, a.cookie);
    assert.equal(ich.body.user.id, ids.pk_anna, 'Die Anmeldung legt eine Sitzung an');
  });

  await t.test('eine Antwort gilt nur einmal, und ein alter Zähler nicht', async () => {
    const antwort = anna.anmelden(await optionen());
    assert.equal((await ruf('/passkey/anmelden', { antwort })).status, 200);
    assert.equal((await ruf('/passkey/anmelden', { antwort })).status, 401, 'Wiederholte Antwort');
    // Neue Challenge, aber der Zählerstand von eben: ein geklonter Authenticator.
    const stand = Number((await db.get('SELECT sign_count FROM passkeys WHERE user_id = $1', [ids.pk_anna])).sign_count);
    assert.ok(stand > 0);
    const klon = anna.anmelden(await optionen(), { zaehler: stand });
    assert.equal((await ruf('/passkey/anmelden', { antwort: klon })).status, 401, 'Zähler nicht gestiegen');

    // Viele Passkeys zählen gar nicht (immer 0): Dann schützt allein die Challenge.
    await registriere('pk_bert', ohneZaehler);
    const null1 = ohneZaehler.anmelden(await optionen(), { zaehler: 0 });
    assert.equal((await ruf('/passkey/anmelden', { antwort: null1 })).status, 200);
    assert.equal((await ruf('/passkey/anmelden', { antwort: null1 })).status, 401, 'Challenge nur einmal gültig');
  });

  await t.test('fremde Herkunft wird abgewiesen', async () => {
    const fremd = anna.anmelden(await optionen(), { origin: 'https://boese.test' });
    assert.equal((await ruf('/passkey/anmelden', { antwort: fremd })).status, 401);
    const c = await sitzung('pk_bert');
    const o = await ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    const r = await ruf('/passkey/registrieren',
      { antwort: authenticator().registrieren(o.body.optionen.challenge, 'https://boese.test') }, c);
    assert.equal(r.status, 400);
  });

  await t.test('ohne Passwort braucht es User Verification', async () => {
    const ohneUv = anna.anmelden(await optionen(), { uv: false });
    assert.equal((await ruf('/passkey/anmelden', { antwort: ohneUv })).status, 401);
  });

  await t.test('Passkey als zweiter Faktor statt des TOTP-Codes, nur für das eigene Konto', async () => {
    const geheim = await zf.beginneEinrichtung(ids.pk_anna);
    await zf.bestaetigeEinrichtung(ids.pk_anna, zf.hotp(zf.ausBase32(geheim), zf.zeitschritt()));
    await registriere('pk_bert', bert);

    const ohne = await ruf('/login', { username: 'pk_anna', password: PASS, ohne_token: true });
    assert.equal(ohne.status, 401);
    assert.equal(ohne.body.zweiter_faktor, true);
    assert.equal(ohne.body.passkey, true, 'Der Client erfährt, dass ein Passkey geht');

    const fremd = await ruf('/login', { username: 'pk_anna', password: PASS, ohne_token: true,
      passkey: bert.anmelden(await optionen('zweiter_faktor')) });
    assert.equal(fremd.status, 401, 'Der Passkey eines anderen Kontos öffnet nichts');

    const ok = await ruf('/login', { username: 'pk_anna', password: PASS, ohne_token: true,
      passkey: anna.anmelden(await optionen('zweiter_faktor'), { uv: false }) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  await t.test('löschen verlangt das Passwort', async () => {
    const c = await sitzung('pk_bert');
    const liste = (await ruf('/passkeys', undefined, c)).body.passkeys;
    assert.equal(liste.length, 2);
    const loesche = (id, body) => fetch(`${basis}/passkeys/${id}`, { method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie: c }, body: JSON.stringify(body) });
    assert.equal((await loesche(liste[0].id, { password: 'falsch' })).status, 400);
    for (const p of liste) assert.equal((await (await loesche(p.id, { password: PASS })).json()).deleted, 1);
    assert.equal((await ruf('/passkey/anmelden', { antwort: bert.anmelden(await optionen()) })).status, 401);
  });
});
