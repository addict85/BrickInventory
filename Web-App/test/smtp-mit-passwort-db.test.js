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
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `smtp_chef_${process.pid}`, PASS = 'chef-Passwort-1';

test('SMTP nur mit Passwort', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, 1, 1, 1) RETURNING id`, [NAME, bcrypt.hashSync(PASS, 4)])).id;
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.alt.example')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const landVorher = (await db.get("SELECT value FROM global_settings WHERE key = 'gutschein_land'"))?.value;
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_insecure_tls', 'gutschein_land')");
    if (landVorher !== undefined)
      await db.run("INSERT INTO global_settings (key, value) VALUES ('gutschein_land', $1)", [landVorher]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`passwort-bestaetigen|${uid}`]);
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
    assert.equal(r.body.code, 'aktuelles_passwort_falsch');
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
});
