/**
 * Mit VORGELAGERTER_PROXY glaubt Caddy dem Proxy davor X-Forwarded-For, von
 * rechts gelesen; mit `keiner` niemandem; ohne Angabe startet er nicht. Der Wert
 * geht durch das Startskript aus compose.yaml in ein echtes Caddy (CADDY_BIN oder
 * `caddy` im Pfad) vor einem Echo-Server; ohne Caddy nur das Startskript.
 *
 * Gegenproben zur Pflichtangabe (13.11.2026 gemessen, je einzeln):
 *   E  im Startskript `""` aus dem Fehlerzweig gestrichen → rot: „ohne Angabe
 *      startet Caddy nicht“ (leer)
 *   F  den Zweig `keiner)` gestrichen → rot: „keiner ergibt die leere Liste“
 *   G  `:?` bei VORGELAGERTER_PROXY in compose.yaml wieder `:-` → rot:
 *      „compose verlangt die Angabe“
 *   H  (14.11.2026) die Prüfung der Präfixe gestrichen → rot: „ein zu weites
 *      Netz startet nicht …“ (0.0.0.0/0: Caddy startet)
 *   I  (14.11.2026) min=8 statt 16 → rot: dieselbe (192.168.0.0/15 startet)
 *
 * Gegenproben (13.11.2026 gemessen mit Caddy v2.11.8, je einzeln):
 *   A  `trusted_proxies static {$VORGELAGERTER_PROXY}` gestrichen → rot:
 *      „mit VORGELAGERTER_PROXY sieht die App den Client“ (127.0.0.1)
 *   B  `trusted_proxies_strict` gestrichen → rot: dieselbe (6.6.6.6, der vom
 *      Client vorangestellte Eintrag)
 *   C  im Block `handle` `header_up X-Forwarded-For {client_ip}` gestrichen →
 *      rot: dieselbe (die ganze Kette samt 127.0.0.1)
 *   D  im Block (anmeldung) dieselbe Zeile gestrichen → rot: „… auch auf den
 *      Anmeldewegen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, aber kein Caddy (CADDY_BIN)');

const COMPOSE = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
/** Das Startskript von Caddy aus compose.yaml ($$ → $); statt `exec caddy` gibt es den Wert aus, den Caddy bekäme. */
function startskript(wert) {
  const z = COMPOSE.split('\n');
  const start = z.findIndex(l => /^ {2}caddy:\s*$/.test(l));
  const i = z.findIndex((l, j) => j > start && /^\s+- \|\s*$/.test(l));
  const rumpf = [];
  for (const l of z.slice(i + 1)) {
    if (!/^ {8}/.test(l)) break;
    rumpf.push(l.slice(8));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-start-'));
  try {
    const skript = rumpf
      .join('\n')
      .replace(/\$\$/g, '$')
      .replaceAll('/ca-wurzel', tmp)
      .replace(/exec caddy run .*/, 'printf "%s" "${VORGELAGERTER_PROXY-ungesetzt}"');
    // acme: kein Wurzelordner, keine Schleife im Hintergrund.
    const env = {
      PATH: process.env.PATH,
      BRICK_TLS: 'acme',
      ...(wert === undefined ? {} : { VORGELAGERTER_PROXY: wert }),
    };
    return spawnSync('sh', ['-c', skript], { env, encoding: 'utf8', timeout: 10_000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('VORGELAGERTER_PROXY ist Pflicht: keiner oder Adressen', async t => {
  await t.test('compose verlangt die Angabe', () => {
    assert.match(COMPOSE, /VORGELAGERTER_PROXY: \$\{VORGELAGERTER_PROXY:\?[^}]*keiner/);
  });
  await t.test('ohne Angabe startet Caddy nicht', () => {
    for (const wert of [undefined, '', 'private_ranges', '10.0.0.1 }', '10.0.0.1\nhttp:// {']) {
      const r = startskript(wert);
      assert.notEqual(r.status, 0, `${JSON.stringify(wert)}: Caddy startet`);
      assert.equal(r.stdout, '', JSON.stringify(wert));
      assert.match(r.stderr, /VORGELAGERTER_PROXY in \.env setzen: keiner/);
    }
  });
  await t.test('ein zu weites Netz startet nicht (wie TRUST_PROXY: IPv4 ab /16, IPv6 ab /64)', () => {
    for (const wert of ['0.0.0.0/0', '::/0', '172.28.73.20 10.0.0.0/8', '192.168.0.0/15', 'fd00::/48', '10.0.0.1/']) {
      const r = startskript(wert);
      assert.notEqual(r.status, 0, `${wert}: Caddy startet`);
      assert.equal(r.stdout, '', wert);
      assert.match(r.stderr, /ist zu weit/, wert);
    }
  });
  await t.test('keiner ergibt die leere Liste, Adressen bleiben', () => {
    assert.deepEqual([startskript('keiner').status, startskript('keiner').stdout], [0, '']);
    const r = startskript('172.28.73.20 fd00::/64 172.18.0.0/16 fd00::1');
    assert.deepEqual([r.status, r.stdout], [0, '172.28.73.20 fd00::/64 172.18.0.0/16 fd00::1'], r.stderr);
  });
});

const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

/** Startet das echte Caddyfile vor `appPort`; liefert eine Anfragefunktion. */
async function starteCaddy(t, appPort, vorgelagert) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-vorgelagert-'));
  let caddy = null;
  t.after(() => {
    caddy?.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  let port = 0;
  const agent = new https.Agent({ keepAlive: false });
  const anfrage = (methode, pfad, xff) =>
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
          headers: { host: 'nas.example.lan', ...(xff ? { 'x-forwarded-for': xff } : {}) },
        },
        res => {
          let rumpf = '';
          res.on('data', d => {
            rumpf += d;
          });
          res.on('end', () => fertig({ status: res.statusCode, rumpf }));
        },
      );
      r.on('error', () => fertig({ status: null, rumpf: '' }));
      r.end(methode === 'POST' ? '{}' : undefined);
    });
  let fehler = '';
  let bereit = null;
  for (let versuch = 1; bereit !== 200; versuch++) {
    port = await freierPort();
    const umleitung = await freierPort();
    const datei = fs
      .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
      .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`)
      .replace('http:// {', `http://:${umleitung} {`)
      .replaceAll('app:3000', `127.0.0.1:${appPort}`);
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
        ...(vorgelagert === undefined ? {} : { VORGELAGERTER_PROXY: vorgelagert }),
      },
    });
    caddy.stderr.on('data', d => {
      fehler = (fehler + d).slice(-4000);
    });
    const bis = Date.now() + 30_000;
    while (bereit !== 200 && caddy.exitCode === null && Date.now() < bis) {
      bereit = (await anfrage('GET', '/api/v1/health')).status;
      if (bereit !== 200) await new Promise(r => setTimeout(r, 200));
    }
    if (bereit === 200 || versuch >= 3 || !fehler.includes('address already in use')) break;
    caddy.kill('SIGKILL');
  }
  assert.equal(bereit, 200, `Caddy antwortet nicht (Exit ${caddy?.exitCode}): ${fehler.slice(-600)}`);
  return anfrage;
}

