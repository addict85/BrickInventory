/**
 * Geräte- und Passkey-Namen stehen wörtlich in der Hinweismail an den
 * Inhaber. Ein Name mit Webadresse, Anführungszeichen oder Steuerzeichen
 * wird an allen drei Wegen abgewiesen (400 geraetename_ungueltig), bevor
 * etwas entsteht; gewöhnliche Gerätenamen bleiben erlaubt.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  die Prüfung in POST /login entfernt → rot: „POST /login …“ (200 bzw.
 *      401 statt 400)
 *   B  die Prüfung in POST /token-create entfernt → rot: „POST /token-create …“
 *      (Absage erst an der Bestätigung)
 *   C  die Prüfung in POST /passkey/registrieren entfernt → rot: „POST
 *      /passkey/registrieren …“ (400 passkey_ungueltig)
 *   D  geraeteNameGueltig() ohne die Prüfung auf Anführungszeichen → rot:
 *      „die Regel“, „ein Satz in Anführungszeichen …“ und die drei Wege
 *      (ihre Liste enthält ein solches Beispiel)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const AUTH = require('./helpers/sources').einhaengung('auth');
const { geraeteNameGueltig } = _req('src/konto/namensRegeln.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const BOESE = [
  'x https://evil.example',
  'Pixel") erzeugt. Alles in Ordnung',
  'brick-hilfe.example',
  'Zeile\nzwei',
  'www.evil.example',
  'Telefon   Rückfragen',
];
const GUT = ['Pixel 8 Pro', 'Android App', 'Galaxy S10.1', 'iPad (Küche)', 'Firefox auf Linux'];

test('Gerätenamen: die Regel', () => {
  for (const n of BOESE) assert.equal(geraeteNameGueltig(n), false, JSON.stringify(n));
  for (const n of GUT) assert.equal(geraeteNameGueltig(n), true, JSON.stringify(n));
  assert.equal(geraeteNameGueltig(undefined), true, 'ohne Namen gilt die Vorgabe');
});

test('Gerätenamen an allen drei Wegen', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const NAME = `geraet_${process.pid}`,
    PASS = 'Geraete-Passwort-17';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid, username: NAME },
    t,
    routen: { [AUTH]: 'routes/auth.js' },
  });
  const post = async (weg, body) => {
    const r = await fetch(`${base}${AUTH}${weg}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json()).code };
  };
  const abgewiesen = { status: 400, code: 'geraetename_ungueltig' };

  await t.test('POST /login', async () => {
    for (const label of BOESE)
      assert.deepEqual(
        await post('/login', { username: NAME, password: PASS, label }),
        abgewiesen,
        JSON.stringify(label),
      );
    const gut = await post('/login', { username: NAME, password: PASS, label: 'Pixel 8 Pro' });
    assert.equal(gut.status, 200, JSON.stringify(gut));
  });

  await t.test('POST /token-create', async () => {
    for (const label of BOESE)
      assert.deepEqual(await post('/token-create', { password: PASS, label }), abgewiesen, JSON.stringify(label));
    assert.equal((await post('/token-create', { password: PASS, label: 'Galaxy S10.1' })).status, 200);
  });

  await t.test('POST /passkey/registrieren', async () => {
    for (const name of BOESE)
      assert.deepEqual(await post('/passkey/registrieren', { antwort: {}, name }), abgewiesen, JSON.stringify(name));
  });

  await t.test('ein Satz in Anführungszeichen bleibt draussen', async () => {
    assert.deepEqual(
      await post('/login', { username: NAME, password: PASS, label: 'Handy" — alles in Ordnung' }),
      abgewiesen,
    );
  });
});
