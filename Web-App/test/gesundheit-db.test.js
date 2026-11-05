/**
 * Gesundheitsprüfung am echten Server: anonym geht nur der Status hinaus,
 * `live` antwortet ohne Datenbank, `ready` fragt sie und meldet 503, wenn sie
 * fehlt. Der Startzustand geht anonym nur mit seinen bekannten Feldern hinaus.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in /api/v1/health `startup` wieder für alle → rot: „anonym nur der Status"
 *   B  /api/v1/health/ready ohne datenbankAntwortet() (immer 200) → rot: „ohne Datenbank
 *      meldet ready 503"
 *   C  startup-status ohne oeffentlicherStartZustand() → rot: „der
 *      Startzustand nennt nur seine Felder" (pfad und fehler gingen hinaus)
 *   D  progress im Vertrag wieder z.number().int() → rot: dieselbe Prüfung
 *      (vertrag_verletzt; der Server meldet Schritte mit Anteil, z. B. 2.37)
 *   E  (03.11.2026) startup-status wieder mit Schritt für alle (angemeldet
 *      immer true) → rot: „anonym nur der Fortschritt"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, deren Benutzer Eigentümer ist.
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
const db = _req('db/database.js');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('Gesundheitsprüfung und Startzustand', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `gesund_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, 'x', true, true, true) RETURNING id`, [NAME])).id;
  const token = await _req('src/konto/auth.js').createToken(uid, 'Gesundheit', false, null, { scope: 'voll' });
  const { setzeZustand, loescheZustand } = _req('src/auftraege/laufzustand.js');
  await setzeZustand('startup_status', JSON.stringify({ ready: false, step: 'Teile laden...', progress: 2.37, total: 8,
    sub: '40%', pfad: '/app/data/geheim.csv', fehler: 'Error: ECONNREFUSED at /app/dist/jobs/x.js:12' }));
  t.after(async () => {
    await loescheZustand('startup_status');
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'gesundheit-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false', ROLLE: 'web' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const hole = (pfad, kopf = {}) => fetch(`http://127.0.0.1:${port}${pfad}`, { headers: kopf })
    .then(async r => ({ status: r.status, body: await r.json() }));
  for (let i = 0; i < 240 && (await hole('/api/v1/health/live').catch(() => null)) === null; i++) await warte(250);

  await t.test('anonym nur der Status, der Verwalter sieht mehr', async () => {
    const anonym = await hole('/api/v1/health');
    assert.deepEqual(anonym, { status: 200, body: { status: 'starting' } }, log.slice(-1500));
    const verwalter = await hole('/api/v1/health', { authorization: `Bearer ${token}` });
    assert.deepEqual(Object.keys(verwalter.body).sort(), ['db_pool', 'startup', 'status', 'uptime_seconds']);
  });

  await t.test('der Startzustand nennt nur seine Felder', async () => {
    const r = await hole('/api/v1/startup-status', { authorization: `Bearer ${token}` });
    assert.deepEqual(r.body, { ready: false, step: 'Teile laden...', progress: 2.37, total: 8, sub: '40%' });
  });

  await t.test('anonym nur der Fortschritt, nicht der Schritt', async () => {
    const r = await hole('/api/v1/startup-status');
    assert.deepEqual(r.body, { ready: false, step: null, progress: 2.37, total: 8, sub: null }, 'anonym nur der Fortschritt');
  });

  await t.test('live und ready antworten mit der Datenbank', async () => {
    assert.deepEqual(await hole('/api/v1/health/live'), { status: 200, body: { status: 'ok' } });
    assert.deepEqual(await hole('/api/v1/health/ready'), { status: 200, body: { status: 'ok' } });
  });

  await t.test('ohne Datenbank meldet ready 503, live weiter 200', async () => {
    const name = new URL(URL_DB).pathname.slice(1);
    const wartung = new URL(URL_DB); wartung.pathname = '/postgres';
    const admin = new Client({ connectionString: wartung.toString() });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
      assert.deepEqual(await hole('/api/v1/health/ready'), { status: 503, body: { success: false, code: 'datenbank_nicht_erreichbar',
        status: 'unavailable', error: 'Datenbank nicht erreichbar' } });
      assert.deepEqual(await hole('/api/v1/health/live'), { status: 200, body: { status: 'ok' } });
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await admin.end();
    }
    let r;
    for (let i = 0; i < 40; i++) { r = await hole('/api/v1/health/ready'); if (r.status === 200) break; await warte(250); }
    assert.equal(r.status, 200, 'ready erholt sich nicht');
  });
});
