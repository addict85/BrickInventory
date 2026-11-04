/**
 * Die Registrierung ist nur bei genau '1' offen — Anzeige und Durchsetzung
 * fragen dieselbe Funktion. Ja/Nein-Einstellungen nehmen beim Schreiben nur
 * 0 oder 1 an, über das Formular wie über den Import.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  routes/auth.ts auf Stand e21f747 (Sperre nur bei `=== '0'`) → rot ab
 *      „ohne Zeile bleibt sie zu" (Konto angelegt, 200)
 *   B  registrierungOffen() mit `!== '0'` → rot: „ohne Zeile …" und „"false"
 *      ist zu" (die Anzeige meldet enabled: true)
 *   C  globalerWertGueltig() liefert immer true → rot: „das Formular nimmt nur
 *      0 oder 1" (200, "false" gespeichert)
 *   E  (04.11.) registration_enabled wieder ohne Bestätigung im Import → rot:
 *      „der Import übergeht die Registrierung"
 *   D  (02.11.) passkey/passwort_vergessen fest true → rot: „Anmeldewege
 *      nur, wenn der Server sie kann" (ohne APP_BASE_URL true); nur
 *      basisUrl() ohne mailEingerichtet() → rot (ohne SMTP true)
 *   F  (04.11.) registration-status und /register ohne mailBereit() → rot:
 *      „ohne Mailversand bleibt sie zu …“; ebenso die Prüfung beim Einschalten
 *      in POST /settings entfernt
 *   G  (04.11.) schalteRegistrierungFrei() lässt registrierung_offen stehen oder
 *      die Route protokolliert nicht → rot: „der Verwalter schaltet … frei“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { mailAttrappe } = require('./helpers/mail-attrappe');
mailAttrappe();
const db = _req('db/database.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('Registrierung und Ja/Nein-Einstellungen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const CHEF = `reg_chef_${process.pid}`, PASS = 'Chef-Passwort-1', NEU = `reg_neu_${process.pid}`;
  const vorher = await db.all("SELECT key, value FROM global_settings WHERE key IN ('registration_enabled', 'smtp_secure', 'smtp_host', 'smtp_user')");
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NEU]]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`, [CHEF, bcrypt.hashSync(PASS, 4)])).id;
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register|%'");
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('registration_enabled', 'smtp_secure', 'smtp_host', 'smtp_user')");
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, NEU]]);
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t,
    routen: { '/api/v1/auth': 'routes/auth.js', '/api/v1': 'routes/api_v1/settings.js' } });
  const rufe = (methode, pfad, body) => fetch(`${base}/api/v1${pfad}`, { method: methode,
    headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const setze = async (wert) => {
    await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    if (wert !== null) await db.run("INSERT INTO global_settings (key, value) VALUES ('registration_enabled', $1)", [wert]);
  };
  const registriere = () => rufe('POST', '/auth/register',
    { username: NEU, email: `${NEU}@example.org`, password: 'Neues-Passwort-1' });
  const gespeichert = async (key) => (await db.get('SELECT value FROM global_settings WHERE key = $1', [key]))?.value;

  for (const [fall, wert] of [['ohne Zeile bleibt sie zu', null], ['"false" ist zu', 'false'], ['"0" ist zu', '0']]) {
    await t.test(fall, async () => {
      await setze(wert);
      assert.equal((await rufe('GET', '/auth/registration-status')).body.enabled, false);
      const r = await registriere();
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.code, 'registrierung_deaktiviert');
      assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [NEU]), undefined);
    });
  }

  await t.test('Anmeldewege nur, wenn der Server sie kann', async () => {
    const alt = process.env.APP_BASE_URL;
    t.after(() => { if (alt === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = alt; });
    const wege = async () => { const b = (await rufe('GET', '/auth/registration-status')).body; return [b.passkey, b.passwort_vergessen]; };
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user')");
    delete process.env.APP_BASE_URL;
    assert.deepEqual(await wege(), [false, false], 'ohne Adresse');
    process.env.APP_BASE_URL = 'http://192.168.1.20:3000';
    assert.deepEqual(await wege(), [false, false], 'IP-Adresse, ohne Mail');
    process.env.APP_BASE_URL = 'https://inventar.example.org';
    assert.deepEqual(await wege(), [true, false], 'Domäne, ohne Mail');
    await db.run("INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.example.org'), ('smtp_user', 'inventar')");
    assert.deepEqual(await wege(), [true, true], 'Domäne und Mail');
  });

  await t.test('"1" öffnet sie', async () => {
    await setze('1');
    assert.equal((await rufe('GET', '/auth/registration-status')).body.enabled, true);
    const r = await registriere();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(await db.get('SELECT id FROM users WHERE username = $1', [NEU]));
  });

  await t.test('ohne Mailversand bleibt sie zu und lässt sich nicht einschalten', async () => {
    process.env.APP_BASE_URL = 'https://inventar.example.org';
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user')");
    const s = (await rufe('GET', '/auth/registration-status')).body;
    assert.deepEqual([s.enabled, s.mail_versand], [false, false], 'trotz "1"');
    const r = await rufe('POST', '/auth/register', { username: `${NEU}_x`, email: `${NEU}_x@example.org`, password: 'Neues-Passwort-1' });
    assert.deepEqual([r.status, r.body.code], [403, 'registrierung_deaktiviert']);
    await setze('0');
    const ein = await rufe('POST', '/settings', { registration_enabled: '1', admin_password: PASS });
    assert.deepEqual([ein.status, ein.body.code], [400, 'registrierung_braucht_mail']);
    assert.equal(await gespeichert('registration_enabled'), '0');
    const mitMail = await rufe('POST', '/settings', { registration_enabled: '1', smtp_host: 'mail.example.org', smtp_user: 'inventar', admin_password: PASS });
    assert.equal(mitMail.status, 200, JSON.stringify(mitMail.body));
    assert.equal(await gespeichert('registration_enabled'), '1');
  });

  await t.test('der Verwalter schaltet eine offene Registrierung frei', async () => {
    const { assertLoginAllowed } = _req('src/konto/auth.js');
    const neu = (await db.get('SELECT id FROM users WHERE username = $1', [NEU])).id;
    const zeile = () => db.get('SELECT * FROM users WHERE id = $1', [neu]);
    const inListe = async () => (await rufe('GET', '/auth/users')).body.users.find(u => u.id === neu);
    assert.equal((await inListe()).wartet_auf_bestaetigung, true);
    assert.equal(assertLoginAllowed(await zeile())?.code, 'email_nicht_bestaetigt');
    assert.equal((await rufe('PUT', `/auth/users/${neu}/freischalten`, {})).status, 400, 'ohne Passwort');
    const r = await rufe('PUT', `/auth/users/${neu}/freischalten`, { admin_password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const z = await zeile();
    assert.deepEqual([z.email, z.email_verified, z.registrierung_offen, z.email_neu], [`${NEU}@example.org`, true, false, null]);
    assert.equal(assertLoginAllowed(z), null);
    assert.equal((await inListe()).wartet_auf_bestaetigung, false);
    assert.equal((await db.get('SELECT aktion FROM verwaltungsprotokoll WHERE ziel_id = $1 ORDER BY id DESC LIMIT 1', [neu])).aktion, 'konto_freigeschaltet');
    const nochmal = await rufe('PUT', `/auth/users/${neu}/freischalten`, { admin_password: PASS });
    assert.deepEqual([nochmal.status, nochmal.body.code], [409, 'konto_nicht_wartend']);
  });

  await t.test('das Formular nimmt nur 0 oder 1', async () => {
    for (const falsch of ['false', 'true', 'ja', '']) {
      const r = await rufe('POST', '/settings', { registration_enabled: falsch });
      assert.equal(r.status, 400, `${falsch}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'wert_ungueltig');
    }
    const smtpVorher = await gespeichert('smtp_secure');
    assert.equal((await rufe('POST', '/settings', { smtp_secure: 'yes', admin_password: PASS })).status, 400);
    assert.equal(await gespeichert('registration_enabled'), '1');
    assert.equal(await gespeichert('smtp_secure'), smtpVorher);
    assert.equal((await rufe('POST', '/settings', { registration_enabled: '0', admin_password: PASS })).status, 200);
    assert.equal(await gespeichert('registration_enabled'), '0');
  });

  await t.test('der Import übergeht die Registrierung', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([JSON.stringify({ global: { registration_enabled: '1' } })], { type: 'application/json' }), 'config.json');
    const r = await fetch(`${base}/api/v1/settings/import`, { method: 'POST', body: fd }).then(async x => ({ status: x.status, body: await x.json() }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await gespeichert('registration_enabled'), '0', 'der Import öffnete die Registrierung');
    assert.deepEqual(r.body.smtp_uebergangen, ['registration_enabled']);
  });
});
