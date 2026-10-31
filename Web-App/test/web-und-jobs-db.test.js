/**
 * Ein Web- und ein Job-Prozess aus derselben Datei (ROLLE=web, ROLLE=jobs),
 * so wie compose.yaml sie startet — am echten Server.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in server.ts `const jobs = k.rolle !== 'web'` durch `true` ersetzt →
 *      rot: „der Web-Prozess arbeitet keine Aufträge ab“
 *   B  in aktuellerStartZustand (src/infra/startZustand.ts) das Nachlesen aus
 *      laufzustand entfernt → rot: „der Web-Prozess sieht den Startzustand des
 *      Job-Prozesses“
 *   C  in server.ts app.use(nurEigeneHerkunft) entfernt → rot: „weist
 *      schreibende Anfragen fremder Seiten ab“ (200)
 *   D  in server.ts den Aufruf stoppeJobs() aus herunterfahren() entfernt →
 *      rot: „SIGTERM: der Job-Prozess gibt seinen laufenden Auftrag zurück“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const http   = require('node:http');
const net    = require('node:net');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const warte = (ms) => new Promise(r => setTimeout(r, ms));

function freierPort() {
  return new Promise((auf, ab) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address(); s.close(() => auf(port));
    }).on('error', ab);
  });
}

function hole(port, weg, { methode = 'GET', token, kopf = {}, body } = {}) {
  return new Promise((auf, ab) => {
    const daten = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: weg, method: methode, agent: false,
      headers: {
        ...kopf,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(daten ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}),
      },
    }, (res) => {
      let roh = '';
      res.on('data', d => { roh += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(roh); } catch {} auf({ status: res.statusCode, headers: res.headers, body: j }); });
    });
    r.on('error', ab);
    if (daten) r.write(daten);
    r.end();
  });
}

function starte(rolle, port) {
  const p = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'rollen-test-geheimnis-lang-genug-1234',
           PORT: String(port), ROLLE: rolle, NODE_ENV: 'production', AUFTRAG_FRIST_SEK: '600' },
  });
  p.log = '';
  p.stdout.on('data', d => { p.log += d; });
  p.stderr.on('data', d => { p.log += d; });
  return p;
}

async function beende(p) {
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
  for (let i = 0; i < 150 && p.exitCode === null && p.signalCode === null; i++) await warte(100);
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
}

test('Web- und Job-Prozess', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // Ohne heutige Stempel lädt der Job-Prozess den Rebrickable-Katalog herunter.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(`INSERT INTO laufzustand (schluessel, wert) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`, [k]);
  await db.run(`DELETE FROM laufzustand WHERE schluessel = 'startup_status'`);

  const NAME = `rollen_${process.pid}`, PASS = 'Passwort12345', MARKE = `rollen-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(`DELETE FROM auftraege WHERE nutzlast->>'marke' = $1`, [MARKE]);
  await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, 1, 1) RETURNING id`,
    [NAME, await bcrypt.hash(PASS, 4)]);

  const port = await freierPort(), jobsPort = await freierPort();
  const web = starte('web', port);
  let jobs = null;
  const auftrag = (id) => db.get('SELECT status, versuche FROM auftraege WHERE id = $1', [id]);

  try {
    for (let i = 0; i < 240 && !/localhost:\d+/.test(web.log); i++) await warte(250);
    assert.match(web.log, /Rolle web/, web.log.slice(-1500));

    await t.test('der Web-Prozess arbeitet keine Aufträge ab', async () => {
      const id = (await db.get(`INSERT INTO auftraege (art, nutzlast) VALUES ('bilder', $1) RETURNING id`,
        [JSON.stringify({ set_number: `rollen-nichtda-${process.pid}`, marke: MARKE })])).id;
      await db.run(`SELECT pg_notify('auftraege', 'bilder')`);
      await warte(1500);
      assert.equal((await auftrag(id)).status, 'offen', 'Der Web-Prozess hat einen Auftrag belegt');
      t.erster = id;
    });

    await t.test('der Web-Prozess sieht den Startzustand des Job-Prozesses', async () => {
      const vorher = await hole(port, '/api/v1/startup-status');
      assert.equal(vorher.body.ready, false, 'Vorbedingung: ohne Job-Prozess ist der Katalog nicht geprüft');
      jobs = starte('jobs', jobsPort);
      let r;
      for (let i = 0; i < 120; i++) { r = await hole(port, '/api/v1/startup-status'); if (r.body?.ready) break; await warte(250); }
      assert.equal(r.body.ready, true, `${JSON.stringify(r.body)}\n${jobs.log.slice(-1500)}`);
    });

    await t.test('der Job-Prozess erledigt den Auftrag und nimmt keine Anfragen an', async () => {
      let z;
      for (let i = 0; i < 80; i++) { z = await auftrag(t.erster); if (z.status !== 'offen' && z.status !== 'laeuft') break; await warte(250); }
      assert.equal(z.status, 'erledigt', jobs.log.slice(-1500));
      assert.match(jobs.log, /Rolle jobs/);
      await assert.rejects(hole(jobsPort, '/api/v1/health'), /ECONNREFUSED/, 'Der Job-Prozess lauscht auf einem Port');
    });

    await t.test('jede API-Antwort nennt die Schnittstellenfassung', async () => {
      const r = await hole(port, '/api/v1/health');
      const { API_VERSION, API_MIN_APP } = _req('src/infra/apiVersion.js');
      assert.equal(r.headers['x-api-version'], String(API_VERSION));
      assert.equal(r.headers['x-api-min-app'], String(API_MIN_APP));
      assert.equal(r.body.db_pool, undefined, 'Pool-Zahlen ohne Anmeldung');
      assert.equal(r.body.status, 'ok');
    });

    await t.test('eine zu alte App wird mit 426 abgewiesen', async () => {
      const { API_MIN_APP } = _req('src/infra/apiVersion.js');
      assert.equal((await hole(port, '/api/v1/health', { kopf: { 'X-App-Api': String(API_MIN_APP - 1) } })).status, 426);
      assert.equal((await hole(port, '/api/v1/health', { kopf: { 'X-App-Api': String(API_MIN_APP) } })).status, 200);
    });

    await t.test('weist schreibende Anfragen fremder Seiten ab', async () => {
      const r = await hole(port, '/api/v1/auth/logout', { methode: 'POST', kopf: { 'sec-fetch-site': 'cross-site' } });
      assert.equal(r.status, 403, 'src/infra/herkunft.ts hängt nicht in server.ts');
    });

    await t.test('SIGTERM: der Job-Prozess gibt seinen laufenden Auftrag zurück', async () => {
      // Ein Auftrag mit langer Frist, den der Job-Prozess belegt, aber nie zu Ende bringt:
      // Die Art kennt er nicht, also simuliert der Test die Belegung selbst mit seiner Kennung.
      const id = (await db.get(`INSERT INTO auftraege (art, nutzlast) VALUES ('bilder', $1) RETURNING id`,
        [JSON.stringify({ set_number: `rollen-zwei-${process.pid}`, marke: MARKE })])).id;
      jobs.kill('SIGTERM');
      web.kill('SIGTERM');
      for (let i = 0; i < 150 && (jobs.exitCode === null || web.exitCode === null); i++) await warte(100);
      assert.equal(jobs.exitCode, 0, jobs.log.slice(-1500));
      assert.equal(web.exitCode, 0, web.log.slice(-1500));
      for (const p of [jobs, web]) assert.match(p.log, /\[shutdown\] Datenbankverbindungen geschlossen/);
      assert.match(jobs.log, /\[auftraege\] beendet/, 'Der Job-Prozess hat seinen Worker nicht angehalten');
      const z = await auftrag(id);
      assert.notEqual(z.status, 'laeuft', 'Ein Auftrag blieb belegt');
    });
  } finally {
    await beende(web);
    if (jobs) await beende(jobs);
    await db.run(`DELETE FROM auftraege WHERE nutzlast->>'marke' = $1`, [MARKE]).catch(() => {});
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
