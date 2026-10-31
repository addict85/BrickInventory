/**
 * Eine zu grosse Datei bekommt 413, ein falscher Dateityp 415 — jeweils mit
 * Code, damit Web und App „zu gross“ statt „Interner Serverfehler“ sagen.
 * Gemessen am echten Server, weil die Abbildung im globalen Fehlerweg von
 * server.ts greift: multer meldet seine Grenzen ohne Status.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in handleRouteError() alsUploadFehler() nicht aufgerufen → rot:
 *      „zu gross: 413 mit Code“ (500 statt 413, Gutschein und Wanted-Liste)
 *   B  im fileFilter der Gutscheine wieder `new Error('nur_pdf')` → rot:
 *      „falscher Typ: 415 mit Code“ (500 statt 415)
 *   C  im fileFilter der Anleitungen wieder `new Error('Nur PDF, JPG oder
 *      PNG')` → rot: „falscher Typ: 415 mit Code“ (500 statt 415)
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
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('Grenzen beim Hochladen', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const NAME = `upload_${process.pid}`, SN = `UG${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1,'x',1) RETURNING id`, [NAME])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  const token = await _req('src/konto/auth.js').createToken(uid, 'Prüfung', true);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'upload-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++) await warte(250);

  const sende = async (pfad, inhalt, typ, name) => {
    const form = new FormData();
    form.append('file', new Blob([inhalt], { type: typ }), name);
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${pfad}`, {
      method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
    const rumpf = await r.json().catch(() => null);
    return { status: r.status, code: rumpf?.code, json: rumpf !== null };
  };
  const pdf = (bytes) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 0x20)]);

  await t.test('zu gross: 413 mit Code', async () => {
    assert.deepEqual({
      gutschein: await sende('/vouchers/pdf', pdf(3 * 1024 * 1024), 'application/pdf', 'g.pdf'),
      wanted: await sende('/wanted-list/import/xml', Buffer.alloc(5 * 1024 * 1024, 0x20), 'text/xml', 'w.xml'),
    }, {
      gutschein: { status: 413, code: 'datei_zu_gross', json: true },
      wanted: { status: 413, code: 'datei_zu_gross', json: true },
    });
  });

  await t.test('falscher Typ: 415 mit Code', async () => {
    assert.deepEqual({
      gutschein: await sende('/vouchers/pdf', 'kein pdf', 'text/plain', 'g.txt'),
      anleitung: await sende(`/sets/${SN}/instructions/upload`, 'kein pdf', 'text/plain', 'a.txt'),
    }, {
      gutschein: { status: 415, code: 'nur_pdf', json: true },
      anleitung: { status: 415, code: 'datei_typ_falsch', json: true },
    });
  });
});
