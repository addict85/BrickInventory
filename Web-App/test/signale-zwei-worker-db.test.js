/**
 * Cache-Signale erreichen JEDEN Worker — am echten Server mit zwei Workern.
 *
 * Jeder Worker hält eigene Caches für Token (60 s) und Haushalt (5 min). Ein
 * NOTIFY leert sie; das hilft nur, wenn jeder Worker auf den Kanälen lauscht.
 * Geprüft wird von aussen: Jede Anfrage auf eigener Verbindung, damit der
 * Cluster sie reihum verteilt.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  beide listen()-Aufrufe in server.ts hinter `if (!isPrimaryWorker) return;`
 *      → rot: nach dem Widerruf „200,401,200,401,…" und Haushalt halb veraltet
 *   B  ohne `agent: false` (Keep-Alive) → alles beim selben Worker; das fängt
 *      der erste Teiltest („Anfragen erreichen beide Worker") ab
 *   C  (27.10.) die Zeile app.use(nurEigeneHerkunft) in server.ts entfernt →
 *      rot: „weist schreibende Anfragen fremder Seiten ab" (200)
 *   D  (27.10.) /health liefert db_pool wieder immer → rot: „verrät ohne
 *      Verwalter nur den Startzustand"
 *   F  (27.10.) die /api-Middleware für X-Api-Version in server.ts entfernt →
 *      rot: „jede API-Antwort nennt die Schnittstellenfassung"
 *   E  (27.10.) in haltePrimaerSperre das setTimeout(sperreNeuHolen) entfernt →
 *      rot: „die Primär-Sperre kommt nach einem Verbindungsabbruch zurück"
 *   G  (27.10.) app.use('/api', …) ohne appFassungPruefen → rot: „eine zu alte
 *      App wird mit 426 abgewiesen"
 *   H  (28.10.) im Hauptprozess die Weitergabe von SIGTERM entfernt → rot:
 *      „SIGTERM an den Hauptprozess beendet jeden Worker geordnet"
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
const RUNDE = 12;

function freierPort() {
  return new Promise((auf, ab) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address(); s.close(() => auf(port));
    }).on('error', ab);
  });
}

/** Eine Anfrage auf eigener Verbindung; liefert Status und Antwort. */
function hole(port, weg, { methode = 'GET', token, body } = {}) {
  return new Promise((auf, ab) => {
    const daten = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: weg, method: methode, agent: false,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(daten ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}),
      },
    }, (res) => {
      let roh = '';
      res.on('data', d => { roh += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(roh); } catch {} auf({ status: res.statusCode, body: j }); });
    });
    r.on('error', ab);
    if (daten) r.write(daten);
    r.end();
  });
}

