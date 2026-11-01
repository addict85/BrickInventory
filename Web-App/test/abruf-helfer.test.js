/**
 * src/infra/abruf.ts gegen einen echten TLS-Server auf 127.0.0.1: Umleitungen
 * mit relativer, http- und fremder Adresse, Schleifen, zu grosse Körper und
 * Stille dürfen den Prozess nicht beenden; sie werden zu AbrufFehler.
 * downloadSetImage läuft über einen Agenten, der jeden Host auf den Testserver
 * lenkt — so sieht der Test den echten Aufrufer, nicht nur den Helfer.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in src/katalog/bilder/setImages.ts den alten Abruf (https.get mit
 *      tryGet(res.headers.location)) zurückgeholt → rot: „downloadSetImage
 *      übersteht jede Umleitung" (uncaughtException ERR_INVALID_URL)
 *   B  in abruf.ts die Hostliste nur noch für die Startadresse geprüft
 *      (naechsteUmleitung ohne o.hosts, sprung() nur bei u === start) → rot:
 *      „fremder Host wird abgewiesen" und „downloadSetImage übersteht …"
 *   C  in abruf.ts die Zählung im data-Handler von holeHttps entfernt → rot:
 *      „Körper ohne Längenangabe über der Grenze"
 *   D  in fremdeAdressen.ts den Kopf-Filter bei Hostwechsel entfernt → rot:
 *      „Authorization bleibt beim Hostwechsel nicht stehen"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const _req = require('./helpers/sources').buildAndRequire();
const { holeHttps, oeffneHttps, AbrufFehler } = _req('src/infra/abruf.js');
const { downloadSetImage } = _req('src/katalog/bilder/setImages.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

const FIX = path.join(__dirname, 'fixtures');
const key = fs.readFileSync(path.join(FIX, 'abruf-test.key'));
const cert = fs.readFileSync(path.join(FIX, 'abruf-test.crt'));
const BILD = Buffer.alloc(600, 0xff);

let port = 0;
const gesehen = [];
const server = https.createServer({ key, cert }, (req, res) => {
  gesehen.push({ host: req.headers.host, pfad: req.url, auth: req.headers.authorization || null });
  const umleiten = (ziel) => { res.writeHead(302, { Location: ziel }); res.end(); };
  switch (req.url.split('?')[0]) {
    case '/relativ': return umleiten('/bild.jpg');
    case '/http': return umleiten(`http://localhost:${port}/bild.jpg`);
    case '/fremd': return umleiten(`https://example.org:${port}/bild.jpg`);
    case '/ohne-ziel': res.writeHead(302); return res.end();
    case '/kaputt': return umleiten('https://[::1');
    case '/schleife': return umleiten('/schleife');
    case '/wechsel': return umleiten(`https://127.0.0.1:${port}/echo`);
    case '/echo': res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ auth: req.headers.authorization || null }));
    case '/gross-angesagt': res.writeHead(200, { 'Content-Length': String(5000) }); return res.end(Buffer.alloc(5000));
    case '/gross-still': res.writeHead(200); res.write(Buffer.alloc(800)); return res.end(Buffer.alloc(800));
    case '/still': return;
    case '/bild.jpg': res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(BILD);
    default: res.writeHead(404); res.end();
  }
});

/** Jede Verbindung landet beim Testserver; SNI und Zertifikatsprüfung bleiben echt. */
class Umlenker extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect({ ...opt, host: '127.0.0.1', port, ca: cert, servername: opt.servername || opt.host }, cb);
  }
}

const agent = new https.Agent({ ca: cert });
const opt = (mehr = {}) => ({ hosts: ['localhost'], maxBytes: 1000, zeitlimitMs: 3000, agent, ...mehr });
const basis = () => `https://localhost:${port}`;

test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.after(() => { server.closeAllConnections(); server.close(); });

async function grund(versprechen) {
  try { await versprechen; } catch (e) {
    assert.ok(e instanceof AbrufFehler, `kein AbrufFehler: ${e}`);
    return e.grund;
  }
  assert.fail('kein Fehler');
}

