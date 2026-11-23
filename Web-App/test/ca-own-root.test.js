/**
 * The own root CA (scripts/setup-ca.sh) applies only to BRICK_HOST,
 * its key does not stay lying around, and Caddy signs with the intermediate
 * only if ./caddy/ca is set up; without it Caddy only starts with
 * BRICK_TLS=acme or explicitly with CA_OHNE_NAMENSBESCHRAENKUNG=ja. …
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  nameConstraints deleted from [wurzel] in setup-ca.sh → red:
 *      “even a stolen root key issues nothing foreign”
 *   B  `excluded;IP:…` deleted at the name → red: “a leaf for a
 *      foreign address fails at the root” (the leaf for 1.2.3.4 is valid)
 *   C  the root's key copied to $ORDNER → red: “a root for
 *      a name …” (root.key lies next to the four files for Caddy)
 *   D  in the startup script the query for /ca-eigen/zwischen.key deleted (always
 *      Caddy's CA) → red: “with own CA …”
 *   E  the root omitted in zwischen-kette.crt → red: “no key of the
 *      root …” (chain) and “Caddy ships the root along” (locally with
 *      Caddy 2.11.0 from `go install`; without Caddy only the first)
 *   F  (03.11.2026, no silent fallback) in the startup script the branch `else …
 *      exit 1` replaced by the fallback to Caddy's CA → red: “without own CA
 *      and without switch Caddy does not start”
 *   G  in the Caddyfile `issuer {$BRICK_TLS_AUSSTELLER}` replaced by
 *      `issuer {$BRICK_TLS_AUSSTELLER:internal}` → red: “without
 *      issuer the Caddyfile is invalid” (only with Caddy)
 *   I  in setup-ca.sh the line “SHA-256 des Zertifikats …” deleted →
 *      red: “a root for a name …”
 *   J  with acme `rm -f /ca-wurzel/root.crt` deleted → red: “public
 *      name with acme …” (the old root stays for /ca.crt)
 *   H  the fingerprint line in the startup script deleted → red: “… names the
 *      root's fingerprint”
 *   K  (14.11.2026, locally with Caddy 2.11.8) `reuse_private_keys` deleted in the Caddyfile
 *      → red: “Caddy keeps the key when renewing”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

/** A port nobody currently occupies; derived from the process number it hit occupied ones in the parallel CI run. */
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'setup-ca.sh');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
const ossl = (...args) => spawnSync('openssl', args, { encoding: 'utf8' });

function setUpAccount(dir, host, more = {}) {
  return spawnSync('sh', [SCRIPT, host], {
    encoding: 'utf8',
    cwd: path.dirname(dir),
    env: { PATH: process.env.PATH, CA_ORDNER: dir, ...more },
  });
}

