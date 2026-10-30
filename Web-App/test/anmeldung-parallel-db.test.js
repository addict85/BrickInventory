/**
 * Gleichzeitige Fehlversuche kommen nicht an der Anmeldesperre vorbei: Ein
 * Versuch belegt seinen Platz, BEVOR das Passwort geprüft wird. Vorher ergaben
 * 50 parallele Fehlversuche 49 Passwortprüfungen statt 5. Dasselbe gilt für
 * die Bestätigung von Passwort und Code in einer laufenden Sitzung.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  checkLoginAllowed wieder mit _read statt _reserviere (Adresse und
 *      Konto) → rot: „20 gleichzeitige Fehlversuche, höchstens 5 Prüfungen“
 *   B  bestaetigungGesperrt wieder mit _read → rot: „Bestätigung: …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('Anmeldesperre unter gleichzeitigen Versuchen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `parallel_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, 1, 1) RETURNING id`, [NAME, bcrypt.hashSync('richtig-geheim', 4)])).id;
  const aufraeumen = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key = $3`,
    [`%|${NAME}`, `%konto:${uid}`, `passwort-bestaetigen|${uid}`]);
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { pruefeAnmeldedaten } = _req('utils/auth.js');
  const lim = _req('utils/loginLimiter.js');

  await t.test('20 gleichzeitige Fehlversuche, höchstens 5 Prüfungen', async () => {
    const anfrage = { ip: '203.0.113.7', socket: {}, headers: {} };
    const r = await Promise.all(Array.from({ length: 20 },
      () => pruefeAnmeldedaten(anfrage, NAME, 'falsch')));
    const geprueft = r.filter(x => x.absage?.status === 401).length;
    const gesperrt = r.filter(x => x.absage?.status === 429).length;
    assert.ok(geprueft <= lim.MAX_ATTEMPTS, `${geprueft} Passwortprüfungen, ${gesperrt} gesperrt`);
    assert.equal(geprueft + gesperrt, 20);
  });

  await t.test('Bestätigung: 20 gleichzeitige Versuche, höchstens 5 frei', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => lim.bestaetigungGesperrt(uid)));
    const frei = r.filter(x => x === null).length;
    assert.ok(frei <= lim.MAX_ATTEMPTS, `${frei} Versuche durchgelassen`);
  });
});
