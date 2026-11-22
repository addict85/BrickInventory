/**
 * Caddy lets the login paths through to the app unthrottled so that its bcrypt barrier
 * sees the load (priority, 503); it only rejects bodies over 16 KB and passes
 * a body on only when fully read. The real Caddyfile runs in a
 * real Caddy (CADDY_BIN or `caddy` in the path) in front of a Node server that
 * counts along; without Caddy it is skipped.
 *
 * Counter-checks (measured 04.11.2026 with Caddy from `go install`, each alone):
 *   A  `transport http { max_conns_per_host 4 }` reinserted → red:
 *      “Caddy lets the logins through to the app unthrottled” (4 at once); with
 *      `max_conns_per_host 8` likewise (8 at once)
 *   B  `import anmeldung` deleted → red: “the block (anmeldung) is not
 *      included”
 *   C  `request_body { max_size 16KB }` deleted → red: “a body over 16 KB …”
 *   D  `request_buffers 32KB` deleted → red: “no started body
 *      reaches the app” (all eight)
 *   E  `request_buffers 16KB` (= max_size) → red: the same; the four
 *      bodies with 16 000 bytes do stream to the app from the buffer limit on
 *   F  `read_header 10s` deleted → red: “Caddy closes a connection
 *      whose header stalls …” (Caddy's default is one minute)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const https = require('node:https');
const tls = require('node:tls');
const { spawn, spawnSync } = require('node:child_process');
const { portOf } = require('./helpers/server');

const ROOT = path.join(__dirname, '..');
const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);
// REQUIRE_CADDY=1 (CI): a missing Caddy is an error, not a silent skip.
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, aber kein Caddy (CADDY_BIN)');

test('Caddy passes the login paths on unthrottled, but only with a complete body', {
  skip: !CADDY && 'kein Caddy (CADDY_BIN)',
  timeout: 120_000,
}, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-bremse-'));
  let jetzt = 0,
    hoechst = 0,
    halten = 300;
  const lengths = [];
  const app = http.createServer((req, res) => {
    jetzt++;
    hoechst = Math.max(hoechst, jetzt);
    lengths.push(req.headers['content-length']);
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        jetzt--;
        res.end('ok');
      }, halten),
    );
  });
  await new Promise(r => app.listen(0, '127.0.0.1', () => r(null)));
  let caddy = null;
  const offen = [];
  t.after(() => {
    for (const s of offen) s.destroy();
    caddy?.kill('SIGKILL');
    app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  // Ports from the system instead of from the pid: those lay in the range that listen(0) of the
  // parallel test files also draws from. An occupied port stays possible; then a new attempt.
  const freePort = () =>
    new Promise(r => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
        s.close(() => r(p));
      });
    });
  let port = 0;
  let fehler = '';
  const agent = new https.Agent({ keepAlive: false, maxSockets: Infinity });
  const anfrage = (methode, pfad, rumpf = '{}') =>
    new Promise(fertig => {
      const r = https.request(
        {
          host: '127.0.0.1',
          port,
          servername: 'nas.example.lan',
          rejectUnauthorized: false,
          agent,
          method: methode,
          path: pfad,
          headers: { host: 'nas.example.lan', 'content-type': 'application/json' },
        },
        res => {
          res.resume();
          res.on('end', () => fertig(res.statusCode));
        },
      );
      r.on('error', () => fertig(null));
      if (methode === 'POST') r.end(rumpf);
      else r.end();
    });
  let bereit = null;
  for (let versuch = 1; bereit !== 200; versuch++) {
    port = await freePort();
    const umleitung = await freePort();
    const datei = fs
      .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
      .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`)
      .replace('http:// {', `http://:${umleitung} {`)
      .replaceAll('app:3000', `127.0.0.1:${portOf(app)}`);
    assert.ok(datei.includes('import anmeldung'), 'der Block (anmeldung) ist nicht eingebunden');
    fs.writeFileSync(path.join(tmp, 'Caddyfile'), datei);
    fehler = '';
    caddy = spawn(CADDY, ['run', '--config', path.join(tmp, 'Caddyfile'), '--adapter', 'caddyfile'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: process.env.PATH,
        XDG_DATA_HOME: path.join(tmp, 'd'),
        XDG_CONFIG_HOME: path.join(tmp, 'c'),
        BRICK_HOST: 'nas.example.lan',
        BRICK_BASE_URL: 'https://nas.example.lan',
        BRICK_TLS_AUSSTELLER: 'internal',
        BRICK_TLS_OPTIONEN: 'sign_with_root',
      },
    });
    caddy.stderr.on('data', d => {
      fehler = (fehler + d).slice(-4000);
    });
    // Under load Caddy with own CA starts slowly; if it ends before, its stderr is in the message.
    const bis = Date.now() + 30_000;
    while (bereit !== 200 && caddy.exitCode === null && Date.now() < bis) {
      bereit = await anfrage('GET', '/api/v1/health');
      if (bereit !== 200) await new Promise(r => setTimeout(r, 200));
    }
    if (bereit === 200 || versuch >= 3 || !fehler.includes('address already in use')) break;
    caddy.kill('SIGKILL');
  }
  assert.equal(bereit, 200, `Caddy antwortet nicht (Exit ${caddy.exitCode}): ${fehler.slice(-600)}`);

  // Held long so that even a slow run has all 16 open at once.
  jetzt = 0;
  hoechst = 0;
  halten = 1500;
  const logins = await Promise.all(Array.from({ length: 16 }, () => anfrage('POST', '/api/v1/auth/login')));
  halten = 300;
  assert.deepEqual(logins, Array(16).fill(200), 'Anmeldungen gehen verloren');
  assert.ok(hoechst > 8, `Caddy lässt die Anmeldungen ungebremst zur App (${hoechst} zugleich)`);

  assert.equal(
    await anfrage('POST', '/api/v1/auth/login', JSON.stringify({ username: 'x'.repeat(20_000) })),
    413,
    'ein Rumpf über 16 KB erreicht die Anmeldung',
  );

  // Header immediately, only part of the body, then silence: four barely started
  // and four that go exactly up to the limit of max_size.
  const langsam = (laenge, upfront) =>
    new Promise(bereit => {
      const s = tls.connect(
        { host: '127.0.0.1', port, servername: 'nas.example.lan', rejectUnauthorized: false },
        () => {
          s.write(
            `POST /api/v1/auth/login HTTP/1.1\r\nHost: nas.example.lan\r\nContent-Type: application/json\r\n` +
              `Content-Length: ${laenge}\r\n\r\n${'x'.repeat(upfront)}`,
            bereit,
          );
        },
      );
      s.on('error', () => {});
      offen.push(s);
    });
  await Promise.all([...Array(4)].map(() => langsam(200, 1)).concat([...Array(4)].map(() => langsam(17_000, 16_000))));
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await anfrage('POST', '/api/v1/auth/login'), 200, 'Vorbedingung: Caddy nimmt Anmeldungen an');
  const slow = lengths.filter(l => l === '200' || l === '17000');
  assert.deepEqual(slow, [], 'kein angefangener Rumpf erreicht die App');

  const headerStart = Date.now();
  const headerTo = await new Promise(fertig => {
    const s = tls.connect({ host: '127.0.0.1', port, servername: 'nas.example.lan', rejectUnauthorized: false }, () =>
      s.write('POST /api/v1/auth/login HTTP/1.1\r\nHost: nas.example.lan\r\n'),
    );
    s.on('error', () => {});
    s.once('close', () => fertig(Date.now() - headerStart));
    offen.push(s);
    setTimeout(() => fertig(null), 15_000);
  });
  assert.ok(
    headerTo !== null && headerTo < 13_000,
    `Caddy schliesst eine Verbindung, deren Kopf stockt (nach ${headerTo} ms)`,
  );
});
