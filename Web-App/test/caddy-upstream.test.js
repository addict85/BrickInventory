/**
 * With VORGELAGERTER_PROXY Caddy believes the proxy in front of it about X-Forwarded-For,
 * read from the right; with `keiner` nobody; without input it does not start. The value
 * goes through the startup script from compose.yaml into a real Caddy (CADDY_BIN or
 * `caddy` in the path) in front of an echo server; without Caddy only the startup script.
 *
 * Counter-checks for the mandatory input (measured 13.11.2026, each alone):
 *   E  in the startup script `""` deleted from the error branch → red: “without input
 *      Caddy does not start” (empty)
 *   F  the branch `keiner)` deleted → red: “keiner yields the empty list”
 *   G  `:?` at VORGELAGERTER_PROXY in compose.yaml back to `:-` → red:
 *      “compose requires the input”
 *   H  (14.11.2026) the prefix check deleted → red: “a too wide
 *      network does not start …” (0.0.0.0/0: Caddy starts)
 *   I  (14.11.2026) min=8 instead of 16 → red: the same (192.168.0.0/15 starts)
 *   J  (14.11.2026, round 24) eng=16 instead of 29 → red: “a network over eight addresses only
 *      with …” (172.18.0.0/16 starts without confirmation)
 *   K  (14.11.2026) the line `min=$$eng; [ … ] && min=$$weit` without confirmation branch →
 *      red: the same (with confirmation 172.18.0.0/16 does not start)
 *
 * Counter-checks (measured 13.11.2026 with Caddy v2.11.8, each alone):
 *   A  `trusted_proxies static {$VORGELAGERTER_PROXY}` deleted → red:
 *      “with VORGELAGERTER_PROXY the app sees the client” (127.0.0.1)
 *   B  `trusted_proxies_strict` deleted → red: the same (6.6.6.6, the entry
 *      prepended by the client)
 *   C  in the block `handle` `header_up X-Forwarded-For {client_ip}` deleted →
 *      red: the same (the whole chain including 127.0.0.1)
 *   D  the same line deleted in the block (anmeldung) → red: “… also on the
 *      login paths”
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
/** Caddy's startup script from compose.yaml ($$ → $); instead of `exec caddy` it outputs the value Caddy would get. */
function startScript(wert, bestaetigt = false) {
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
    const script = rumpf
      .join('\n')
      .replace(/\$\$/g, '$')
      .replaceAll('/ca-wurzel', tmp)
      .replace(/exec caddy run .*/, 'printf "%s" "${VORGELAGERTER_PROXY-ungesetzt}"');
    // acme: no root folder, no loop in the background.
    const env = {
      PATH: process.env.PATH,
      BRICK_TLS: 'acme',
      ...(wert === undefined ? {} : { VORGELAGERTER_PROXY: wert }),
      ...(bestaetigt ? { PROXY_NETWORK_CONFIRMED: '1' } : {}),
    };
    return spawnSync('sh', ['-c', script], { env, encoding: 'utf8', timeout: 10_000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('VORGELAGERTER_PROXY is required: keiner or addresses', async t => {
  await t.test('compose requires the value', () => {
    assert.match(COMPOSE, /VORGELAGERTER_PROXY: \$\{VORGELAGERTER_PROXY:\?[^}]*keiner/);
  });
  await t.test('without a value Caddy does not start', () => {
    for (const wert of [undefined, '', 'private_ranges', '10.0.0.1 }', '10.0.0.1\nhttp:// {']) {
      const r = startScript(wert);
      assert.notEqual(r.status, 0, `${JSON.stringify(wert)}: Caddy startet`);
      assert.equal(r.stdout, '', JSON.stringify(wert));
      assert.match(r.stderr, /VORGELAGERTER_PROXY in \.env setzen: keiner/);
    }
  });
  await t.test('a network that is too wide does not start (like TRUST_PROXY: IPv4 from /16, IPv6 from /64)', () => {
    for (const wert of ['0.0.0.0/0', '::/0', '172.28.73.20 10.0.0.0/8', '192.168.0.0/15', 'fd00::/48', '10.0.0.1/']) {
      const r = startScript(wert, true);
      assert.notEqual(r.status, 0, `${wert}: Caddy startet`);
      assert.equal(r.stdout, '', wert);
      assert.match(r.stderr, /ist zu weit/, wert);
    }
  });
  await t.test('a network spanning more than eight addresses only with PROXY_NETWORK_CONFIRMED=1', () => {
    for (const wert of ['172.18.0.0/16', '192.168.1.0/28', 'fd00::/64', 'fd00::/119']) {
      const r = startScript(wert);
      assert.notEqual(r.status, 0, `${wert}: Caddy startet ohne Bestätigung`);
      assert.match(r.stderr, /PROXY_NETWORK_CONFIRMED=1/, wert);
      assert.deepEqual([startScript(wert, true).status, startScript(wert, true).stdout], [0, wert]);
    }
  });
  await t.test('keiner yields the empty list, addresses stay', () => {
    assert.deepEqual([startScript('keiner').status, startScript('keiner').stdout], [0, '']);
    const r = startScript('172.28.73.20 fd00::100/120 172.18.0.8/29 fd00::1');
    assert.deepEqual([r.status, r.stdout], [0, '172.28.73.20 fd00::100/120 172.18.0.8/29 fd00::1'], r.stderr);
  });
});

const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

/** Starts the real Caddyfile in front of `appPort`; returns a request function. */
async function startCaddy(t, appPort, upstream) {
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
    port = await freePort();
    const umleitung = await freePort();
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
        ...(upstream === undefined ? {} : { VORGELAGERTER_PROXY: upstream }),
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

test('Caddy gives the app the client address behind an upstream proxy', {
  skip: !CADDY && 'kein Caddy (CADDY_BIN)',
  timeout: 120_000,
}, async t => {
  // The app returns which X-Forwarded-For arrives at it.
  const app = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(String(req.headers['x-forwarded-for'] ?? '')));
  });
  await new Promise(r => app.listen(0, '127.0.0.1', () => r(undefined)));
  t.after(() => app.close());
  const appPort = /** @type {import('node:net').AddressInfo} */ (app.address()).port;

  await t.test('keiner: the address that reaches Caddy', async t2 => {
    const anfrage = await startCaddy(t2, appPort, startScript('keiner').stdout);
    assert.equal((await anfrage('GET', '/api/v1/sets', '198.51.100.7')).rumpf, '127.0.0.1');
    assert.equal((await anfrage('POST', '/api/v1/auth/login', '198.51.100.7')).rumpf, '127.0.0.1');
  });

  await t.test('with VORGELAGERTER_PROXY: the client, read from the right', async t2 => {
    const anfrage = await startCaddy(t2, appPort, startScript('10.9.9.9 127.0.0.1').stdout);
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

  await t.test('another upstream proxy: again the address that reaches Caddy', async t2 => {
    const anfrage = await startCaddy(t2, appPort, startScript('10.9.9.9').stdout);
    assert.equal((await anfrage('GET', '/api/v1/sets', '198.51.100.7')).rumpf, '127.0.0.1');
  });
});
