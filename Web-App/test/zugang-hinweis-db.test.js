/**
 * Neue Zugänge und abgebauter Schutz gehen per Mail hinaus: ein neuer
 * App-Token und ein QR-Zugang an den Inhaber, ein neuer Verwalter und ein
 * entfernter zweiter Faktor an alle Verwalter (der entfernte Faktor auch an
 * das betroffene Konto).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  hinweisNebenher() in /token-create entfernt → rot: „neuer Token"
 *   B  hinweisNebenher() in /qr-token entfernt → rot: „neuer QR-Zugang"
 *   C  verwalterHinweisNebenher() in PUT /users/:id/admin entfernt → rot:
 *      „ernannter Verwalter"
 *   D  in aktiveVerwalter() `is_admin AND` entfernt → rot: „neues
 *      Verwalterkonto" (die Mail ging auch an das gewöhnliche Konto)
 *   E  hinweisNebenher() in PUT /users/:id/password entfernt → rot:
 *      „fremdes Passwort durch einen Verwalter“
 * Gegenprobe (04.11.2026 gemessen):
 *   F  hinweisNebenher() in angemeldetAntworten() (routes/auth.ts) entfernt →
 *      rot: „Token aus der Anmeldung (neues Gerät)“
 *   G  hinweisNebenher() in /zweiter-faktor/bestaetigen bzw. /abschalten
 *      entfernt → rot: „eigener zweiter Faktor eingerichtet und abgeschaltet“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'https://lego.test';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

const gesendet = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _name, art, o) => { gesendet.push({ an, art, ...o }); return { success: true }; },
});

const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Hinweis-Passwort-1';

test('Mails bei neuen Zugängen', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  const P = process.pid, NAMEN = [`zh_chef_${P}`, `zh_zwei_${P}`, `zh_nutzer_${P}`, `zh_neu_${P}`];
  const konto = async (name, admin) => (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`, [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin])).id;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const chef = await konto(NAMEN[0], true), zwei = await konto(NAMEN[1], true), nutzer = await konto(NAMEN[2], false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const base = testServer(_req, { sitzung: { userId: chef, username: NAMEN[0], isAdmin: true },
    routen: { '/api/v1/auth': 'routes/auth.js' }, t }).base;
  const ruf = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v1/auth${weg}`, { method: methode, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    const text = await r.text();
    assert.equal(r.status, 200, `${weg}: ${text}`);
    return JSON.parse(text);
  };
  /** Die Mails gehen nebenher; bis sie da sind, kurz warten. */
  const mails = async (art, anzahl) => {
    for (let i = 0; i < 60 && gesendet.filter(m => m.art === art).length < anzahl; i++) await new Promise(r => setTimeout(r, 25));
    return gesendet.filter(m => m.art === art && NAMEN.some(n => m.an === `${n}@example.org`))
      .map(m => ({ an: m.an.split('@')[0], konto: m.konto, durch: m.durch, name: m.passkey })).sort((a, b) => a.an.localeCompare(b.an));
  };

  await t.test('neuer Token', async () => {
    await ruf('POST', '/token-create', { password: PASS, label: 'Tablet' });
    assert.deepEqual(await mails('token_neu', 1), [{ an: NAMEN[0], konto: undefined, durch: undefined, name: 'Tablet' }]);
  });

  await t.test('neuer QR-Zugang', async () => {
    await ruf('POST', '/qr-token', { password: PASS });
    assert.deepEqual((await mails('qr_zugang_neu', 1)).map(m => m.an), [NAMEN[0]]);
  });

  await t.test('neues Verwalterkonto', async () => {
    await ruf('POST', '/users', { username: NAMEN[3], password: 'Lang-genug-Passwort-1', is_admin: true, admin_password: PASS });
    assert.deepEqual(await mails('verwalter_ernannt', 2), [
      { an: NAMEN[0], konto: NAMEN[3], durch: NAMEN[0], name: undefined },
      { an: NAMEN[1], konto: NAMEN[3], durch: NAMEN[0], name: undefined }]);
  });

  await t.test('ernannter Verwalter', async () => {
    gesendet.length = 0;
    await ruf('PUT', `/users/${nutzer}/admin`, { is_admin: true, admin_password: PASS });
    assert.deepEqual((await mails('verwalter_ernannt', 3)).map(m => [m.an, m.konto]),
      [[NAMEN[0], NAMEN[2]], [NAMEN[2], NAMEN[2]], [NAMEN[1], NAMEN[2]]]);
  });

  await t.test('entfernter zweiter Faktor', async () => {
    await db.run(`INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, 'x', true)`, [zwei]);
    await ruf('DELETE', `/users/${zwei}/zweiter-faktor`, { admin_password: PASS });
    assert.deepEqual((await mails('zweiter_faktor_entfernt', 1)).map(m => [m.an, m.durch]), [[NAMEN[1], NAMEN[0]]]);
    assert.deepEqual((await mails('verwaltung_faktor_entfernt', 3)).map(m => [m.an, m.konto]),
      [[NAMEN[0], NAMEN[1]], [NAMEN[2], NAMEN[1]], [NAMEN[1], NAMEN[1]]]);
  });

  await t.test('fremdes Passwort durch einen Verwalter', async () => {
    await ruf('PUT', `/users/${zwei}/password`, { password: 'Neues-Langes-Passwort-9', admin_password: PASS });
    assert.deepEqual((await mails('passwort_durch_verwalter', 1)).map(m => [m.an, m.durch]), [[NAMEN[1], NAMEN[0]]]);
    assert.deepEqual((await mails('verwaltung_passwort_gesetzt', 3)).map(m => [m.an, m.konto]),
      [[NAMEN[0], NAMEN[1]], [NAMEN[2], NAMEN[1]], [NAMEN[1], NAMEN[1]]]);
  });

  await t.test('Token aus der Anmeldung (neues Gerät)', async () => {
    gesendet.length = 0;
    await ruf('POST', '/login', { username: NAMEN[2], password: PASS, label: 'Handy' });
    assert.deepEqual(await mails('token_neu', 1), [{ an: NAMEN[2], konto: undefined, durch: undefined, name: 'Handy' }]);
  });

  await t.test('eigener zweiter Faktor eingerichtet und abgeschaltet', async () => {
    const zf = _req('src/konto/zweiterFaktor.js');
    const { geheimnis } = await ruf('POST', '/zweiter-faktor/einrichten', { password: PASS });
    const code = (versatz) => zf.hotp(zf.ausBase32(geheimnis), zf.zeitschritt() + versatz);
    await ruf('POST', '/zweiter-faktor/bestaetigen', { code: code(0) });
    assert.deepEqual((await mails('zweiter_faktor_eingerichtet', 1)).map(m => m.an), [NAMEN[0]]);
    await ruf('POST', '/zweiter-faktor/abschalten', { password: PASS, code: code(1) });
    assert.deepEqual((await mails('zweiter_faktor_abgeschaltet', 1)).map(m => m.an), [NAMEN[0]]);
  });
});
