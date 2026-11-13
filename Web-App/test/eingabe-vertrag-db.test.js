/**
 * Eingaben werden im Betrieb gegen den Vertrag geprüft, bevor die Route läuft
 * (eingabePruefen in src/http/vertragsRouter.ts, von vertragsRouter() vor
 * jeden Endpunkt gesetzt). Eine Liste statt eines Textes kam vorher an
 * USERNAME_RE vorbei bis ins SQL, und Freitext war unbegrenzt.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in vertragsRouter() das Einsetzen von eingabePruefen entfernt → rot:
 *      „eine Liste statt eines Namens ist 400“, „Freitext ist begrenzt“ und
 *      „ein wiederholter Abfragewert ist 400“
 *   B  in eingabePruefen die Abfrageprüfung entfernt → rot: „ein
 *      wiederholter Abfragewert ist 400“
 *   C  in eingabePruefen den eigenen Fehler der Prüfer übergangen (immer
 *      eingabe_ungueltig) → rot: „die Prüfer aus validate.ts antworten wie die
 *      Route“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');
const db = testDaten();

test('Eingaben gegen den Vertrag', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `eingabe_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const PASS = 'Eingabe-Passwort-1';
  const hash = await require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs')).hash(PASS, 4);
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id`, [
      NAME,
      hash,
    ])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const codes = await verwalterMitFaktor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const sende = async (methode, pfad, rumpf) => {
    const r = await fetch(base + pfad, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: rumpf === undefined ? undefined : JSON.stringify(rumpf),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j.code ?? null, error: j.error ?? null };
  };

  await t.test('eine Liste statt eines Namens ist 400', async () => {
    const r = await sende('POST', '/api/v1/auth/register', {
      username: ['abc'],
      email: 'a@b.ch',
      password: 'Lang-genug-1234',
    });
    assert.deepEqual([r.status, r.code], [400, 'eingabe_ungueltig']);
    assert.match(r.error, /username/);
    const kein = await sende('POST', '/api/v1/auth/login', { username: { $ne: 1 }, password: 'x' });
    assert.deepEqual([kein.status, kein.code], [400, 'eingabe_ungueltig']);
  });

  await t.test('Freitext ist begrenzt', async () => {
    const r = await sende('PUT', '/api/v1/auth/profile', { first_name: 'x'.repeat(101) });
    assert.deepEqual([r.status, r.code], [400, 'eingabe_ungueltig']);
    const ok = await sende('PUT', '/api/v1/auth/profile', {
      first_name: 'Marco',
      last_name: null,
      password_current: PASS,
      code: codes.shift(),
    });
    assert.equal(ok.status, 200, `gültige Eingabe abgewiesen: ${ok.code}`);
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [uid])).first_name, 'Marco');
  });

  await t.test('ein wiederholter Abfragewert ist 400', async () => {
    assert.equal((await sende('GET', '/api/v1/auth/profile?x=1')).status, 200);
    const r = await sende('GET', '/api/v1/auth/profile?x=1&x=2');
    assert.deepEqual([r.status, r.code], [400, 'eingabe_ungueltig']);
  });

  await t.test('die Prüfer aus validate.ts antworten wie die Route', async () => {
    const r = await sende('PUT', `/api/v1/auth/users/${uid}/admin`, { is_admin: 'vielleicht' });
    assert.equal(r.status, 400);
    assert.notEqual(r.code, 'eingabe_ungueltig');
    assert.match(r.error, /is_admin/);
  });

  await t.test('ohne Anmeldung bleibt es 401, nicht 400', async () => {
    const { base: offen } = testServer(_req, { sitzung: {}, t });
    const r = await fetch(`${offen}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: ['x'] }),
    });
    assert.equal(r.status, 401);
  });
});
