/**
 * Caddy bremst die Anmeldewege: höchstens vier gleichzeitige Anfragen gehen an
 * die App, der Rest wartet bei Caddy; Rümpfe über 16 KB weist er ab. Andere
 * Routen bleiben unbegrenzt. Das echte Caddyfile läuft in einem echten Caddy
 * (CADDY_BIN oder `caddy` im Pfad) vor einem Node-Server, der mitzählt; ohne
 * Caddy wird übersprungen (das Standard-Image hat kein Modul für Raten, siehe
 * Caddyfile).
 *
 * Gegenproben (03.11.2026 gemessen mit Caddy aus `go install`, je einzeln):
 *   A  `max_conns_per_host 4` gestrichen → rot: „höchstens vier Anmeldungen
 *      zugleich bei der App“ (12 gleichzeitig)
 *   B  `import anmeldung` gestrichen → rot: dieselbe Prüfung
 *   C  `request_body { max_size 16KB }` gestrichen → rot: „ein Rumpf über 16 KB …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);

test('die Anmeldewege sind an Caddy gebremst', { skip: !CADDY && 'kein Caddy (CADDY_BIN)', timeout: 60_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-bremse-'));
  let jetzt = 0, hoechst = 0;
  const app = http.createServer((req, res) => {
    jetzt++; hoechst = Math.max(hoechst, jetzt);
    req.resume();
    req.on('end', () => setTimeout(() => { jetzt--; res.end('ok'); }, 300));
  });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  let caddy = null;
  t.after(() => { caddy?.kill('SIGKILL'); app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const port = 30000 + (process.pid % 15000);
  const datei = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`).replace('http:// {', `http://:${port + 1} {`)
    .replaceAll('app:3000', `127.0.0.1:${app.address().port}`);
  assert.ok(datei.includes('import anmeldung'), 'die Bremse ist nicht eingebunden');
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

  jetzt = 0; hoechst = 0;
  const anmeldungen = await Promise.all(Array.from({ length: 12 }, () => anfrage('POST', '/api/v1/auth/login')));
  assert.deepEqual(anmeldungen, Array(12).fill(200), 'wartende Anmeldungen gehen verloren');
  assert.ok(hoechst <= 4, `höchstens vier Anmeldungen zugleich bei der App (waren ${hoechst})`);
  assert.ok(hoechst >= 2, `Vorbedingung: Anfragen liefen überhaupt parallel (${hoechst})`);

  jetzt = 0; hoechst = 0;
  const andere = await Promise.all(Array.from({ length: 12 }, () => anfrage('GET', '/api/v1/sets')));
  assert.deepEqual(andere, Array(12).fill(200));
  assert.ok(hoechst > 4, `andere Routen sind nicht gebremst (${hoechst} zugleich)`);

  assert.equal(await anfrage('POST', '/api/v1/auth/login', JSON.stringify({ username: 'x'.repeat(20_000) })), 413,
    'ein Rumpf über 16 KB erreicht die Anmeldung');
});