test('Caddy gibt der App die Client-Adresse hinter einem vorgelagerten Proxy', {
  skip: !CADDY && 'kein Caddy (CADDY_BIN)',
  timeout: 120_000,
}, async t => {
  // Die App gibt zurück, welches X-Forwarded-For bei ihr ankommt.
  const app = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(String(req.headers['x-forwarded-for'] ?? '')));
  });
  await new Promise(r => app.listen(0, '127.0.0.1', () => r(undefined)));
  t.after(() => app.close());
  const appPort = /** @type {import('node:net').AddressInfo} */ (app.address()).port;

  await t.test('keiner: die Adresse, die Caddy erreicht', async t2 => {
    const anfrage = await starteCaddy(t2, appPort, startskript('keiner').stdout);
    assert.equal((await anfrage('GET', '/api/v1/sets', '198.51.100.7')).rumpf, '127.0.0.1');
    assert.equal((await anfrage('POST', '/api/v1/auth/login', '198.51.100.7')).rumpf, '127.0.0.1');
  });

  await t.test('mit VORGELAGERTER_PROXY: der Client, von rechts gelesen', async t2 => {
    const anfrage = await starteCaddy(t2, appPort, startskript('10.9.9.9 127.0.0.1').stdout);
    assert.equal(
      (await anfrage('GET', '/api/v1/sets', '6.6.6.6, 198.51.100.7')).rumpf,
      '198.51.100.7',
      'mit VORGELAGERTER_PROXY sieht die App den Client',
    );
    assert.equal(
      (await anfrage('POST', '/api/v1/auth/login', '6.6.6.6, 198.51.100.7')).rumpf,
      '198.51.100.7',
      'mit VORGELAGERTER_PROXY sieht die App den Client auch auf den Anmeldewegen',
    );
  });

  await t.test('ein anderer vorgelagerter Proxy: wieder die Adresse, die Caddy erreicht', async t2 => {
    const anfrage = await starteCaddy(t2, appPort, startskript('10.9.9.9').stdout);
    assert.equal((await anfrage('GET', '/api/v1/sets', '198.51.100.7')).rumpf, '127.0.0.1');
  });
});
