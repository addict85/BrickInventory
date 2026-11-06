/**
 * Caddy lässt die Anmeldewege ungebremst zur App, damit deren bcrypt-Schranke
 * die Last sieht (Vorrang, 503); er weist nur Rümpfe über 16 KB ab und reicht
 * einen Rumpf erst ganz gelesen weiter. Das echte Caddyfile läuft in einem
 * echten Caddy (CADDY_BIN oder `caddy` im Pfad) vor einem Node-Server, der
 * mitzählt; ohne Caddy wird übersprungen.
 *
 * Gegenproben (04.11.2026 gemessen mit Caddy aus `go install`, je einzeln):
 *   A  `transport http { max_conns_per_host 4 }` wieder eingesetzt → rot:
 *      „Caddy lässt die Anmeldungen ungebremst zur App“ (4 zugleich); mit
 *      `max_conns_per_host 8` ebenso (8 zugleich)
 *   B  `import anmeldung` gestrichen → rot: „der Block (anmeldung) ist nicht
 *      eingebunden“
 *   C  `request_body { max_size 16KB }` gestrichen → rot: „ein Rumpf über 16 KB …“
 *   D  `request_buffers 32KB` gestrichen → rot: „kein angefangener Rumpf
 *      erreicht die App“ (alle acht)
 *   E  `request_buffers 16KB` (= max_size) → rot: dieselbe; die vier
 *      Rümpfe mit 16 000 Byte strömen ab der Puffergrenze doch zur App
 *   F  `read_header 10s` gestrichen → rot: „Caddy schliesst eine Verbindung,
 *      deren Kopf stockt …“ (Vorgabe von Caddy ist eine Minute)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);
// REQUIRE_CADDY=1 (CI): ein fehlender Caddy ist ein Fehler, kein stilles Überspringen.
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, aber kein Caddy (CADDY_BIN)');

test('Caddy reicht die Anmeldewege ungebremst, aber nur mit ganzem Rumpf weiter', { skip: !CADDY && 'kein Caddy (CADDY_BIN)', timeout: 60_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-bremse-'));
  let jetzt = 0, hoechst = 0, halten = 300;
  const laengen = [];
  const app = http.createServer((req, res) => {
    jetzt++; hoechst = Math.max(hoechst, jetzt); laengen.push(req.headers['content-length']);
    req.resume();
    req.on('end', () => setTimeout(() => { jetzt--; res.end('ok'); }, halten));
  });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  let caddy = null;
  const offen = [];
  t.after(() => { offen.forEach(s => s.destroy()); caddy?.kill('SIGKILL'); app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const port = 30000 + (process.pid % 15000);
  const datei = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`).replace('http:// {', `http://:${port + 1} {`)
    .replaceAll('app:3000', `127.0.0.1:${app.address().port}`);
  assert.ok(datei.includes('import anmeldung'), 'der Block (anmeldung) ist nicht eingebunden');
  fs.writeFileSync(path.join(tmp, 'Caddyfile'), datei);
  caddy = spawn(CADDY, ['run', '--config', path.join(tmp, 'Caddyfile'), '--adapter', 'caddyfile'], {
    stdio: 'ignore', env: { PATH: process.env.PATH, XDG_DATA_HOME: path.join(tmp, 'd'), XDG_CONFIG_HOME: path.join(tmp, 'c'),
      BRICK_HOST: 'nas.example.lan', BRICK_BASE_URL: 'https://nas.example.lan',
      BRICK_TLS_AUSSTELLER: 'internal', BRICK_TLS_OPTIONEN: 'sign_with_root' } });

  const agent = new https.Agent({ keepAlive: false, maxSockets: Infinity });
  const anfrage = (methode, pfad, rumpf = '{}') => new Promise((fertig) => {
    const r = https.request({ host: '127.0.0.1', port, servername: 'nas.example.lan', rejectUnauthorized: false, agent,
      method: methode, path: pfad, headers: { host: 'nas.example.lan', 'content-type': 'application/json' } }, (res) => {
      res.resume(); res.on('end', () => fertig(res.statusCode));
    });
    r.on('error', () => fertig(null));
    if (methode === 'POST') r.end(rumpf); else r.end();
  });
  let bereit = null;
  for (let i = 0; i < 100 && bereit !== 200; i++) {
    bereit = await anfrage('GET', '/api/v1/health');
    if (bereit !== 200) await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(bereit, 200, 'Caddy antwortet nicht');

  // Lange gehalten, damit auch ein langsamer Lauf alle 16 zugleich offen hat.
  jetzt = 0; hoechst = 0; halten = 1500;
  const anmeldungen = await Promise.all(Array.from({ length: 16 }, () => anfrage('POST', '/api/v1/auth/login')));
  halten = 300;
  assert.deepEqual(anmeldungen, Array(16).fill(200), 'Anmeldungen gehen verloren');
  assert.ok(hoechst > 8, `Caddy lässt die Anmeldungen ungebremst zur App (${hoechst} zugleich)`);

  assert.equal(await anfrage('POST', '/api/v1/auth/login', JSON.stringify({ username: 'x'.repeat(20_000) })), 413,
    'ein Rumpf über 16 KB erreicht die Anmeldung');

  // Kopf sofort, vom Rumpf nur ein Teil, dann Stille: vier knapp angefangene
  // und vier, die genau bis zur Grenze von max_size gehen.
  const langsam = (laenge, vorab) => new Promise((bereit) => {
    const s = tls.connect({ host: '127.0.0.1', port, servername: 'nas.example.lan', rejectUnauthorized: false }, () => {
      s.write(`POST /api/v1/auth/login HTTP/1.1\r\nHost: nas.example.lan\r\nContent-Type: application/json\r\n`
        + `Content-Length: ${laenge}\r\n\r\n${'x'.repeat(vorab)}`, bereit);
    });
    s.on('error', () => {});
    offen.push(s);
  });
  await Promise.all([...Array(4)].map(() => langsam(200, 1)).concat([...Array(4)].map(() => langsam(17_000, 16_000))));
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await anfrage('POST', '/api/v1/auth/login'), 200, 'Vorbedingung: Caddy nimmt Anmeldungen an');
  const langsame = laengen.filter(l => l === '200' || l === '17000');
  assert.deepEqual(langsame, [], 'kein angefangener Rumpf erreicht die App');

  const kopfBeginn = Date.now();
  const kopfZu = await new Promise((fertig) => {
    const s = tls.connect({ host: '127.0.0.1', port, servername: 'nas.example.lan', rejectUnauthorized: false },
      () => s.write('POST /api/v1/auth/login HTTP/1.1\r\nHost: nas.example.lan\r\n'));
    s.on('error', () => {});
    s.once('close', () => fertig(Date.now() - kopfBeginn));
    offen.push(s);
    setTimeout(() => fertig(null), 15_000);
  });
  assert.ok(kopfZu !== null && kopfZu < 13_000, `Caddy schliesst eine Verbindung, deren Kopf stockt (nach ${kopfZu} ms)`);
});
