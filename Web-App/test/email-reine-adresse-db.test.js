/**
 * Eine E-Mail-Adresse ist eine reine Adresse: kein Anzeigename, keine Liste,
 * kein Leer- oder Steuerzeichen. nodemailer las `x1<opfer@…>` als Anzeigenamen
 * und stellte an opfer@… zu, während Vergabeprüfung und Zieldrossel eine
 * andere Zeichenkette zählten. Der Versand prüft das ein zweites Mal und gibt
 * die eine Adresse als Umschlag vor.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  EMAIL_RE wieder /^[^\s@]+@[^\s@]+\.[^\s@]+$/ → rot: „Registrierung
 *      nimmt nur reine Adressen“, „Passwort vergessen und Bestätigung …“,
 *      „das Profil …“ (200 statt 400), „Bestandsdaten werden gemeldet“
 *   B  die Prüfung einzigerEmpfaenger() in sendMail() entfernt → rot: „der
 *      Versand lehnt eine gespeicherte Liste ab“
 *   C  `envelope` in sendMail() entfernt → rot: „der Umschlag nennt genau die
 *      eine Adresse“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'https://lego.example.org';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const nodemailer = require(path.join(__dirname, '..', 'node_modules', 'nodemailer'));
const gesendet = [];
nodemailer.createTransport = () => ({ sendMail: async (m) => { gesendet.push(m); return { messageId: 'x' }; } });

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const mailer = _req('src/infra/mailer.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const P = process.pid, PASS = 'Reine-Adresse-Pass-1';
const UNREIN = ['x1<opfer@example.org>', '"Opfer" <opfer@example.org>', 'opfer@example.org,dritter@example.org',
  'opfer@example.org;x', 'op fer@example.org', 'opfer@example.org\u0007', '(k)opfer@example.org'];

test('nur reine E-Mail-Adressen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const SCHLUESSEL = ['registration_enabled', 'smtp_host', 'smtp_user', 'smtp_from'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const setze = (k, v) => db.run(`INSERT INTO global_settings (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2`, [k, v]);
  await setze('registration_enabled', '1');
  await setze('smtp_host', 'smtp.example.org');
  await setze('smtp_user', 'versand');
  await setze('smtp_from', 'BrickInventory <absender@example.org>');
  const NAME = `rein_${P}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)])).id;
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    await db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot|bestaetigung)'");
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t, routen: { '/api/v1/auth': 'routes/auth.js' } });
  // Die IP-Drossel (5/h) soll die Prüfung der Adresse nicht verdecken.
  const rufe = async (methode, pfad, body) => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot|bestaetigung)'");
    const r = await fetch(`${base}/api/v1/auth${pfad}`, { method: methode,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, code: (await r.json()).code };
  };

  await t.test('Registrierung nimmt nur reine Adressen', async () => {
    for (const [i, email] of UNREIN.entries()) {
      const r = await rufe('POST', '/register', { username: `spam${i}_${P}`, email, password: 'Langes-Passwort-42' });
      assert.deepEqual(r, { status: 400, code: 'email_ungueltig' }, email);
    }
    assert.equal((await db.get('SELECT count(*)::int AS n FROM users WHERE username LIKE $1', [`spam%_${P}`])).n, 0);
    const gut = await rufe('POST', '/register', { username: `gut_${P}`, email: `o'brien.gut_${P}@example.org`, password: 'Langes-Passwort-42' });
    assert.equal(gut.status, 200, 'eine gewöhnliche Adresse mit Apostroph geht weiter');
  });

  await t.test('Passwort vergessen und Bestätigung nehmen nur reine Adressen', async () => {
    for (const weg of ['/forgot-password', '/bestaetigung-erneut'])
      for (const email of UNREIN) assert.deepEqual(await rufe('POST', weg, { email }), { status: 400, code: 'email_ungueltig' }, `${weg} ${email}`);
  });

  await t.test('das Profil nimmt nur reine Adressen', async () => {
    const r = await rufe('PUT', '/profile', { email: 'x<opfer@example.org>', password_current: PASS });
    assert.deepEqual(r, { status: 400, code: 'email_ungueltig' });
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, `${NAME}@example.org`);
  });

  await t.test('der Versand lehnt eine gespeicherte Liste ab', async () => {
    gesendet.length = 0;
    for (const to of UNREIN) {
      const r = await mailer.sendMail({ to, subject: 'Probe', text: 'x' });
      assert.equal(r.success, false, to);
    }
    assert.deepEqual(gesendet, [], 'an eine unreine Adresse wurde versandt');
  });

  await t.test('der Umschlag nennt genau die eine Adresse', async () => {
    gesendet.length = 0;
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Probe', text: 'x' });
    assert.equal(r.success, true);
    assert.deepEqual(gesendet.map(m => m.envelope), [{ from: 'absender@example.org', to: ['ziel@example.org'] }]);
  });

  await t.test('Bestandsdaten werden gemeldet, nicht geändert', async () => {
    const alt = (await db.get(`INSERT INTO users (username, email, password_hash) VALUES ($1, 'x1<opfer@example.org>', 'x')
      RETURNING id`, [`alt_${P}`])).id;
    const warn = console.warn, zeilen = [];
    console.warn = (...a) => zeilen.push(a.join(' '));
    let ids;
    try { ids = await _req('src/konto/konten.js').meldeUngueltigeAdressen(); } finally { console.warn = warn; }
    assert.ok(ids.includes(alt) && !ids.includes(uid), JSON.stringify(ids));
    assert.match(zeilen.join('\n'), new RegExp(`IDs [0-9, ]*\\b${alt}\\b`));
    assert.doesNotMatch(zeilen.join('\n'), /opfer@/, 'die Meldung nennt keine Adresse');
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [alt])).email, 'x1<opfer@example.org>');
  });
});