test('Cache-Signale erreichen jeden Worker', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // Ohne heutige Stempel lädt der Start den Rebrickable-Katalog herunter.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(`INSERT INTO global_settings (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k]);

  const HAUPT = `sig_haupt_${process.pid}`, UNTER = `sig_unter_${process.pid}`, PASS = 'Passwort12345';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, UNTER]]);
  const ids = {};
  for (const n of [HAUPT, UNTER])
    ids[n] = (await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, 1, 1) RETURNING id`,
      [n, await bcrypt.hash(PASS, 4)])).id;

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'signal-test-geheimnis-lang-genug-1234',
           PORT: String(port), WEB_WORKERS: '2', NODE_ENV: 'production' },
  });
  let log = '';
  const worker = new Set();
  const lies = (d) => {
    log += d;
    for (const m of String(d).matchAll(/Worker (\d+) is (?:PRIMARY|secondary)/g)) worker.add(m[1]);
  };
  srv.stdout.on('data', lies);
  srv.stderr.on('data', lies);

  try {
    for (let i = 0; i < 240 && worker.size < 2; i++) await warte(250);
    assert.equal(worker.size, 2, `nicht zwei Worker gestartet:\n${log.slice(-2000)}`);

    const anmeldung = await hole(port, '/api/v1/auth/login', { methode: 'POST', body: { username: HAUPT, password: PASS } });
    assert.equal(anmeldung.status, 200, JSON.stringify(anmeldung.body));
    const token = anmeldung.body.token;

    /** RUNDE Anfragen; jede Antwort samt der PID des Workers, der sie bediente. */
    const runde = async (weg) => {
      const aus = [];
      for (let i = 0; i < RUNDE; i++) aus.push(await hole(port, weg, { token }));
      return aus;
    };

    await t.test('Gegenprobe: die Anfragen erreichen beide Worker', async () => {
      // Ein Token, den genau EIN Worker gemerkt hat, still aus der Tabelle
      // gelöscht: Nur dieser Worker nimmt ihn noch an. Antworten beide gleich,
      // landet alles beim selben Worker, und die Teiltests unten prüften nichts.
      const zweite = await hole(port, '/api/v1/auth/login', { methode: 'POST', body: { username: HAUPT, password: PASS } });
      const zeuge = zweite.body.token;
      assert.equal((await hole(port, '/api/v1/settings/raw', { token: zeuge })).status, 200);
      await db.run('DELETE FROM api_tokens WHERE token = $1', [_req('utils/auth.js').hashToken(zeuge)]);
      const s = [];
      for (let i = 0; i < RUNDE; i++) s.push((await hole(port, '/api/v1/settings/raw', { token: zeuge })).status);
      assert.ok(s.includes(200) && s.includes(401), `alle Anfragen beim selben Worker: ${s.join(',')}`);
    });

    await t.test('Haushalt: eine neue Verknüpfung gilt sofort überall', async () => {
      const vorher = await runde('/api/v1/settings/household');
      assert.deepEqual(vorher.map(r => r.body?.is_main), Array(RUNDE).fill(false), 'Vorbedingung: noch kein Hauptkonto');

      // Der Schreibweg eines Workers, nachgestellt: Zeile plus Signal.
      await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[HAUPT], ids[UNTER]]);
      await db.run(`SELECT pg_notify('haushalt_geaendert', '')`);
      await warte(300);

      const nachher = await runde('/api/v1/settings/household');
      assert.deepEqual(nachher.map(r => r.body?.is_main), Array(RUNDE).fill(true),
        'Ein Worker bedient den alten Haushalt weiter — er lauscht nicht auf dem Kanal');
    });

    await t.test('Token: nach dem Widerruf weist jeder Worker ab', async () => {
      const vorher = await runde('/api/v1/settings/raw');
      assert.deepEqual(vorher.map(r => r.status), Array(RUNDE).fill(200), 'Vorbedingung: der Token gilt');

      // Der Widerruf auf einem dritten Prozess: Zeile weg, dann das Signal.
      // Über /logout bliebe es Zufall — der bedienende Worker leert seinen
      // eigenen Cache auch ohne Signal.
      await db.run('DELETE FROM api_tokens WHERE token = $1', [_req('utils/auth.js').hashToken(token)]);
      await db.run(`SELECT pg_notify('tokens_geaendert', '')`);
      await warte(300);

      const nachher = await runde('/api/v1/settings/raw');
      assert.deepEqual(nachher.map(r => r.status), Array(RUNDE).fill(401),
        'Ein Worker bedient den widerrufenen Token weiter — er lauscht nicht auf dem Kanal');
    });

    await t.test('die Primär-Sperre kommt nach einem Verbindungsabbruch zurück', async () => {
      // pg_locks gilt für den ganzen Cluster: Ohne die Datenbank fände die
      // Abfrage auch die Sperre eines anderen Servers auf derselben Instanz.
      const halter = () => db.get(`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 0
                                     AND objid = 99999999 AND granted
                                     AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
      const vorher = await halter();
      assert.ok(vorher, 'Vorbedingung: ein Worker hält die Primär-Sperre');
      await db.run('SELECT pg_terminate_backend($1)', [vorher.pid]);
      let nachher;
      // Auf beides warten: Die Warnung kommt über die Pipe des Kindprozesses.
      for (let i = 0; i < 40; i++) {
        await warte(250);
        nachher = await halter();
        if (nachher && nachher.pid !== vorher.pid && /Primär-Sperre verloren/.test(log)) break;
      }
      assert.ok(nachher && nachher.pid !== vorher.pid,
        'Nach dem Abbruch hält niemand mehr die Sperre — die Jobs liefen ohne Primär weiter');
      assert.match(log, /Primär-Sperre verloren/);
    });

    await t.test('jede API-Antwort nennt die Schnittstellenfassung', async () => {
      const r = await new Promise((auf, ab) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/v1/health', agent: false },
          res => { res.resume(); auf(res.headers); });
        q.on('error', ab); q.end();
      });
      const { API_VERSION, API_MIN_APP } = _req('utils/apiVersion.js');
      assert.equal(r['x-api-version'], String(API_VERSION), 'Ohne die Kopfzeile kann die App nicht sagen, wer zu alt ist');
      assert.equal(r['x-api-min-app'], String(API_MIN_APP));
    });

    await t.test('eine zu alte App wird mit 426 abgewiesen', async () => {
      const { API_MIN_APP } = _req('utils/apiVersion.js');
      const status = (fassung) => new Promise((auf, ab) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/v1/health', agent: false,
          headers: { 'X-App-Api': String(fassung) } }, res => { res.resume(); auf(res.statusCode); });
        q.on('error', ab); q.end();
      });
      assert.equal(await status(API_MIN_APP - 1), 426, 'Der Server liest X-App-Api nicht');
      assert.equal(await status(API_MIN_APP), 200);
    });

    await t.test('/health verrät ohne Verwalter nur den Startzustand', async () => {
      const offen = await hole(port, '/api/v1/health');
      assert.equal(offen.status, 200);
      assert.ok(offen.body.status && offen.body.startup, 'Der Ladebildschirm braucht den Startzustand');
      assert.equal(offen.body.db_pool, undefined, 'Pool-Zahlen ohne Anmeldung');
      const frisch = (await hole(port, '/api/v1/auth/login', { methode: 'POST', body: { username: HAUPT, password: PASS } })).body.token;
      assert.equal((await hole(port, '/api/v1/settings/raw', { token: frisch })).status, 200, 'Vorbedingung: ein gültiger Token');
      assert.equal((await hole(port, '/api/v1/health', { token: frisch })).body.db_pool, undefined, 'Pool-Zahlen für jedes Konto');
      await db.run('UPDATE users SET is_admin = 1 WHERE id = $1', [ids[HAUPT]]);
      await db.run(`SELECT pg_notify('tokens_geaendert', '')`);
      await warte(300);
      assert.ok((await hole(port, '/api/v1/health', { token: frisch })).body.db_pool, 'Der Verwalter sieht den Pool');
    });

    await t.test('server.ts weist schreibende Anfragen fremder Seiten ab', async () => {
      const r = await new Promise((auf, ab) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/v1/auth/logout', method: 'POST',
          agent: false, headers: { 'sec-fetch-site': 'cross-site' } }, res => { res.resume(); auf(res.statusCode); });
        q.on('error', ab); q.end();
      });
      assert.equal(r, 403, 'utils/herkunft.ts hängt nicht in server.ts');
    });

    await t.test('SIGTERM an den Hauptprozess beendet jeden Worker geordnet', async () => {
      srv.kill('SIGTERM');
      for (let i = 0; i < 150 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
      assert.equal(srv.exitCode, 0, `Hauptprozess endete mit ${srv.exitCode}/${srv.signalCode}:\n${log.slice(-1500)}`);
      assert.equal((log.match(/\[shutdown\] SIGTERM empfangen/g) || []).length, 2,
        `nicht beide Worker haben geordnet beendet:\n${log.slice(-1500)}`);
      assert.equal((log.match(/\[shutdown\] Datenbankverbindungen geschlossen/g) || []).length, 2);
    });

  } finally {
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, UNTER]]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
