/**
 * Befunde der zweiten Sicherheitsprüfung am echten Server (dist/server.js).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   N1  `Cache-Control: no-store` im /api-Vorlauf von server.ts gestrichen →
 *       rot: „API und Anmeldewege …" (/api/v1/vouchers ohne Kopf); die
 *       statische Datei bleibt grün, sie hat ihren eigenen.
 *   H4  in alsUploadFehler() die Zuordnung von entity.parse.failed gestrichen →
 *       rot: „kaputtes JSON …" (Antwort nennt „Expected double-quoted property name … at position 18")
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
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('Nachprüfung am echten Server', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `nach_${process.pid}`, PASS = 'Nach-Pruefung-7x';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'nachpruefung-test-geheimnis-lang-genug-1234',
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
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) === null; i++) await warte(250);

  const anmeldung = await fetch(`${basis}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }) });
  assert.equal(anmeldung.status, 200, `${await anmeldung.clone().text()}\n${log}`);
  const keks = anmeldung.headers.get('set-cookie').split(';')[0];
  const holen = (pfad, o = {}) => fetch(basis + pfad, { redirect: 'manual', ...o, headers: { cookie: keks, origin: basis, ...(o.headers || {}) } });

  await t.test('API und Anmeldewege tragen no-store, statische Dateien nicht', async () => {
    const neu = await holen('/api/v1/vouchers', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: '6006491234567890', pin: '1234', amount: 25, currency: 'CHF' }) });
    assert.equal(neu.status, 200, await neu.clone().text());
    const liste = await holen('/api/v1/vouchers');
    assert.equal(liste.status, 200);
    assert.equal((await liste.json()).vouchers[0].pin, '1234');
    assert.equal(liste.headers.get('cache-control'), 'no-store', '/api/v1/vouchers');
    assert.equal(anmeldung.headers.get('cache-control'), 'no-store', 'POST /api/v1/auth/login');
    for (const pfad of ['/api/v1/stats', '/reset-password?token=x', '/verify?token=x']) {
      const r = await holen(pfad); await r.arrayBuffer();
      assert.equal(r.headers.get('cache-control'), 'no-store', pfad);
    }
    const statisch = await holen('/js/app.bundle.js'); await statisch.arrayBuffer();
    assert.equal(statisch.status, 200);
    assert.doesNotMatch(statisch.headers.get('cache-control'), /no-store/);
  });

  await t.test('kaputtes JSON und zu grosse Anfragen: einheitliche Antwort ohne Parsertext', async () => {
    for (const [pfad, mitKeks] of [['/api/v1/auth/login', false], ['/api/v1/vouchers', true]]) {
      const r = await (mitKeks ? holen : (p, o) => fetch(basis + p, o))(pfad, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: '{"username": "x", ' });
      const text = await r.text();
      assert.equal(r.status, 400, pfad);
      assert.deepEqual(JSON.parse(text), { success: false, code: 'anfrage_json_ungueltig', error: 'Die Anfrage ist kein gültiges JSON' }, pfad);
      assert.doesNotMatch(text, /position|Unexpected|Expected|SyntaxError|body-parser/i, pfad);
    }
    const gross = await fetch(`${basis}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x'.repeat(300 * 1024) }) });
    assert.deepEqual([gross.status, (await gross.json()).code], [413, 'anfrage_zu_gross']);
  });
});
