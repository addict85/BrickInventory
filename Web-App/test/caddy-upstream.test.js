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
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, but no Caddy (CADDY_BIN)');

const COMPOSE = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
/** Caddy's startup script from compose.yaml ($$ → $); instead of `exec caddy` it outputs the value Caddy would get. */
function startScript(value, confirmed = false) {
  const z = COMPOSE.split('\n');
  const start = z.findIndex(l => /^ {2}caddy:\s*$/.test(l));
  const i = z.findIndex((l, j) => j > start && /^\s+- \|\s*$/.test(l));
  const body = [];
  for (const l of z.slice(i + 1)) {
    if (!/^ {8}/.test(l)) break;
    body.push(l.slice(8));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-start-'));
  try {
    const script = body
      .join('\n')
      .replace(/\$\$/g, '$')
      .replaceAll('/ca-wurzel', tmp)
      .replace(/exec caddy run .*/, 'printf "%s" "${VORGELAGERTER_PROXY-ungesetzt}"');
    // acme: no root folder, no loop in the background.
    const env = {
      PATH: process.env.PATH,
      BRICK_TLS: 'acme',
      ...(value === undefined ? {} : { VORGELAGERTER_PROXY: value }),
      ...(confirmed ? { PROXY_NETWORK_CONFIRMED: '1' } : {}),
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
    for (const value of [undefined, '', 'private_ranges', '10.0.0.1 }', '10.0.0.1\nhttp:// {']) {
      const r = startScript(value);
      assert.notEqual(r.status, 0, `${JSON.stringify(value)}: Caddy startet`);
      assert.equal(r.stdout, '', JSON.stringify(value));
      assert.match(r.stderr, /VORGELAGERTER_PROXY in \.env setzen: keiner/);
    }
  });
  await t.test('a network that is too wide does not start (like TRUST_PROXY: IPv4 from /16, IPv6 from /64)', () => {
    for (const value of ['0.0.0.0/0', '::/0', '172.28.73.20 10.0.0.0/8', '192.168.0.0/15', 'fd00::/48', '10.0.0.1/']) {
      const r = startScript(value, true);
      assert.notEqual(r.status, 0, `${value}: Caddy startet`);
      assert.equal(r.stdout, '', value);
      assert.match(r.stderr, /ist zu weit/, value);
    }
  });
  await t.test('a network spanning more than eight addresses only with PROXY_NETWORK_CONFIRMED=1', () => {
    for (const value of ['172.18.0.0/16', '192.168.1.0/28', 'fd00::/64', 'fd00::/119']) {
      const r = startScript(value);
      assert.notEqual(r.status, 0, `${value}: Caddy starts without confirmation`);
      assert.match(r.stderr, /PROXY_NETWORK_CONFIRMED=1/, value);
      assert.deepEqual([startScript(value, true).status, startScript(value, true).stdout], [0, value]);
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
  const request = (method, path, xff) =>
    new Promise(done => {
      const r = https.request(
        {
          host: '127.0.0.1',
          port,
          servername: 'nas.example.lan',
          rejectUnauthorized: false,
          agent,
          method: method,
          path: path,
          headers: { host: 'nas.example.lan', ...(xff ? { 'x-forwarded-for': xff } : {}) },
        },
        res => {
          let body = '';
          res.on('data', d => {
            body += d;
          });
          res.on('end', () => done({ status: res.statusCode, body }));
        },
      );
      r.on('error', () => done({ status: null, body: '' }));
      r.end(method === 'POST' ? '{}' : undefined);
    });
  let error = '';
  let ready = null;
  for (let attempt = 1; ready !== 200; attempt++) {
    port = await freePort();
    const redirect = await freePort();
    const file = fs
      .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
      .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`)
      .replace('http:// {', `http://:${redirect} {`)
      .replaceAll('app:3000', `127.0.0.1:${appPort}`);
    fs.writeFileSync(path.join(tmp, 'Caddyfile'), file);
    error = '';
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
      error = (error + d).slice(-4000);
    });
    const until = Date.now() + 30_000;
    while (ready !== 200 && caddy.exitCode === null && Date.now() < until) {
      ready = (await request('GET', '/api/v2/health')).status;
      if (ready !== 200) await new Promise(r => setTimeout(r, 200));
    }
    if (ready === 200 || attempt >= 3 || !error.includes('address already in use')) break;
    caddy.kill('SIGKILL');
  }
  assert.equal(ready, 200, `Caddy does not answer (exit ${caddy?.exitCode}): ${error.slice(-600)}`);
  return request;
}

test('Caddy gives the app the client address behind an upstream proxy', {
  skip: !CADDY && 'no Caddy (CADDY_BIN)',
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
    const request = await startCaddy(t2, appPort, startScript('keiner').stdout);
    assert.equal((await request('GET', '/api/v2/sets', '198.51.100.7')).body, '127.0.0.1');
    assert.equal((await request('POST', '/api/v2/auth/login', '198.51.100.7')).body, '127.0.0.1');
  });

  await t.test('with VORGELAGERTER_PROXY: the client, read from the right', async t2 => {
    const request = await startCaddy(t2, appPort, startScript('10.9.9.9 127.0.0.1').stdout);
    assert.equal(
      (await request('GET', '/api/v2/sets', '6.6.6.6, 198.51.100.7')).body,
      '198.51.100.7',
      'with VORGELAGERTER_PROXY the app sees the client',
    );
    assert.equal(
      (await request('POST', '/api/v2/auth/login', '6.6.6.6, 198.51.100.7')).body,
      '198.51.100.7',
      'with VORGELAGERTER_PROXY the app sees the client on the sign-in paths too',
    );
  });

  await t.test('another upstream proxy: again the address that reaches Caddy', async t2 => {
    const request = await startCaddy(t2, appPort, startScript('10.9.9.9').stdout);
    assert.equal((await request('GET', '/api/v2/sets', '198.51.100.7')).body, '127.0.0.1');
  });
});
