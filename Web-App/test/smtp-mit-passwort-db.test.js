/**
 * Den Mailserver ändert ein Verwalter nur mit seinem Passwort. Über ihn gehen
 * die Rücksetz-Links; mit einer erbeuteten Sitzung allein liesse er sich sonst
 * umbiegen. Speichern ohne Änderung fragt nicht nach.
 *
 * Gegenprobe (am 28.10.2026 gemessen): die Passwortprüfung in POST
 * /api/v1/settings entfernt → rot: „ohne Passwort bleibt der Mailserver“.
 * Gegenprobe (am 29.10.2026 gemessen): smtp_* wieder in die Schlüsselliste
 * von POST /import → rot: „der Import stellt den Mailserver nicht um“
 * (smtp_host war danach mail.angreifer.example).
 *
 * Registrierung und API-Schlüssel ebenso (seit 04.11.2026), die Verwalter
 * erfahren es per Mail. Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  istHeikel() wieder nur smtp_* → rot: „ohne Passwort bleiben Registrierung
 *      und API-Schlüssel“ (200 statt 400)
 *   B  verwalterHinweisNebenher() in POST /settings entfernt → rot: „mit
 *      Passwort geändert, die Verwalter erfahren es“
 *   C  die Absage ohne admin_password vor der Prüfung entfernt → rot: „ohne
 *      Passwort bleibt der Mailserver“, „ohne Passwort bleiben Registrierung …“
 *      (aktuelles_passwort_falsch, zählt zur Bremse)
 *
 * Ein erster API-Schlüssel (vorher leer) braucht kein Passwort, solange die
 * Einrichtung offen ist: Der Assistent fragt sonst mitten im Schritt nach.
 * Danach gilt auch für ihn die Passwortpflicht (Runde 12, H1).
 * Gegenproben (04.11.2026 gemessen):
 *   D  die Ausnahme für leere Werte entfernt → rot: „ein erster API-Schlüssel
 *      braucht in der Einrichtung kein Passwort“ (400 statt 200)
 *   E  die Ausnahme wieder ohne `einrichtung &&` → rot: „nach der Einrichtung
 *      auch ein erster Schlüssel nur mit Passwort“ (200 statt 400)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Die Registrierung lässt sich nur mit Mailversand einschalten (mailBereit: Mailserver und Adresse).
process.env.APP_BASE_URL = 'https://inventar.example.org';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const mails = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _n, art, o) => { mails.push({ an, art, konto: o.konto }); return { success: true }; },
});
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtp_chef_${process.pid}`, PASS = 'chef-Passwort-1';

test('SMTP nur mit Passwort', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $3, $2, true, true, true) RETURNING id`, [NAME, bcrypt.hashSync(PASS, 4), `${NAME}@example.org`])).id;
  const HEIKEL = ['registration_enabled', 'rebrickable_api_key', 'brickset_api_key', 'einrichtung_erledigt'];
  const heikelVorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [HEIKEL]);
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.alt.example'), ('smtp_user', 'versand')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const landVorher = (await db.get("SELECT value FROM global_settings WHERE key = 'gutschein_land'"))?.value;
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'smtp_insecure_tls', 'gutschein_land')");
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [HEIKEL]);
    for (const z of heikelVorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    if (landVorher !== undefined)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('gutschein_land', $1)", [landVorher]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%-bestaetigen|${uid}|%`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true },
    routen: { '/api/v1': 'routes/api_v1/settings.js' }, t });
  const speichern = (body) => fetch(`${base}/api/v1/settings`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const host = async () => (await db.get("SELECT value FROM global_settings WHERE key = 'smtp_host'"))?.value;

  await t.test('ohne Passwort bleibt der Mailserver', async () => {
    const r = await speichern({ smtp_host: 'mail.angreifer.example' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'aktuelles_passwort_erforderlich');
    assert.equal(await host(), 'mail.alt.example');
  });

  await t.test('unverändert speichern fragt nicht nach', async () => {
    const r = await speichern({ smtp_host: 'mail.alt.example', language: 'de' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('mit Passwort wird er geändert', async () => {
    const r = await speichern({ smtp_host: 'mail.neu.example', admin_password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await host(), 'mail.neu.example');
  });

  await t.test('der Import stellt den Mailserver nicht um', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_insecure_tls'");
    const fd = new FormData();
    fd.append('file', new Blob([JSON.stringify({ global: {
      smtp_host: 'mail.angreifer.example', smtp_insecure_tls: '1', gutschein_land: 'AT' } })],
      { type: 'application/json' }), 'config.json');
    const r = await fetch(`${base}/api/v1/settings/import`, { method: 'POST', body: fd })
      .then(async x => ({ status: x.status, body: await x.json() }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await host(), 'mail.neu.example', 'smtp_host kam über den Import');
    assert.equal((await db.get("SELECT value FROM global_settings WHERE key = 'smtp_insecure_tls'"))?.value,
      undefined, 'smtp_insecure_tls kam über den Import');
    // Der Rest der Datei kommt an — sonst prüfte der Fall einen Import, der gar nichts tut.
    assert.equal((await db.get("SELECT value FROM global_settings WHERE key = 'gutschein_land'"))?.value, 'AT');
    assert.deepEqual(r.body.smtp_uebergangen, ['smtp_host', 'smtp_insecure_tls']);
  });

  const wert = async (k) => (await db.get('SELECT value FROM global_settings WHERE key = $1', [k]))?.value;
  await t.test('ein erster API-Schlüssel braucht in der Einrichtung kein Passwort', async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('rebrickable_api_key', 'einrichtung_erledigt')");
    const r = await speichern({ rebrickable_api_key: 'erster-schluessel' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await _req('src/einstellungen/settings.js').getGlobalSetting('rebrickable_api_key'), 'erster-schluessel');
  });

  await t.test('nach der Einrichtung auch ein erster Schlüssel nur mit Passwort', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'brickset_api_key'");
    await db.run("INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1')");
    const r = await speichern({ brickset_api_key: 'erster-fremder' });
    assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_erforderlich']);
    assert.equal(await wert('brickset_api_key'), undefined);
  });

  await t.test('ohne Passwort bleiben Registrierung und API-Schlüssel', async () => {
    await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '0') ON CONFLICT (key) DO UPDATE SET value = '0'");
    for (const body of [{ registration_enabled: '1' }, { rebrickable_api_key: 'fremder-schluessel' }]) {
      const r = await speichern(body);
      assert.deepEqual([r.status, r.body.code], [400, 'aktuelles_passwort_erforderlich'], JSON.stringify(body));
    }
    assert.equal(await wert('registration_enabled'), '0');
    assert.notEqual(await wert('rebrickable_api_key'), 'fremder-schluessel');
  });

  await t.test('mit Passwort geändert, die Verwalter erfahren es', async () => {
    mails.length = 0;
    const r = await speichern({ registration_enabled: '1', admin_password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await wert('registration_enabled'), '1');
    for (let i = 0; i < 60 && !mails.some(m => m.an === `${NAME}@example.org`); i++) await new Promise(x => setTimeout(x, 25));
    assert.deepEqual(mails.filter(m => m.an === `${NAME}@example.org`),
      [{ an: `${NAME}@example.org`, art: 'einstellungen_geaendert', konto: 'registration_enabled' }]);
  });
});
