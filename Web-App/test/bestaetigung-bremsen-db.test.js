/**
 * Die Bremsen der erneuten Bestätigung: Falsche Codes zählen in einem eigenen
 * Zähler, den nur ein richtiger Code zurücksetzt (Bericht M2). Beide Zähler
 * gelten je Zugang — Sitzung oder Token-Familie —, damit Fehlversuche aus
 * einer erbeuteten Sitzung die Notbremsen des Inhabers nicht sperren (N1).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  in pruefeBestaetigung den Code über die Bremse 'passwort' geprüft
 *      (gemeinsamer Zähler, den das richtige Passwort löscht) → rot:
 *      „das Passwort setzt den Codezähler nicht zurück" und „falsche Codes
 *      einer fremden Sitzung …" (der Angreifer wird nie gesperrt)
 *   B  zugangVon() liefert immer '' (Zähler je Konto, wie vorher) → rot:
 *      „eine fremde Sitzung sperrt die Notbremsen nicht" und „falsche Codes
 *      einer fremden Sitzung sperren den Inhaber nicht"
 *   C  zugangVon() nimmt für Token den Kopf statt created_at → rot: „der
 *      Tausch des Tokens setzt die Bremse nicht zurück"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const { createToken } = _req('src/konto/geraeteToken.js');
const { entschluessele } = _req('src/infra/geheimnis.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Bremsen-Passwort-1';

async function konto(name) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [name, `${name}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
}

test('Bremsen der Bestätigung', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `bb_${process.pid}`,
    KARL = `bb_karl_${process.pid}`;
  const uid = await konto(NAME),
    karl = await konto(KARL);
  const leeren = () =>
    db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen|${karl}|%`,
    ]);
  t.after(async () => {
    await leeren().catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, karl]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await zf.beginneEinrichtung(uid);
  const z = await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid]);
  const codes = await zf.bestaetigeEinrichtung(
    uid,
    zf.hotp(zf.ausBase32(entschluessele(z.geheimnis, zf.faktorKontext(uid))), zf.zeitschritt()),
  );
  let naechster = 0;
  const richtig = () => codes[naechster++];

  // Je Kopf `x-sitzung` eine eigene Sitzung (wie express-session sie stellt), ohne ihn ein Token.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const sid = req.headers['x-sitzung'];
    req.session = sid ? { userId: Number(req.headers['x-konto'] ?? uid), username: NAME } : {};
    if (sid) req.sessionID = String(sid);
    next();
  });
  app.use('/api/v1/auth', require('./helpers/sources').routerAus(_req, 'routes/auth.js'));
  app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const base = `http://localhost:${srv.address().port}`;
  const ruf = async (methode, weg, body, kopf) => {
    const r = await fetch(base + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', ...kopf },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json().catch(() => ({}))).code };
  };
  const A = { 'x-sitzung': 'sitzung-angreifer' },
    O = { 'x-sitzung': 'sitzung-inhaber' };
  const passkeyLoeschen = (code, kopf = A) =>
    ruf('DELETE', '/api/v1/auth/passkeys/999999', { password: PASS, code }, kopf);

  await t.test('das Passwort setzt den Codezähler nicht zurück', async () => {
    await leeren();
    // Jeder Versuch trägt das richtige Passwort; dazwischen der frühere Rücksetzweg (Passwort ohne Code).
    for (let i = 0; i < 4; i++) assert.equal((await passkeyLoeschen(String(100000 + i))).code, 'zweiter_faktor_falsch');
    assert.equal(
      (await ruf('POST', '/api/v1/auth/zweiter-faktor/einrichten', { password: PASS }, A)).code,
      'zweiter_faktor_noetig',
    );
    assert.equal((await passkeyLoeschen('100004')).code, 'zweiter_faktor_falsch');
    const sechster = await passkeyLoeschen(richtig());
    assert.equal(sechster.status, 429, `das Passwort setzt den Codezähler zurück: ${JSON.stringify(sechster)}`);
  });

  await t.test('ein richtiger Code setzt ihn zurück', async () => {
    await leeren();
    for (let i = 0; i < 4; i++) await passkeyLoeschen(String(200000 + i));
    assert.equal((await passkeyLoeschen(richtig())).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await passkeyLoeschen(String(210000 + i))).code, 'zweiter_faktor_falsch');
  });

  await t.test('eine fremde Sitzung sperrt die Notbremsen nicht', async () => {
    await leeren();
    const kopf = { 'x-sitzung': 'karl-fremd', 'x-konto': String(karl) };
    for (let i = 0; i < 5; i++)
      await ruf('POST', '/api/v1/settings/sessions/andere-beenden', { password: `falsch${i}` }, kopf);
    assert.equal(
      (await ruf('POST', '/api/v1/settings/sessions/andere-beenden', { password: PASS }, kopf)).status,
      429,
      'Vorbedingung: die fremde Sitzung ist gesperrt',
    );
    const eigen = { 'x-sitzung': 'karl-eigen', 'x-konto': String(karl) };
    assert.equal(
      (await ruf('POST', '/api/v1/settings/sessions/andere-beenden', { password: PASS }, eigen)).status,
      200,
      'eine fremde Sitzung sperrt die Notbremsen',
    );
    const wechsel = await ruf(
      'POST',
      '/api/v1/auth/change-password',
      { current: PASS, newPassword: 'Neues-Passwort-77' },
      eigen,
    );
    assert.equal(wechsel.status, 200, `eine fremde Sitzung sperrt die Notbremsen: ${JSON.stringify(wechsel)}`);
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [karl, await bcrypt.hash(PASS, 4)]);
  });

  await t.test('falsche Codes einer fremden Sitzung sperren den Inhaber nicht', async () => {
    await leeren();
    for (let i = 0; i < 5; i++) await passkeyLoeschen(String(300000 + i), A);
    assert.equal((await passkeyLoeschen(richtig(), A)).status, 429, 'Vorbedingung: Angreifer gesperrt');
    assert.equal(
      (await passkeyLoeschen(richtig(), O)).status,
      200,
      'falsche Codes einer fremden Sitzung sperren den Inhaber',
    );
  });

  await t.test('der Tausch des Tokens setzt die Bremse nicht zurück', async () => {
    await leeren();
    const token = await createToken(karl, 'Probe', true);
    const mit = tk => ({ authorization: `Bearer ${tk}` });
    for (let i = 0; i < 5; i++) await ruf('DELETE', '/api/v1/bestand', { password: `falsch${i}` }, mit(token));
    assert.equal((await ruf('DELETE', '/api/v1/bestand', { password: PASS }, mit(token))).status, 429, 'Vorbedingung');
    const r = await fetch(`${base}/api/v1/auth/token-rotieren`, { method: 'POST', headers: mit(token) });
    const neu = (await r.json()).token;
    assert.ok(neu, 'Vorbedingung: getauscht');
    assert.equal(
      (await ruf('DELETE', '/api/v1/bestand', { password: PASS }, mit(neu))).status,
      429,
      'der Tausch des Tokens setzt die Bremse zurück',
    );
  });
});
