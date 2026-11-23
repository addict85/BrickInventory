/**
 * A proxy in the Docker network that TRUST_PROXY does not believe is reported — once.
 * Without the setting all clients count as the same address, and five
 * failed attempts of a stranger lock out the owner.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  isDockerGateway() always returns false → red: “proxy via the gateway …”
 *   B  `warned = true` removed after the warning → red: “… only once”
 * Counter-check (measured on 29.10.2026):
 *   C  hint again only without TRUST_PROXY (the check against the setting
 *      removed) → red: “proxy in the Docker network without matching TRUST_PROXY …”
 *      (with TRUST_PROXY=docker the hint stayed away)
 * Counter-check (measured on 30.10.2026):
 *   D  the gateway hint again names `TRUST_PROXY=${ip}` → red: „rät, den
 *      Clients hinter dem Gateway zu glauben“
 * A proxy in front of the trusted proxy (measured 13.11.2026, each on its own):
 *   E  in onlyClientAddress() the abort on a second address
 *      deleted → red: „zwei Client-Adressen: kein Hinweis“
 *   F  the time condition (`uhr() - seit < ONE_ADDRESS.ms`) deleted → red:
 *      „nach zehn Minuten noch kein Hinweis“
 *   G  the call of eineAddress() deleted in proxyHint() → red:
 *      „eine einzige Client-Adresse über eine Stunde wird gemeldet“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { isDockerGateway } = _req('src/infra/proxyTrust.js');
const { proxyHint, ONE_ADDRESS } = _req('src/http/proxyHint.js');

const request = (from, xff) => ({ socket: { remoteAddress: from }, headers: xff ? { 'x-forwarded-for': xff } : {} });
function run(trust, requests) {
  const messages = [];
  const mw = proxyHint(trust, t => messages.push(t));
  let next = 0;
  for (const a of requests)
    mw(a, {}, () => {
      next++;
    });
  assert.equal(next, requests.length, 'every request goes on');
  return messages;
}

test('proxy via the gateway is reported, only once — without advice to trust the gateway', () => {
  for (const trust of [undefined, '172.28.73.10']) {
    const m = run(trust, [request('::ffff:172.18.0.1', '198.51.100.4'), request('172.18.0.1', '198.51.100.5')]);
    assert.equal(m.length, 1, `TRUST_PROXY=${trust}`);
    assert.match(m[0], /Docker-Gateway 172\.18\.0\.1/);
    assert.doesNotMatch(m[0], /TRUST_PROXY=172\.18\.0\.1/, 'advises trusting the clients behind the gateway');
  }
});

test('proxy in the Docker network without matching TRUST_PROXY: hint at exactly its address', () => {
  const m = run(undefined, [request('172.28.73.10', '198.51.100.4')]);
  assert.equal(m.length, 1);
  assert.match(m[0], /TRUST_PROXY=172\.28\.73\.10/);
  assert.doesNotMatch(m[0], /TRUST_PROXY=docker/);
});

test('no hint without a proxy header, from other addresses or with matching TRUST_PROXY', () => {
  assert.deepEqual(run(undefined, [request('172.18.0.1')]), []);
  assert.deepEqual(run(undefined, [request('127.0.0.1', '198.51.100.4'), request('192.168.1.20', '1.2.3.4')]), []);
  assert.deepEqual(run('172.28.73.10', [request('172.28.73.10', '198.51.100.4')]), []);
  assert.deepEqual(run('false', [request('172.18.0.1', '198.51.100.4')]), [], 'explicitly without a proxy');
});

test('gateway detection', () => {
  for (const a of ['172.17.0.1', '::ffff:172.31.0.1', 'fd00:dead:beef::1']) assert.equal(isDockerGateway(a), true, a);
  for (const a of ['172.17.0.2', '10.0.0.1', '192.168.0.1', '127.0.0.1', '::1'])
    assert.equal(isDockerGateway(a), false, a);
});

/** Requests via the trusted proxy; `ip` is what Express reads from X-Forwarded-For. */
function viaProxy(trust, ips, { minutes }) {
  const messages = [];
  let now = 0;
  const mw = proxyHint(
    trust,
    t => messages.push(t),
    () => now,
  );
  ips.forEach((ip, i) => {
    now = Math.round((i / Math.max(ips.length - 1, 1)) * minutes * 60_000);
    mw({ ip, socket: { remoteAddress: '172.28.73.10' }, headers: { 'x-forwarded-for': ip } }, {}, () => {});
  });
  return messages;
}
const many = (ip, n = ONE_ADDRESS.requests + 10) => Array(n).fill(ip);

test('a single client address over an hour is reported — once, with VORGELAGERTER_PROXY', () => {
  const m = viaProxy('172.28.73.10', many('::ffff:172.28.73.20', 2 * ONE_ADDRESS.requests), { minutes: 61 });
  assert.equal(m.length, 1, 'a single client address over an hour is reported');
  assert.match(m[0], /Client-Adresse 172\.28\.73\.20\b/);
  assert.match(m[0], /VORGELAGERTER_PROXY/);
});

test('two client addresses, too short or without TRUST_PROXY: no hint', () => {
  const mixed = many('192.168.1.20');
  mixed[10] = '192.168.1.21';
  assert.deepEqual(viaProxy('172.28.73.10', mixed, { minutes: 120 }), [], 'two client addresses: no hint');
  assert.deepEqual(
    viaProxy('172.28.73.10', many('192.168.1.20'), { minutes: 10 }),
    [],
    'after ten minutes still no hint',
  );
  assert.deepEqual(
    viaProxy('172.28.73.10', many('192.168.1.20', ONE_ADDRESS.requests - 1), { minutes: 120 }),
    [],
    'too few requests',
  );
  // Without TRUST_PROXY only the hint about the untrusted proxy reports (above).
  assert.deepEqual(
    viaProxy(undefined, many('192.168.1.20'), { minutes: 120 }).filter(t => /VORGELAGERTER_PROXY/.test(t)),
    [],
    'without TRUST_PROXY',
  );
  // Without an evaluated X-Forwarded-For req.ip is the proxy itself.
  assert.deepEqual(viaProxy('172.28.73.10', many('172.28.73.10'), { minutes: 120 }), [], 'without evaluation');
});
