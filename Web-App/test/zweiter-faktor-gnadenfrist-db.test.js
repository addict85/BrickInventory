/**
 * Gnadenfrist beim Einrichten des zweiten Faktors: Ein Verwalter ohne Faktor
 * (dort erzwingt ihn der Server), der sich eben mit dem Passwort angemeldet
 * (oder es gewechselt) hat, richtet ohne erneute Eingabe ein — einmal,
 * höchstens fünf Minuten lang, nur mit Sitzung. Jedes andere Konto nennt das Passwort. Ohne Frist und …
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  in angemeldetAntworten `passwortBestaetigtAm` nie gesetzt → rot:
 *      „nach der Anmeldung ohne Passwort“ (400 statt 200)
 *   B  in gnadenfristVerbrauchen das `delete` entfernt → rot: „nur einmal“,
 *      „ohne Frist zählt nicht in der Bremse“
 *   C  PASSWORT_GNADENFRIST_MS auf eine Stunde → rot: „nach Ablauf der Frist“
 *   D  in der Route die Absage ohne Frist entfernt (leeres Passwort geht in
 *      die Prüfung) → rot: „nur einmal“, „nach Ablauf der Frist“, „ohne Frist
 *      zählt nicht in der Bremse“, „mit Token nie“ (aktuelles_passwort_falsch)
 *   E  gnadenfristVerbrauchen gibt Token-Zugriffen die Frist → rot: „mit Token nie“
 *   F  (04.11.) in der Route wieder `!zf.istAktiv(uid)` statt zweiterFaktorPflicht(req)
 *      → rot: „ein gewöhnliches Konto nennt immer das Passwort“ (200 statt 400)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Gnaden-Passwort-1';

test('Gnadenfrist beim Einrichten des zweiten Faktors', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `gnade_${process.pid}`,
    NUTZER = `gnade_n_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NUTZER]]);
  const konto = async (n, verwalter) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4), verwalter],
      )
    ).id;
  const uid = await konto(NAME, true),
    nutzer = await konto(NUTZER, false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, nutzer]]).catch(() => {});
    for (const id of [uid, nutzer])
      await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%|${id}|%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Die Sitzung ist ein Objekt über alle Anfragen; die Anmeldung schreibt hinein.
  const sitzung = {};
  const basis = testServer(_req, { sitzung, routen: { '/api/v1/auth': 'routes/auth.js' }, t }).base;
  const ruf = async (weg, body, kopf = {}) => {
    const r = await fetch(`${basis}/api/v1/auth${weg}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...kopf },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const anmelden = async (name = NAME) => {
    for (const k of Object.keys(sitzung)) delete sitzung[k];
    const r = await ruf('/login', { username: name, password: PASS, ohne_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const einrichten = (body = {}) => ruf('/zweiter-faktor/einrichten', body);

  await t.test('nach der Anmeldung ohne Passwort', async () => {
    await anmelden();
    const r = await einrichten();
    assert.equal(r.status, 200, `nach der Anmeldung ohne Passwort: ${JSON.stringify(r.body)}`);
    assert.match(r.body.otpauth, /^otpauth:\/\//);
  });

  await t.test('nur einmal', async () => {
    const r = await einrichten();
    assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_erforderlich'], 'nur einmal');
    const mit = await einrichten({ password: PASS });
    assert.equal(mit.status, 200, 'mit Passwort weiter wie bisher');
  });

  await t.test('nach Ablauf der Frist', async () => {
    await anmelden();
    sitzung.passwortBestaetigtAm = Date.now() - 6 * 60 * 1000;
    const r = await einrichten();
    assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_erforderlich'], 'nach Ablauf der Frist');
  });

  await t.test('nach dem Passwortwechsel', async () => {
    await anmelden();
    delete sitzung.passwortBestaetigtAm;
    const w = await ruf('/change-password', { current: PASS, newPassword: 'Gnaden-Passwort-2' });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [uid, await bcrypt.hash(PASS, 4)]);
    const r = await einrichten();
    assert.equal(r.status, 200, `nach dem Passwortwechsel: ${JSON.stringify(r.body)}`);
  });

  await t.test('ohne Frist zählt nicht in der Bremse', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await einrichten()).body.code, 'aktuelles_passwort_erforderlich');
    const r = await einrichten({ password: PASS });
    assert.equal(r.status, 200, `ohne Frist zählt nicht in der Bremse: ${JSON.stringify(r.body)}`);
  });

  await t.test('mit Token nie', async () => {
    for (const k of Object.keys(sitzung)) delete sitzung[k];
    const login = await ruf('/login', { username: NAME, password: PASS });
    assert.ok(login.body.token, JSON.stringify(login.body));
    assert.equal(sitzung.userId, undefined, 'Vorbedingung: keine Sitzung');
    const r = await ruf('/zweiter-faktor/einrichten', {}, { authorization: `Bearer ${login.body.token}` });
    assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_erforderlich'], 'mit Token nie');
  });

  await t.test('ein gewöhnliches Konto nennt immer das Passwort', async () => {
    await anmelden(NUTZER);
    const r = await einrichten();
    assert.deepEqual(
      [r.status, r.body.code],
      [400, 'aktuelles_passwort_erforderlich'],
      'ein gewöhnliches Konto ohne Passwort',
    );
    assert.equal((await einrichten({ password: PASS })).status, 200, 'mit Passwort');
  });
});
