/**
 * Jede Route aus dem API-Vertrag, anders geschrieben: ganz in Grossbuchstaben,
 * mit grossem Anfangsbuchstaben nach /api/v1 und mit angehängtem „/“, „//“
 * oder „%2F“. Am echten Server mit Idempotency-Key. Eine andere Schreibung ist
 * eine andere Route (404) und hinterlässt nichts in `idempotency`.
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  server.ts ohne `case sensitive routing` und vertragsRouter() ohne
 *      caseSensitive → rot: „Grossschreibung ist eine andere Route“ (Routen
 *      antworten, Einträge in idempotency) und „… nicht gespeichert“ (ein
 *      GROSS geschriebenes token-rotieren hat den Token schon ersetzt)
 *   B  nur in der Idempotenz-Middleware `if (!route) return next();`
 *      gestrichen → rot: „Grossschreibung …“ (die 404 liegt unter dem Schlüssel)
 *   C  routeFuerAnfrage() ohne das Abschneiden des Schrägstrichs → rot nur
 *      „routeFuerAnfrage ordnet …“
 *   D  (15.11.2026) in startup/app.ts die Absage für `/` am Ende gestrichen → rot:
 *      „ein Schrägstrich am Ende ist eine andere Route“ (u. a. storage/locations/
 *      200, vouchers/1/klartext/ 403 aus der zweiten Linie statt 404)
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
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { VERTRAG, routeFuerAnfrage } = _req('src/vertrag/index.js');
const { antwortIstGeheim } = _req('src/idempotenz/http/middleware.js');
const { warte } = require('./helpers/zeit');
const { portVon } = require('./helpers/server');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portVon(s);
      s.close(() => r(p));
    });
  });

const SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTEN = Object.keys(VERTRAG).map(k => {
  const [m, p] = k.split(' ');
  return { m, p, url: p.replace(/:[A-Za-z_]+\??/g, '1') };
});

test('Vertragsrouten in anderer Schreibung', { concurrency: 1, timeout: 300_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const name = `schreibung_${process.pid}`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [name],
    )
  ).id;
  const token = await _req('src/konto/geraeteToken.js').tokenAnlegen(uid, 'Schreibung');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'schreibung-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      NODE_ENV: 'test',
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++)
    await warte(250);

  let n = 0;
  const rufe = async (m, url, key = `schreibung-${++n}`) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: m,
      redirect: 'manual',
      body: m === 'GET' ? undefined : '{}',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
    });
    const text = await r.text();
    return { status: r.status, replay: r.headers.get('idempotent-replay'), text, key };
  };
  const gespeichert = async key =>
    db.all(
      'SELECT key, status, response IS NOT NULL AS mit_antwort FROM idempotency WHERE user_id = $1 AND key = ANY($2)',
      [uid, key],
    );

  assert.ok(ROUTEN.length > 150, `nur ${ROUTEN.length} Vertragsrouten — greift die Suche noch?`);
  assert.ok((await rufe('GET', '/api/v1/settings')).status === 200, `der Token gilt nicht: ${log.slice(-400)}`);

  await t.test('Grossschreibung ist eine andere Route', async () => {
    const falsch = [],
      key = [];
    for (const { m, url } of ROUTEN) {
      const rest = url.slice('/api/v1/'.length);
      for (const anders of [url.toUpperCase(), rest && `/api/v1/${rest[0].toUpperCase()}${rest.slice(1)}`]) {
        if (!anders || anders === url) continue;
        const r = await rufe(m, anders);
        key.push(r.key);
        if (r.status !== 404 || r.replay) falsch.push(`${m} ${anders} → ${r.status}`);
      }
    }
    assert.deepEqual(falsch, []);
    assert.deepEqual(await gespeichert(key), [], 'eine anders geschriebene Route hat in idempotency geschrieben');
  });

  await t.test('routeFuerAnfrage ordnet einen Schrägstrich am Ende derselben Route zu', () => {
    // Drossel, Schrittschutz und Idempotenz fragen so; die Absage am Eingang ist die erste Linie.
    const anders = ROUTEN.filter(
      ({ m, url }) =>
        routeFuerAnfrage(m, url + '/') !== routeFuerAnfrage(m, url) ||
        antwortIstGeheim(m, url + '/') !== antwortIstGeheim(m, url),
    );
    assert.deepEqual(
      anders.map(r => `${r.m} ${r.p}`),
      [],
    );
  });

  await t.test('ein Schrägstrich am Ende ist eine andere Route', async () => {
    const falsch = [],
      key = [];
    // `/api/v1/` steht so im Vertrag; `//` am Ende ist dort derselbe Pfad.
    for (const { m, url } of ROUTEN.filter(r => !r.url.endsWith('/')))
      for (const anders of [url + '/', url + '//']) {
        const r = await rufe(m, anders);
        key.push(r.key);
        if (r.status !== 404 || r.replay) falsch.push(`${m} ${anders} → ${r.status}`);
      }
    assert.deepEqual(falsch, []);
    assert.deepEqual(await gespeichert(key), []);
  });

  await t.test('… und ein %2F am Ende kommt an keine geheime oder bestätigte Antwort', async () => {
    const geheim = ROUTEN.filter(({ m, url }) => SCHREIBEND.has(m) && antwortIstGeheim(m, url));
    assert.ok(geheim.length > 20, `nur ${geheim.length} geheime oder bestätigte Routen`);
    const gelungen = [];
    for (const { m, url } of geheim) {
      const r = await rufe(m, url + '%2F');
      if (r.status < 400) gelungen.push(`${m} ${url}%2F → ${r.status}`);
    }
    assert.deepEqual(gelungen, []);
  });
});
