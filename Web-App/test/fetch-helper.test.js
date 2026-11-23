/**
 * src/infra/fetch.ts against a real TLS server on 127.0.0.1: redirects
 * with relative, http and foreign addresses, loops, too large bodies and
 * silence must not end the process; they become AbrufFehler.
 * downloadSetImage runs via an agent that directs every host to the test server
 * — so the test sees the real caller, not only the helper.
 *
 * Counter-checks (measured on 01.11.2026):
 *   A  in src/images/setImages.ts the old fetch (https.get with
 *      tryGet(res.headers.location)) brought back → red: “downloadSetImage
 *      survives every redirect" (uncaughtException ERR_INVALID_URL)
 *   B  in abruf.ts the host list only checked for the start address
 *      (nextRedirect without o.hosts, sprung() only at u === start) → red:
 *      “foreign host is rejected" and “downloadSetImage survives …"
 *   C  in abruf.ts the count in the data handler of holeHttps removed → red:
 *      “body without length over the limit"
 *   D  in fremdeAdressen.ts the header filter on host change removed → red:
 *      “Authorization does not stay on host change"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const _req = require('./helpers/sources').buildAndRequire();
const { portOf } = require('./helpers/server');
const { holeHttps, openHttps, FetchError } = _req('src/infra/fetch.js');
const { downloadSetImage } = _req('src/images/setImages.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

const FIX = path.join(__dirname, 'fixtures');
const key = fs.readFileSync(path.join(FIX, 'fetch-test.key'));
const cert = fs.readFileSync(path.join(FIX, 'fetch-test.crt'));
const IMAGE = Buffer.alloc(600, 0xff);

let port = 0;
const seen = [];
const server = https.createServer({ key, cert }, (req, res) => {
  seen.push({ host: req.headers.host, path: req.url, auth: req.headers.authorization || null });
  const redirect = target => {
    res.writeHead(302, { Location: target });
    res.end();
  };
  switch (req.url.split('?')[0]) {
    case '/relativ':
      return redirect('/bild.jpg');
    case '/http':
      return redirect(`http://localhost:${port}/bild.jpg`);
    case '/fremd':
      return redirect(`https://example.org:${port}/bild.jpg`);
    case '/ohne-ziel':
      res.writeHead(302);
      return res.end();
    case '/kaputt':
      return redirect('https://[::1');
    case '/schleife':
      return redirect('/schleife');
    case '/wechsel':
      return redirect(`https://127.0.0.1:${port}/echo`);
    case '/echo':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ auth: req.headers.authorization || null }));
    case '/gross-angesagt':
      res.writeHead(200, { 'Content-Length': String(5000) });
      return res.end(Buffer.alloc(5000));
    case '/gross-still':
      res.writeHead(200);
      res.write(Buffer.alloc(800));
      return res.end(Buffer.alloc(800));
    case '/still':
      return;
    case '/bild.jpg':
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(IMAGE);
    default:
      res.writeHead(404);
      res.end();
  }
});

/** Every connection lands at the test server; SNI and certificate verification stay real. */
class Redirector extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect({ ...opt, host: '127.0.0.1', port, ca: cert, servername: opt.servername || opt.host }, cb);
  }
}

const agent = new https.Agent({ ca: cert });
const opt = (more = {}) => ({ hosts: [`localhost:${port}`], maxBytes: 1000, timeoutMs: 3000, agent, ...more });
const basis = () => `https://localhost:${port}`;

test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  port = portOf(server);
});
test.after(() => {
  server.closeAllConnections();
  server.close();
});

async function reason(promise) {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof FetchError, `no AbrufFehler: ${e}`);
    return e.reason;
  }
  assert.fail('no error');
}

test('a relative redirect is resolved against the starting address', async () => {
  const r = await holeHttps(`${basis()}/relativ`, opt());
  assert.equal(r.status, 200);
  assert.equal(r.url, `${basis()}/bild.jpg`);
  assert.equal(r.body.length, IMAGE.length);
});

// Counter-check (measured 02.11.2026): in abruf.ts the condition “only GET follows”
// removed → red (the POST lands as GET on /bild.jpg, status 200).
test('a POST follows no redirect', async () => {
  const prior = seen.length;
  const r = await holeHttps(`${basis()}/relativ`, opt({ method: 'POST', bodyText: '{"a":1}' }));
  assert.equal(r.status, 302);
  assert.deepEqual(
    seen.slice(prior).map(g => g.path),
    ['/relativ'],
  );
});

test('http redirect, missing and unreadable target are rejected', async () => {
  for (const path of ['/http', '/ohne-ziel', '/kaputt'])
    assert.equal(await reason(holeHttps(`${basis()}${path}`, opt())), 'umleitung', path);
});

test('a foreign host is rejected', async () => {
  const prior = seen.length;
  assert.equal(await reason(holeHttps(`${basis()}/fremd`, opt())), 'umleitung');
  assert.equal(seen.slice(prior).filter(g => g.host.startsWith('example.org')).length, 0, 'foreign host was fetched');
});

test('a start address outside the list or without https does not go out', async () => {
  const prior = seen.length;
  assert.equal(await reason(holeHttps(`http://localhost:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await reason(holeHttps(`https://127.0.0.1:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await reason(holeHttps('kein url', opt())), 'adresse');
  assert.equal(seen.length, prior);
});

test('a redirect loop ends at the limit', async () => {
  const prior = seen.length;
  assert.equal(await reason(holeHttps(`${basis()}/schleife`, opt({ redirects: 3 }))), 'umleitung');
  assert.equal(seen.length - prior, 4);
});

test('Authorization does not stay on a host change', async () => {
  const r = await holeHttps(
    `${basis()}/wechsel`,
    opt({
      hosts: [`localhost:${port}`, `127.0.0.1:${port}`],
      headers: { Authorization: 'key geheim', Cookie: 'a=b' },
    }),
  );
  assert.equal(JSON.parse(r.body.toString()).auth, null);
  assert.equal(seen.find(g => g.path === '/wechsel').auth, 'key geheim', 'the first hop carries the key');
});

test('body above the limit, announced or without a length', async () => {
  assert.equal(await reason(holeHttps(`${basis()}/gross-angesagt`, opt())), 'zu-gross');
  assert.equal(
    await reason(holeHttps(`${basis()}/gross-still`, opt())),
    'zu-gross',
    'Body without length header above the limit',
  );
  const a = await openHttps(`${basis()}/gross-still`, opt());
  const error = await new Promise(done => {
    const s = a.stream();
    s.resume();
    s.on('error', done);
    s.on('end', () => done(null));
  });
  assert.equal(error?.reason, 'zu-gross', 'the stream does not end with an error');
});

test('a silent server runs into the timeout', async () => {
  assert.equal(await reason(holeHttps(`${basis()}/still`, opt({ timeoutMs: 300 }))), 'time_limit');
});

test('downloadSetImage survives every redirect', async t => {
  const original = https.globalAgent;
  https.globalAgent = new Redirector();
  const nr = `abruftest-${process.pid}`;
  const file = path.join(SET_IMAGES_DIR, `${nr}.jpg`);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  t.after(() => {
    https.globalAgent.destroy();
    https.globalAgent = original;
    fs.rmSync(file, { force: true });
  });
  for (const path of ['/http', '/fremd', '/ohne-ziel', '/kaputt', '/schleife'])
    assert.equal(await downloadSetImage(`https://cdn.rebrickable.com${path}`, nr), null, path);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await downloadSetImage('https://cdn.rebrickable.com/relativ', nr), `/images/sets/${nr}.jpg`);
  assert.equal(fs.readFileSync(file).length, IMAGE.length);
});
