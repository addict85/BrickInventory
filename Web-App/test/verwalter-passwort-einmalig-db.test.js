/**
 * Ein Passwort, das ein Verwalter vergibt (neues Konto oder fremdes Passwort
 * gesetzt), gilt nur bis zur ersten Anmeldung: Danach lässt der Server nur
 * den Wechsel zu (403 passwort_wechsel_noetig), erst das eigene Passwort
 * öffnet den Rest. Am echten Server (dist/server.js) mit echtem Verwalter
 * samt zweitem Faktor.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in setzePasswortHash() `must_change_password = true` entfernt → rot:
 *      „ein vom Verwalter gesetztes Passwort …“ (mustChangePassword false,
 *      /stats 200)
 *   B  in fuegeKontoEin() die Spalte wieder weggelassen → rot: „ein vom
 *      Verwalter angelegtes Konto …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { verwalterMitFaktor } = require('./helpers/verwalter');
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { bis } = require('./helpers/zeit');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

test('vom Verwalter vergebene Passwörter gelten nur bis zum ersten Wechsel', {
  concurrency: 1,
  timeout: 180_000,
}, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const P = process.pid,
    CHEF = `vpe_chef_${P}`,
    ALT = `vpe_alt_${P}`,
    NEU = `vpe_neu_${P}`;
  const CHEF_PW = 'Verwalter-Passwort-17x';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ALT, NEU]]);
  const lege = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [name, bcrypt.hashSync(CHEF_PW, 4), admin],
      )
    ).id;
  const chef = await lege(CHEF, true),
    alt = await lege(ALT, false);
  const codes = await verwalterMitFaktor(_req, chef);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ALT, NEU]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'verwalter-pw-test-geheimnis-lang-genug-123',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLLE: 'web',
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    await bis(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  assert.ok(
    await bis(async () => (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) !== null, 60_000),
    `der Server startet nicht:\n${log.slice(-2000)}`,
  );

  const ruf = (keks, pfad, o = {}) =>
    fetch(basis + pfad, {
      ...o,
      headers: { 'content-type': 'application/json', origin: basis, ...(keks ? { cookie: keks } : {}) },
    });
  const anmelden = async (name, passwort, code) => {
    const r = await ruf(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: name, password: passwort, ohne_token: true, ...(code ? { code } : {}) }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(body)}\n${log.slice(-800)}`);
    return { keks: r.headers.get('set-cookie').split(';')[0], user: body.user };
  };
  const chefKeks = (await anmelden(CHEF, CHEF_PW, codes[0])).keks;

  /** Anmelden, gesperrt bis zum Wechsel, nach dem Wechsel offen. */
  async function nurBisZumWechsel(name, vergeben) {
    const a = await anmelden(name, vergeben);
    assert.equal(a.user.mustChangePassword, true, 'die Anmeldung meldet den Pflichtwechsel');
    const gesperrt = await ruf(a.keks, '/api/v1/stats');
    assert.equal(gesperrt.status, 403);
    assert.equal((await gesperrt.json()).code, 'passwort_wechsel_noetig');
    const w = await ruf(a.keks, '/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current: vergeben, newPassword: `Eigenes-Passwort-${P}-neu` }),
    });
    assert.equal(w.status, 200, await w.clone().text());
    const keks = w.headers.get('set-cookie').split(';')[0];
    assert.equal((await ruf(keks, '/api/v1/stats')).status, 200);
  }

  await t.test('ein vom Verwalter angelegtes Konto', async () => {
    const vergeben = 'Vom-Verwalter-vergeben-1';
    const r = await ruf(chefKeks, '/api/v1/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username: NEU, password: vergeben, admin_password: CHEF_PW, code: codes[1] }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    await nurBisZumWechsel(NEU, vergeben);
  });

  await t.test('ein vom Verwalter gesetztes Passwort', async () => {
    const vergeben = 'Vom-Verwalter-gesetzt-2';
    const r = await ruf(chefKeks, `/api/v1/auth/users/${alt}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: vergeben, admin_password: CHEF_PW, code: codes[2] }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    await nurBisZumWechsel(ALT, vergeben);
  });
});
