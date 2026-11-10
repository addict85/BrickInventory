/**
 * Die QR-Nonce wird per POST angelegt, nicht per GET.
 *
 * Die Nonce öffnet fünf Minuten lang ein Konto. Per GET mit Sitzungs-Cookie
 * könnte eine fremde Seite sie trotz SameSite=lax auslösen (Navigation), und
 * Link-Vorschauen täten es nebenbei. Geprüft sind beide Richtungen: POST geht,
 * GET gibt es nicht mehr.
 *
 * ── Gegenprobe (durchgeführt) ───────────────────────────────────────────────
 * Die Route versuchsweise auf `router.get` zurückgestellt: „per GET gibt es
 * die Route nicht mehr" wird rot (200 statt 404), und „per POST wird eine
 * Nonce angelegt" wird ebenfalls rot. Zurückgebaut, wieder grün.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Seit der QR-Code die Adresse des Servers traegt (src/infra/basisUrl.ts), ist
// APP_BASE_URL eine VORBEDINGUNG der Route: Ohne sie sagt sie mit 503 ab,
// damit kein Code mit der Browseradresse hinausgeht. Diese Datei prueft etwas
// anderes — hier wird die Vorbedingung nur erfuellt, nicht geprueft. Das tut
// test/qr-adresse.test.js.
process.env.APP_BASE_URL = 'https://lego.example.org';

const _req = require('./helpers/sources').buildAndRequire();
// Adresse aus server.ts lesen — siehe einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').einhaengung('auth');
const db   = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

let _srv, _base, _uid;
test('QR-Nonce nur per POST', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }
  const bcrypt = require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs'));
  await db.run("INSERT INTO users (username, password_hash) VALUES ('qr', $1)", [await bcrypt.hash('qr-passwort-1', 4)]);
  _uid = (await db.get("SELECT id FROM users WHERE username='qr'")).id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: _uid }; next(); });
  app.use(AUTH, _req('routes/auth.js'));
  _srv  = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;

  const ruf = async (methode) => {
    const r = await fetch(`${_base}${AUTH}/qr-token`, {
      method: methode, redirect: 'manual',
      ...(methode === 'POST' ? { headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ password: 'qr-passwort-1' }) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const nonces = async () =>
    Number((await db.get('SELECT COUNT(*)::int AS n FROM qr_login_tokens').catch(() => ({ n: 0 }))).n);

  await t.test('per POST wird eine Nonce angelegt', async () => {
    const vorher = await nonces();
    const r = await ruf('POST');
    assert.equal(r.status, 200, `Erwartet 200, bekam ${r.status}`);
    assert.equal(r.body?.success, true);
    assert.match(String(r.body?.token), /^bim:/, 'Der Token trägt das erwartete Präfix nicht');
    assert.equal(await nonces(), vorher + 1, 'Es wurde keine Nonce angelegt');
  });

  await t.test('per GET gibt es die Route nicht mehr', async () => {
    const vorher = await nonces();
    const r = await ruf('GET');
    assert.notEqual(r.status, 200,
      'GET ' + AUTH + '/qr-token antwortet wieder mit 200 — damit ist die ' +
      'SameSite=lax-Lücke aus einer früheren Runde zurück: eine Navigation von einer ' +
      'fremden Seite legt dann wieder eine Anmelde-Nonce an.');
    assert.equal(await nonces(), vorher, 'Ein GET hat trotzdem etwas angelegt');
  });

  _srv?.close();
  await db.pool.end().catch(() => {});
});
