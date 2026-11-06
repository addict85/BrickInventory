/**
 * Jede Route aus dem API-Vertrag, anders geschrieben: ganz in Grossbuchstaben,
 * mit grossem Anfangsbuchstaben nach /api/v1 und mit angehängtem „/“. Am
 * echten Server mit Idempotency-Key. Eine andere Schreibung ist eine andere
 * Route (404) und hinterlässt nichts in `idempotenz`; der Schrägstrich am Ende …
 * Ausführlich: docs/begruendungen/test/vertrag-schreibung-db.test.js.md#kopf
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  server.ts ohne `case sensitive routing` und vertragsRouter() ohne
 *      caseSensitive → rot: „Grossschreibung ist eine andere Route“ (Routen
 *      antworten, Einträge in idempotenz) und „… nicht gespeichert“ (ein
 *      GROSS geschriebenes token-rotieren hat den Token schon ersetzt)
 *   B  nur in der Idempotenz-Middleware `if (!route) return next();`
 *      gestrichen → rot: „Grossschreibung …“ (die 404 liegt unter dem Schlüssel)
 *   C  routeFuerAnfrage() ohne das Abschneiden des Schrägstrichs → rot nur
 *      „ein Schrägstrich am Ende …“: Ohne Vertragseintrag speichert die
 *      Middleware nichts, darum bleibt die Tabelle leer
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
const { VERTRAG, routeFuerAnfrage } = _req('src/infra/vertrag/index.js');
const { antwortIstGeheim } = _req('src/idempotenz/http/middleware.js');
const { warte } = require('./helpers/zeit');
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTEN = Object.keys(VERTRAG).map(k => {
  const [m, p] = k.split(' ');
  return { m, p, url: p.replace(/:[A-Za-z_]+\??/g, '1') };
});

test('Vertragsrouten in anderer Schreibung', { concurrency: 1, timeout: 300_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const name = `schreibung_${process.pid}`;
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`, [name])).id;
  const token = await _req('src/konto/auth.js').createToken(uid, 'Schreibung');
  t.after(async () => { await db.run('DELETE FROM users WHERE id = $1', [uid]); await db.pool.end().catch(() => {}); });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'schreibung-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false', NODE_ENV: 'test' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++) await warte(250);

  let n = 0;
  const rufe = async (m, url, schluessel = `schreibung-${++n}`) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: m, redirect: 'manual', body: m === 'GET' ? undefined : '{}',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': schluessel } });
    const text = await r.text();
    return { status: r.status, replay: r.headers.get('idempotent-replay'), text, schluessel };
  };
  const gespeichert = async (schluessel) => db.all(
    'SELECT schluessel, status, antwort IS NOT NULL AS mit_antwort FROM idempotenz WHERE user_id = $1 AND schluessel = ANY($2)',
    [uid, schluessel]);

  assert.ok(ROUTEN.length > 150, `nur ${ROUTEN.length} Vertragsrouten — greift die Suche noch?`);
  assert.ok((await rufe('GET', '/api/v1/settings')).status === 200, `der Token gilt nicht: ${log.slice(-400)}`);

  await t.test('Grossschreibung ist eine andere Route', async () => {
    const falsch = [], schluessel = [];
    for (const { m, url } of ROUTEN) {
      const rest = url.slice('/api/v1/'.length);
      for (const anders of [url.toUpperCase(), rest && `/api/v1/${rest[0].toUpperCase()}${rest.slice(1)}`]) {
        if (!anders || anders === url) continue;
        const r = await rufe(m, anders);
        schluessel.push(r.schluessel);
        if (r.status !== 404 || r.replay) falsch.push(`${m} ${anders} → ${r.status}`);
      }
    }
    assert.deepEqual(falsch, []);
    assert.deepEqual(await gespeichert(schluessel), [], 'eine anders geschriebene Route hat in idempotenz geschrieben');
  });

  await t.test('ein Schrägstrich am Ende findet denselben Vertragseintrag', () => {
    const anders = ROUTEN.filter(({ m, url }) => routeFuerAnfrage(m, url + '/') !== routeFuerAnfrage(m, url)
      || antwortIstGeheim(m, url + '/') !== antwortIstGeheim(m, url));
    assert.deepEqual(anders.map(r => `${r.m} ${r.p}`), []);
  });

  await t.test('… und eine geheime oder bestätigte Antwort wird auch dann nicht gespeichert', async () => {
    // token-rotieren zuletzt: Es ersetzt den Token dieses Tests.
    const geheim = ROUTEN.filter(({ m, url }) => SCHREIBEND.has(m) && antwortIstGeheim(m, url))
      .sort((a, b) => Number(a.p.endsWith('token-rotieren')) - Number(b.p.endsWith('token-rotieren')));
    assert.ok(geheim.length > 20, `nur ${geheim.length} geheime oder bestätigte Routen`);
    const gelungen = [], wiederholt = [], schluessel = [];
    for (const { m, url } of geheim) {
      const erst = await rufe(m, url + '/');
      schluessel.push(erst.schluessel);
      if (erst.status < 300) gelungen.push(url);
      if (url.endsWith('token-rotieren')) continue;
      const zweit = await rufe(m, url + '/', erst.schluessel);
      if (zweit.replay) wiederholt.push(`${m} ${url}/`);
    }
    // Mindestens eine geheime Antwort entsteht wirklich, sonst prüfte die Tabelle nur Fehler.
    assert.ok(gelungen.includes('/api/v1/settings/household/invite'), `household/invite/ gelang nicht: ${gelungen}`);
    assert.deepEqual(wiederholt, []);
    assert.deepEqual((await gespeichert(schluessel)).filter(z => z.mit_antwort).map(z => z.schluessel), []);
  });
});
