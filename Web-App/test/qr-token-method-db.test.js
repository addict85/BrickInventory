/**
 * Die QR-Nonce wird per POST angelegt, nicht per GET.
 *
 * ── Der Befund (Nachtrag 154) ───────────────────────────────────────────────
 * /api/auth/qr-token legt eine Nonce an, die fünf Minuten lang ein Konto
 * öffnet. Sie war als GET registriert und hing an der Session — die EINZIGE
 * zustandsändernde Route im Baum mit dieser Kombination.
 *
 * Genau dort lässt SameSite=lax eine Lücke: Bei einer Navigation von einer
 * fremden Seite (window.open, ein Link, location=) schickt der Browser das
 * Sitzungs-Cookie mit. Lesen konnte ein Angreifer die Antwort nicht — quer
 * über Ursprünge hinweg gibt ihm eine Navigation keinen Zugriff auf den
 * Rumpf —, auslösen aber schon. Und dasselbe tun Link-Vorschauen,
 * Virenscanner und die Vorab-Ladelogik der Browser: alles, was GET für
 * gefahrlos hält, weil GET gefahrlos sein SOLL.
 *
 * Diese Prüfung hält beide Richtungen fest: dass POST funktioniert UND dass
 * GET verschwunden ist. Nur das zweite zu prüfen liesse offen, ob die Route
 * überhaupt noch geht; nur das erste liesse zu, dass GET nebenher bestehen
 * bleibt.
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
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
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
  await db.run("INSERT INTO users (username, password_hash) VALUES ('qr','x')");
  _uid = (await db.get("SELECT id FROM users WHERE username='qr'")).id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: _uid }; next(); });
  app.use('/api/auth', _req('routes/auth.js'));
  _srv  = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;

  const ruf = async (methode) => {
    const r = await fetch(`${_base}/api/auth/qr-token`, { method: methode, redirect: 'manual' });
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
      'GET /api/auth/qr-token antwortet wieder mit 200 — damit ist die ' +
      'SameSite=lax-Lücke aus Nachtrag 154 zurück: eine Navigation von einer ' +
      'fremden Seite legt dann wieder eine Anmelde-Nonce an.');
    assert.equal(await nonces(), vorher, 'Ein GET hat trotzdem etwas angelegt');
  });

  _srv?.close();
  await db.pool.end().catch(() => {});
});
