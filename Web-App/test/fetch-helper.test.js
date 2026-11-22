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
const gesehen = [];
const server = https.createServer({ key, cert }, (req, res) => {
  gesehen.push({ host: req.headers.host, path: req.url, auth: req.headers.authorization || null });
  const redirect = ziel => {
    res.writeHead(302, { Location: ziel });
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
class Umlenker extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect({ ...opt, host: '127.0.0.1', port, ca: cert, servername: opt.servername || opt.host }, cb);
  }
}

const agent = new https.Agent({ ca: cert });
const opt = (mehr = {}) => ({ hosts: [`localhost:${port}`], maxBytes: 1000, zeitlimitMs: 3000, agent, ...mehr });
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
    assert.ok(e instanceof FetchError, `kein AbrufFehler: ${e}`);
    return e.reason;
  }
  assert.fail('kein Fehler');
}

test('a relative redirect is resolved against the starting address', async () => {
  const r = await holeHttps(`${basis()}/relativ`, opt());
  assert.equal(r.status, 200);
  assert.equal(r.url, `${basis()}/bild.jpg`);
  assert.equal(r.koerper.length, IMAGE.length);
});

// Counter-check (measured 02.11.2026): in abruf.ts the condition “only GET follows”
// removed → red (the POST lands as GET on /bild.jpg, status 200).
test('a POST follows no redirect', async () => {
  const vorher = gesehen.length;
  const r = await holeHttps(`${basis()}/relativ`, opt({ methode: 'POST', rumpf: '{"a":1}' }));
  assert.equal(r.status, 302);
  assert.deepEqual(
    gesehen.slice(vorher).map(g => g.path),
    ['/relativ'],
  );
});

test('http redirect, missing and unreadable target are rejected', async () => {
  for (const path of ['/http', '/ohne-ziel', '/kaputt'])
    assert.equal(await reason(holeHttps(`${basis()}${path}`, opt())), 'umleitung', path);
});

test('a foreign host is rejected', async () => {
  const vorher = gesehen.length;
  assert.equal(await reason(holeHttps(`${basis()}/fremd`, opt())), 'umleitung');
  assert.equal(
    gesehen.slice(vorher).filter(g => g.host.startsWith('example.org')).length,
    0,
    'fremder Host wurde abgerufen',
  );
});

test('a start address outside the list or without https does not go out', async () => {
  const vorher = gesehen.length;
  assert.equal(await reason(holeHttps(`http://localhost:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await reason(holeHttps(`https://127.0.0.1:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await reason(holeHttps('kein url', opt())), 'adresse');
  assert.equal(gesehen.length, vorher);
});

test('a redirect loop ends at the limit', async () => {
  const vorher = gesehen.length;
  assert.equal(await reason(holeHttps(`${basis()}/schleife`, opt({ redirects: 3 }))), 'umleitung');
  assert.equal(gesehen.length - vorher, 4);
});

test('Authorization does not stay on a host change', async () => {
  const r = await holeHttps(
    `${basis()}/wechsel`,
    opt({
      hosts: [`localhost:${port}`, `127.0.0.1:${port}`],
      kopfzeilen: { Authorization: 'key geheim', Cookie: 'a=b' },
    }),
  );
  assert.equal(JSON.parse(r.koerper.toString()).auth, null);
  assert.equal(gesehen.find(g => g.path === '/wechsel').auth, 'key geheim', 'der erste Sprung trägt den Schlüssel');
});

test('body above the limit, announced or without a length', async () => {
  assert.equal(await reason(holeHttps(`${basis()}/gross-angesagt`, opt())), 'zu-gross');
  assert.equal(
    await reason(holeHttps(`${basis()}/gross-still`, opt())),
    'zu-gross',
    'Körper ohne Längenangabe über der Grenze',
  );
  const a = await openHttps(`${basis()}/gross-still`, opt());
  const error = await new Promise(fertig => {
    const s = a.stream();
    s.resume();
    s.on('error', fertig);
    s.on('end', () => fertig(null));
  });
  assert.equal(error?.reason, 'zu-gross', 'der Strom endet nicht mit Fehler');
});

test('a silent server runs into the timeout', async () => {
  assert.equal(await reason(holeHttps(`${basis()}/still`, opt({ zeitlimitMs: 300 }))), 'time_limit');
});

test('downloadSetImage survives every redirect', async t => {
  const echt = https.globalAgent;
  https.globalAgent = new Umlenker();
  const nr = `abruftest-${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${nr}.jpg`);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  t.after(() => {
    https.globalAgent.destroy();
    https.globalAgent = echt;
    fs.rmSync(datei, { force: true });
  });
  for (const path of ['/http', '/fremd', '/ohne-ziel', '/kaputt', '/schleife'])
    assert.equal(await downloadSetImage(`https://cdn.rebrickable.com${path}`, nr), null, path);
  assert.equal(fs.existsSync(datei), false);
  assert.equal(await downloadSetImage('https://cdn.rebrickable.com/relativ', nr), `/images/sets/${nr}.jpg`);
  assert.equal(fs.readFileSync(datei).length, IMAGE.length);
});