/** A leaf that the intermediate (or `place`) issues for `san`; then the check against the root. */
function leafValid(dir, san, place = { crt: `${dir}/zwischen.crt`, key: `${dir}/zwischen.key` }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blatt-'));
  try {
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${d}/b.key`);
    ossl('req', '-new', '-key', `${d}/b.key`, '-subj', '/CN=blatt', '-out', `${d}/b.csr`);
    fs.writeFileSync(`${d}/san.cnf`, `subjectAltName=${san}\n`);
    const x = ossl(
      'x509',
      '-req',
      '-in',
      `${d}/b.csr`,
      '-CA',
      place.crt,
      '-CAkey',
      place.key,
      '-CAcreateserial',
      '-CAserial',
      `${d}/serial`,
      '-days',
      '1',
      '-extfile',
      `${d}/san.cnf`,
      '-out',
      `${d}/b.crt`,
    );
    assert.equal(x.status, 0, x.stderr);
    const v = ossl('verify', '-CAfile', `${dir}/root.crt`, '-untrusted', place.crt, `${d}/b.crt`);
    return v.status === 0;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

const public_key = pem => crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');

/** The script behind Caddy's `command: [sh, -c, |]`, as Compose passes it ($$ → $). */
function caddyScript() {
  const z = compose.split('\n');
  const start = z.findIndex(l => /^ {2}caddy:\s*$/.test(l));
  const i = z.findIndex((l, j) => j > start && /^\s+- \|\s*$/.test(l));
  const body = [];
  for (const l of z.slice(i + 1)) {
    if (!/^ {8}/.test(l)) break;
    body.push(l.slice(8));
  }
  return body.join('\n').replace(/\$\$/g, '$');
}

test('openssl is there', () => assert.equal(ossl('version').status, 0, 'without openssl the CA cannot be checked'));

test('a root for a name: only this name, no IP addresses', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'ca');
  const r = setUpAccount(dir, 'nas.example.lan');
  assert.equal(r.status, 0, r.stderr);
  // The same value the device shows on installation and Caddy in the log.
  const fp = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'root.crt'))).fingerprint256;
  assert.match(r.stdout, new RegExp(`SHA-256 des Zertifikats zum Abgleich auf jedem Gerät: ${fp}$`, 'm'));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['root.crt', 'zwischen-kette.crt', 'zwischen.crt', 'zwischen.key']);
  assert.equal(
    fs.statSync(path.join(dir, 'zwischen.key')).mode & 0o077,
    0,
    'the key of the intermediate is readable by others',
  );

  await t.test('a leaf for a foreign address fails at the root', () => {
    assert.equal(leafValid(dir, 'DNS:nas.example.lan'), true, 'the own name');
    assert.equal(leafValid(dir, 'DNS:www.bank.example'), false, 'a foreign name');
    assert.equal(leafValid(dir, 'IP:1.2.3.4'), false, 'an IP address');
  });

  await t.test('no key of the root in the folder for Caddy', () => {
    const root = public_key(fs.readFileSync(path.join(dir, 'root.crt')));
    for (const f of fs.readdirSync(dir)) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/PRIVATE KEY/.test(content)) continue;
      assert.equal(f, 'zwischen.key');
      assert.notEqual(public_key(crypto.createPrivateKey(content)), root, `${f} is the key of the root`);
    }
    const chain = fs
      .readFileSync(path.join(dir, 'zwischen-kette.crt'), 'utf8')
      .match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g);
    assert.deepEqual(
      chain.map(public_key),
      [public_key(fs.readFileSync(path.join(dir, 'zwischen.crt'))), root],
      'the chain is intermediate, then root',
    );
  });

  await t.test('an existing CA stays without NEU=1, the root key only on request', () => {
    const prior = fs.readFileSync(path.join(dir, 'root.crt'), 'utf8');
    const again = setUpAccount(dir, 'nas.example.lan');
    assert.notEqual(again.status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'root.crt'), 'utf8'), prior);
    const store = path.join(tmp, 'wurzel.key');
    const fresh = setUpAccount(dir, 'nas.example.lan', { NEU: '1', WURZEL_SCHLUESSEL: store });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.equal(
      public_key(crypto.createPrivateKey(fs.readFileSync(store))),
      public_key(fs.readFileSync(path.join(dir, 'root.crt'))),
    );
  });

  await t.test('even a stolen root key issues nothing foreign', () => {
    // An own intermediate without constraint, signed with the root's key.
    const store = path.join(tmp, 'wurzel.key'),
      evil = { crt: path.join(tmp, 'boese.crt'), key: path.join(tmp, 'boese.key') };
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', evil.key);
    ossl('req', '-new', '-key', evil.key, '-subj', '/CN=boese', '-out', `${evil.crt}.csr`);
    fs.writeFileSync(`${evil.crt}.cnf`, 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n');
    const x = ossl(
      'x509',
      '-req',
      '-in',
      `${evil.crt}.csr`,
      '-CA',
      path.join(dir, 'root.crt'),
      '-CAkey',
      store,
      '-CAcreateserial',
      '-CAserial',
      `${evil.crt}.srl`,
      '-days',
      '1',
      '-extfile',
      `${evil.crt}.cnf`,
      '-out',
      evil.crt,
    );
    assert.equal(x.status, 0, x.stderr);
    assert.equal(leafValid(dir, 'DNS:nas.example.lan', evil), true, 'Precondition: the chain itself is valid');
    assert.equal(leafValid(dir, 'DNS:www.bank.example', evil), false, 'the root allows a foreign name');
    assert.equal(leafValid(dir, 'IP:1.2.3.4', evil), false, 'the root allows an IP address');
  });
});

test('a root for an IP address: only this address', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-ip-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'ca');
  const r = setUpAccount(dir, '192.168.7.20');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(leafValid(dir, 'IP:192.168.7.20'), true);
  assert.equal(leafValid(dir, 'IP:192.168.7.21'), false);
  assert.equal(leafValid(dir, 'DNS:www.bank.example'), false);
});

test("the start script chooses own CA, acme or explicitly Caddy's CA — otherwise Caddy does not start", async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-start-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const caddysRoot = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'ca-root-1.crt'), 'utf8');
  const run = async (withCa, env = {}) => {
    const location = fs.mkdtempSync(path.join(tmp, 'lauf-'));
    const data = path.join(location, 'data/caddy/pki/authorities/local'),
      own = path.join(location, 'ca-eigen'),
      vol = path.join(location, 'vol');
    for (const d of [data, own, vol]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(data, 'root.crt'), caddysRoot);
    if (withCa) {
      fs.writeFileSync(path.join(own, 'root.crt'), 'eigene wurzel\n');
      fs.writeFileSync(path.join(own, 'zwischen.key'), 'k\n');
    }
    // As after switching to acme: the root from before is still in the volume.
    if (env.BRICK_TLS === 'acme') fs.writeFileSync(path.join(vol, 'root.crt'), 'alte wurzel\n');
    const script = caddyScript()
      .replaceAll('/data/', `${location}/data/`)
      .replaceAll('/ca-wurzel', vol)
      .replaceAll('/ca-eigen/zwischen.key ]', `${own}/zwischen.key ]`)
      .replaceAll('q=/ca-eigen/', `q=${own}/`)
      .replace(/exec caddy run .*/, `env > ${location}/umgebung; exec sleep 60`);
    const out = fs.openSync(path.join(location, 'aus'), 'w'),
      fail = fs.openSync(path.join(location, 'fehl'), 'w');
    const p = spawn('sh', ['-c', script], {
      detached: true,
      stdio: ['ignore', out, fail],
      env: {
        PATH: process.env.PATH,
        BRICK_TLS: 'intern',
        CA_OHNE_NAMENSBESCHRAENKUNG: 'nein',
        VORGELAGERTER_PROXY: 'keiner',
        ...env,
      },
    });
    let ended = null;
    p.on('exit', c => {
      ended = c;
    });
    const done = () =>
      ended !== null ||
      (fs.existsSync(`${location}/umgebung`) &&
        (!withCa && env.BRICK_TLS === 'acme' ? true : fs.existsSync(`${vol}/root.crt`)) &&
        /Fingerabdruck|^$/.test(fs.readFileSync(path.join(location, 'aus'), 'utf8') || ''));
    for (let i = 0; i < 80 && !done(); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    try {
      process.kill(-p.pid, 'SIGKILL');
    } catch {
      /* already ended */
    }
    fs.closeSync(out);
    fs.closeSync(fail);
    const environment = fs.existsSync(`${location}/umgebung`) ? fs.readFileSync(`${location}/umgebung`, 'utf8') : null;
    const value = n => environment?.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1];
    return {
      ended,
      environment,
      stdout: fs.readFileSync(path.join(location, 'aus'), 'utf8'),
      stderr: fs.readFileSync(path.join(location, 'fehl'), 'utf8'),
      root: fs.existsSync(`${vol}/root.crt`) ? fs.readFileSync(`${vol}/root.crt`, 'utf8') : null,
      issuer: value('BRICK_TLS_AUSSTELLER'),
      options: value('BRICK_TLS_OPTIONEN'),
      own: environment?.includes('BRICK_CA_EIGEN=')
        ? environment.slice(environment.indexOf('BRICK_CA_EIGEN=')).split('\n').slice(0, 7).join('\n')
        : null,
    };
  };
  await t.test('without own CA and without switch Caddy does not start', async () => {
    const r = await run(false);
    assert.notEqual(r.ended, null, 'the script keeps running');
    assert.notEqual(r.ended, 0);
    assert.equal(r.environment, null, 'Caddy was started');
    assert.equal(r.root, null, 'the app gets Caddy’s unrestricted root');
    assert.match(r.stderr, /scripts\/setup-ca\.sh/);
    assert.match(r.stderr, /BRICK_TLS=acme/);
    assert.match(r.stderr, /CA_OHNE_NAMENSBESCHRAENKUNG=ja/);
  });
  await t.test("Caddy's CA only with CA_OHNE_NAMENSBESCHRAENKUNG=ja, with a warning", async () => {
    const r = await run(false, { CA_OHNE_NAMENSBESCHRAENKUNG: 'ja' });
    assert.equal(r.ended, null, r.stderr);
    assert.deepEqual([r.root, r.issuer, r.options, r.own], [caddysRoot, 'internal', 'sign_with_root', null]);
    assert.match(r.stderr, /WARNUNG: Caddys eigene CA ohne Namensbeschränkung/);
  });
  await t.test('the log names the fingerprint of the root', async () => {
    const r = await run(false, { CA_OHNE_NAMENSBESCHRAENKUNG: 'ja' });
    const fp = new crypto.X509Certificate(caddysRoot).fingerprint256;
    assert.match(
      r.stdout,
      new RegExp(`SHA-256-Fingerabdruck zum Abgleich auf dem Gerät: ${fp}$`, 'm'),
      r.stdout + r.stderr,
    );
  });
  await t.test('with own CA: an intermediate signs, the app gets the own root', async () => {
    const r = await run(true);
    assert.deepEqual(
      [r.root, r.issuer, r.options, r.own],
      [
        'eigene wurzel\n',
        'internal',
        'ca local',
        'BRICK_CA_EIGEN=root {\ncert /ca-eigen/root.crt\n}\nintermediate {\ncert /ca-eigen/zwischen-kette.crt\nkey /ca-eigen/zwischen.key\n}',
      ],
    );
    assert.doesNotMatch(r.stderr, /WARNUNG/);
  });
  await t.test('public name with acme: no own CA needed, no root for the app', async () => {
    const r = await run(false, { BRICK_TLS: 'acme', ACME_EMAIL: 'betrieb@example.org' });
    assert.equal(r.ended, null, r.stderr);
    assert.deepEqual([r.root, r.issuer, r.options], [null, 'acme', 'email betrieb@example.org']);
    const withoutMail = await run(false, { BRICK_TLS: 'acme' });
    assert.deepEqual([withoutMail.issuer, withoutMail.options], ['acme', '']);
    const evil = await run(false, { BRICK_TLS: 'acme', ACME_EMAIL: 'a@b.ch }\n}\nhttp:// {' });
    assert.notEqual(evil.ended, null);
    assert.equal(evil.environment, null, 'an address with Caddyfile characters got through');
  });
});

const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);
// REQUIRE_CADDY=1 (CI): a missing Caddy is an error, not a silent skip.
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, but no Caddy (CADDY_BIN)');

test('Caddy delivers the root along', { skip: !CADDY && 'no Caddy (CADDY_BIN)' }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-echt-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'ca');
  assert.equal(setUpAccount(dir, 'nas.example.lan').status, 0);
  const port = await freePort(),
    port80 = await freePort();
  const file = fs
    .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`)
    .replace('http:// {', `http://:${port80} {`);
  fs.writeFileSync(path.join(tmp, 'Caddyfile'), file);
  let log = '';
  const launch = withCa => {
    const p = spawn(CADDY, ['run', '--config', path.join(tmp, 'Caddyfile'), '--adapter', 'caddyfile'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: process.env.PATH,
        XDG_DATA_HOME: path.join(tmp, withCa ? 'd1' : 'd2'),
        XDG_CONFIG_HOME: path.join(tmp, 'c'),
        BRICK_HOST: 'nas.example.lan',
        BRICK_BASE_URL: 'https://nas.example.lan',
        ...(withCa
          ? {
              BRICK_TLS_AUSSTELLER: 'internal',
              BRICK_TLS_OPTIONEN: 'ca local',
              BRICK_CA_EIGEN: `root {\ncert ${dir}/root.crt\n}\nintermediate {\ncert ${dir}/zwischen-kette.crt\nkey ${dir}/zwischen.key\n}`,
            }
          : { BRICK_TLS_AUSSTELLER: 'internal', BRICK_TLS_OPTIONEN: 'sign_with_root' }),
      },
    });
    p.stderr.on('data', d => {
      log = (log + d).slice(-3000);
    });
    return p;
  };
  // Under load (four test files in parallel) the first start with own CA takes longer than 10 s.
  const chain = async ca => {
    for (let i = 0; i < 300; i++) {
      const r = await new Promise(done => {
        const s = tls.connect(
          { host: '127.0.0.1', port, servername: 'nas.example.lan', ca, rejectUnauthorized: !!ca },
          () => {
            const list = [];
            for (let c = s.getPeerCertificate(true); c && !list.includes(c.fingerprint256); c = c.issuerCertificate)
              list.push(c.fingerprint256);
            s.end();
            done({ ok: s.authorized, list });
          },
        );
        s.on('error', () => done(null));
      });
      if (r) return r;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  };
  const p1 = launch(true);
  try {
    const root = fs.readFileSync(path.join(dir, 'root.crt'));
    const r = await chain(root);
    assert.ok(r, `Caddy does not answer:\n${log}`);
    assert.equal(r.ok, true, 'the client does not trust the chain with the own root');
    // Without `ca` the client adds nothing: this is the chain Caddy sends and the app pins.
    const sent = await chain(null);
    assert.equal(sent.list.length, 3, 'leaf, intermediate, root');
    assert.equal(sent.list[2], new crypto.X509Certificate(root).fingerprint256, 'the root is in the chain');
  } finally {
    p1.kill('SIGKILL');
  }
  await new Promise(r => setTimeout(r, 300));
  const p2 = launch(false);
  try {
    const r = await chain(null);
    assert.ok(r, `Caddy without its own CA does not answer:\n${log}`);
    assert.equal(r.list.length, 2, 'with CA_OHNE_NAMENSBESCHRAENKUNG=ja: leaf and Caddy’s root');
  } finally {
    p2.kill('SIGKILL');
  }
});

