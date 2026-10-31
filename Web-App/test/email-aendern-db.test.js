/**
 * Eine neue E-Mail-Adresse verlangt das aktuelle Passwort, und die alte Adresse
 * erfährt davon. Über die neue Adresse liesse sich sonst das Passwort
 * zurücksetzen: Eine kurz offene fremde Sitzung genügte zur Übernahme.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Passwortprüfung im E-Mail-Zweig von PUT /profile entfernt → rot:
 *      „ohne Passwort", „falsches Passwort", „mit Passwort" (die Adresse war
 *      schon im ersten Teiltest gewechselt)
 *   B  den Hinweis an die alte Adresse entfernt → rot: „mit Passwort"
 *      (keine Mail an die alte Adresse)
 *   C  `password` in PUT /profile wieder angenommen → rot: „Passwort nur über
 *      change-password"
 *   D  getBaseUrl() fällt in Produktion wieder auf den Host-Kopf zurück → rot:
 *      „in Produktion ohne APP_BASE_URL kein Link aus dem Host-Kopf"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');

// Versandte Hinweise mitschreiben, bevor routes/auth die Mail-Funktionen bindet.
const gesendet = [];
const bestaetigt = [];
const mailerPfad = require.resolve(path.join(require('./helpers/sources').DIST, 'src/infra/mailer.js'));
const echt = _req('src/infra/mailer.js');
require.cache[mailerPfad].exports = Object.assign({}, echt, {
  sendEmailGeaendertMail: async (an, name, neu) => { gesendet.push({ an, name, neu }); return { success: true }; },
  sendVerificationMail: async (an, name, token, basis) => { bestaetigt.push(basis); return { success: true }; },
});

const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `mailneu_${process.pid}`, PASS = 'Passwort12345';

test('E-Mail ändern', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, 1, 1) RETURNING id`,
    [NAME, `${NAME}@alt.example`, await bcrypt.hash(PASS, 4)])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME },
                                     routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const profil = async (body) => {
    const r = await fetch(`${base}/api/v1/auth/profile`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, ...body }) });
    return { status: r.status, body: await r.json() };
  };
  const adresse = async () => (await db.get('SELECT email FROM users WHERE id = $1', [uid])).email;

  await t.test('ohne Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example` });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'aktuelles_passwort_erforderlich');
    assert.equal(await adresse(), `${NAME}@alt.example`);
  });

  await t.test('falsches Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example`, password_current: 'falsch-falsch' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'aktuelles_passwort_falsch');
    assert.equal(await adresse(), `${NAME}@alt.example`);
  });

  await t.test('mit Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example`, password_current: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.emailChanged, true);
    assert.equal(await adresse(), `${NAME}@neu.example`);
    assert.deepEqual(gesendet, [{ an: `${NAME}@alt.example`, name: NAME, neu: `${NAME}@neu.example` }],
      'Die bisherige Adresse muss erfahren, dass das Konto eine neue hat');
  });

  await t.test('ohne neue Adresse kein Passwort nötig', async () => {
    const r = await profil({ email: `${NAME}@neu.example`, first_name: 'Neu' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('in Produktion ohne APP_BASE_URL kein Link aus dem Host-Kopf', async () => {
    const vorher = { env: process.env.NODE_ENV, basis: process.env.APP_BASE_URL };
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;
    try {
      bestaetigt.length = 0;
      const r = await profil({ email: `${NAME}@drei.example`, password_current: PASS });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.emailSent, false);
      assert.deepEqual(bestaetigt, [], 'ohne feste Adresse darf kein Link verschickt werden');
      process.env.APP_BASE_URL = 'https://lego.example.org/';
      await profil({ email: `${NAME}@vier.example`, password_current: PASS });
      assert.deepEqual(bestaetigt, ['https://lego.example.org']);
    } finally {
      process.env.NODE_ENV = vorher.env;
      if (vorher.basis === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = vorher.basis;
    }
  });

  await t.test('Passwort nur über change-password', async () => {
    const vorher = (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;
    const r = await profil({ password: 'GanzNeuesPasswort1', password_current: PASS });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'passwort_ueber_change_password');
    assert.equal((await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash, vorher);
  });
});