test('relative Umleitung wird gegen die Ausgangsadresse aufgelöst', async () => {
  const r = await holeHttps(`${basis()}/relativ`, opt());
  assert.equal(r.status, 200);
  assert.equal(r.url, `${basis()}/bild.jpg`);
  assert.equal(r.koerper.length, BILD.length);
});

test('http-Umleitung, fehlendes und unlesbares Ziel werden abgewiesen', async () => {
  for (const pfad of ['/http', '/ohne-ziel', '/kaputt'])
    assert.equal(await grund(holeHttps(`${basis()}${pfad}`, opt())), 'umleitung', pfad);
});

test('fremder Host wird abgewiesen', async () => {
  const vorher = gesehen.length;
  assert.equal(await grund(holeHttps(`${basis()}/fremd`, opt())), 'umleitung');
  assert.equal(gesehen.slice(vorher).filter(g => g.host.startsWith('example.org')).length, 0, 'fremder Host wurde abgerufen');
});

test('Startadresse ausserhalb der Liste oder ohne https geht nicht hinaus', async () => {
  const vorher = gesehen.length;
  assert.equal(await grund(holeHttps(`http://localhost:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await grund(holeHttps(`https://127.0.0.1:${port}/bild.jpg`, opt())), 'adresse');
  assert.equal(await grund(holeHttps('kein url', opt())), 'adresse');
  assert.equal(gesehen.length, vorher);
});

test('Umleitungsschleife endet an der Grenze', async () => {
  const vorher = gesehen.length;
  assert.equal(await grund(holeHttps(`${basis()}/schleife`, opt({ umleitungen: 3 }))), 'umleitung');
  assert.equal(gesehen.length - vorher, 4);
});

test('Authorization bleibt beim Hostwechsel nicht stehen', async () => {
  const r = await holeHttps(`${basis()}/wechsel`,
    opt({ hosts: ['localhost', '127.0.0.1'], kopfzeilen: { Authorization: 'key geheim', Cookie: 'a=b' } }));
  assert.equal(JSON.parse(r.koerper.toString()).auth, null);
  assert.equal(gesehen.find(g => g.pfad === '/wechsel').auth, 'key geheim', 'der erste Sprung trägt den Schlüssel');
});

test('Körper über der Grenze, angesagt oder ohne Längenangabe', async () => {
  assert.equal(await grund(holeHttps(`${basis()}/gross-angesagt`, opt())), 'zu-gross');
  assert.equal(await grund(holeHttps(`${basis()}/gross-still`, opt())), 'zu-gross', 'Körper ohne Längenangabe über der Grenze');
  const a = await oeffneHttps(`${basis()}/gross-still`, opt());
  const fehler = await new Promise(fertig => { const s = a.strom(); s.resume(); s.on('error', fertig); s.on('end', () => fertig(null)); });
  assert.equal(fehler?.grund, 'zu-gross', 'der Strom endet nicht mit Fehler');
});

test('ein schweigender Server läuft ins Zeitlimit', async () => {
  assert.equal(await grund(holeHttps(`${basis()}/still`, opt({ zeitlimitMs: 300 }))), 'zeitlimit');
});

test('downloadSetImage übersteht jede Umleitung', async (t) => {
  const echt = https.globalAgent;
  https.globalAgent = new Umlenker();
  const nr = `abruftest-${process.pid}`;
  const datei = path.join(SET_IMAGES_DIR, `${nr}.jpg`);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  t.after(() => { https.globalAgent.destroy(); https.globalAgent = echt; fs.rmSync(datei, { force: true }); });
  for (const pfad of ['/http', '/fremd', '/ohne-ziel', '/kaputt', '/schleife'])
    assert.equal(await downloadSetImage(`https://cdn.rebrickable.com${pfad}`, nr), null, pfad);
  assert.equal(fs.existsSync(datei), false);
  assert.equal(await downloadSetImage('https://cdn.rebrickable.com/relativ', nr), `/images/sets/${nr}.jpg`);
  assert.equal(fs.readFileSync(datei).length, BILD.length);
});