test('without an issuer the Caddyfile is invalid', { skip: !CADDY && 'no Caddy (CADDY_BIN)' }, () => {
  const adapt = env =>
    spawnSync(CADDY, ['adapt', '--config', path.join(ROOT, 'Caddyfile'), '--adapter', 'caddyfile'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BRICK_HOST: 'nas.example.lan', BRICK_BASE_URL: 'https://nas.example.lan', ...env },
    });
  const without = adapt({});
  assert.notEqual(without.status, 0, 'without an issuer Caddy falls back to a default');
  for (const [issuer, options, expected] of [
    ['internal', 'sign_with_root', { module: 'internal', sign_with_root: true }],
    ['internal', 'ca local', { module: 'internal', ca: 'local' }],
    ['acme', 'email a@example.org', { module: 'acme', email: 'a@example.org' }],
  ]) {
    const r = adapt({ BRICK_TLS_AUSSTELLER: issuer, BRICK_TLS_OPTIONEN: options });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).apps.tls.automation.policies, [
      { subjects: ['nas.example.lan'], issuers: [expected], reuse_private_keys: true },
    ]);
  }
});

test('Caddy keeps the key when renewing', { skip: !CADDY && 'no Caddy (CADDY_BIN)' }, () => {
  for (const issuer of ['internal', 'acme']) {
    const r = spawnSync(CADDY, ['adapt', '--config', path.join(ROOT, 'Caddyfile'), '--adapter', 'caddyfile'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BRICK_HOST: 'nas.example.lan', BRICK_TLS_AUSSTELLER: issuer },
    });
    assert.equal(r.status, 0, r.stderr);
    const [policy] = JSON.parse(r.stdout).apps.tls.automation.policies;
    assert.equal(policy.reuse_private_keys, true, `${issuer}: a new key per renewal`);
  }
});
