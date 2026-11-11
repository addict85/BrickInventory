/**
 * Token-Familien: Ein ersetzter Token bleibt als „verbraucht“ stehen. Kommt er
 * nach der Schonfrist wieder (Nutzung oder Tausch), hat ihn jemand kopiert:
 * Die ganze Familie endet samt Nachfolger, der Inhaber bekommt eine Mail.
 * Andere Geräte desselben Kontos bleiben angemeldet.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  in beendeUeberlappung() nur noch löschen, nicht vermerken → rot:
 *      „der Vorgänger ist als verbraucht vermerkt“
 *   B  in pruefeToken() meldeWiederverwendung() nicht aufgerufen → rot:
 *      „der Tausch mit dem verbrauchten sperrt die Familie“ (B gilt weiter)
 *   C  in sperreFamilie() `a.created_at = v.familie` gestrichen → rot:
 *      „das andere Gerät bleibt angemeldet“
 *   D  hinweisNebenher() in meldeWiederverwendung() entfernt → rot:
 *      „der Inhaber bekommt genau eine Mail“
 *   E  WIEDERVERWENDUNG_SCHONFRIST_S auf 0 → rot: „ein Nachzügler in der
 *      Schonfrist sperrt nichts“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
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
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _name, art, o) => { gesendet.push({ an, art, name: o.passkey }); return { success: true }; },
});

const db = _req('db/database.js');
const auth = _req('src/konto/geraeteToken.js');
const tokenCache = _req('src/konto/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `familie_${process.pid}`, PASS = 'Familien-Passwort-1';

test('Token-Familie mit Wiederverwendungserkennung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)])).id;

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1/auth`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const ruf = async (weg, token, body) => {
    const r = await fetch(basis + weg, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const anmelden = async (label) => {
    const r = await ruf('/login', null, { username: NAME, password: PASS, label, never_expires: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
  };
  const gilt = async (token) => { tokenCache.leereTokenCache(); return (await ruf('/me', token)).status === 200; };
  const verbraucht = async () => (await db.all('SELECT token FROM api_tokens_verbraucht WHERE user_id = $1', [uid])).map(z => z.token);
  // Jede Anmeldung meldet ihren neuen Zugang (token_neu); gezählt wird hier die Warnung.
  const warnungen = () => gesendet.filter(m => m.an === `${NAME}@example.org` && m.art !== 'token_neu');
  const mails = async (anzahl) => {
    for (let i = 0; i < 60 && warnungen().length < anzahl; i++) await new Promise(r => setTimeout(r, 25));
    return warnungen();
  };

  const a = await anmelden('Pixel');
  const anderes = await anmelden('Tablet');
  const getauscht = await ruf('/token-rotieren', a, {});
  assert.equal(getauscht.status, 200, JSON.stringify(getauscht.body));
  const b = getauscht.body.token;

  await t.test('der Vorgänger ist als verbraucht vermerkt', async () => {
    assert.equal(await gilt(b), true, 'die erste Nutzung des Nachfolgers');
    assert.deepEqual(await verbraucht(), [auth.hashToken(a)]);
    assert.equal(await gilt(a), false, 'der Vorgänger gilt nach der Überlappung nicht mehr');
  });

  await t.test('ein Nachzügler in der Schonfrist sperrt nichts', async () => {
    assert.equal((await ruf('/token-rotieren', a, {})).status, 401);
    assert.equal(await gilt(b), true, 'eine Anfrage, die noch mit dem alten unterwegs war, sperrt das Gerät aus');
    assert.deepEqual(await mails(0), []);
  });

  await t.test('der Tausch mit dem verbrauchten sperrt die Familie', async () => {
    await db.run(`UPDATE api_tokens_verbraucht SET verbraucht_am = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [uid]);
    assert.equal((await ruf('/token-rotieren', a, {})).status, 401);
    assert.equal(await gilt(b), false, 'der Nachfolger des kopierten Tokens gilt weiter');
    assert.deepEqual(await verbraucht(), [], 'die Familie ist samt Vermerk weg');
  });

  await t.test('das andere Gerät bleibt angemeldet', async () => {
    assert.equal(await gilt(anderes), true);
  });

  await t.test('der Inhaber bekommt genau eine Mail', async () => {
    assert.deepEqual(await mails(1), [{ an: `${NAME}@example.org`, art: 'token_wiederverwendet', name: 'Pixel' }]);
    assert.equal((await ruf('/me', a)).status, 401);
    await new Promise(r => setTimeout(r, 100));
    assert.equal((await mails(1)).length, 1, 'ein zweiter Versuch schickt keine zweite Mail');
  });

  await t.test('verwaiste Vermerke räumt der Hintergrundlauf ab', async () => {
    const c2 = await ruf('/token-rotieren', anderes, {});
    assert.equal(await gilt(c2.body.token), true);
    assert.equal((await verbraucht()).length, 1, 'Vorbedingung: ein Vermerk der lebenden Familie');
    await auth.purgeExpiredTokens();
    assert.equal((await verbraucht()).length, 1, 'der Vermerk einer lebenden Familie bleibt');
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    await auth.purgeExpiredTokens();
    assert.deepEqual(await verbraucht(), []);
  });
});
