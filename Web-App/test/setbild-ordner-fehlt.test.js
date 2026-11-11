/**
 * downloadSetImage legt data/images/sets selbst an: Auf einer frischen
 * Installation (und im ZAP-Lauf der CI) gibt es den Ordner noch nicht, und jedes
 * Bild endete mit ENOENT auf der .teil-Datei.
 *
 * Gegenprobe (11.11.2026 gemessen):
 *   A  in src/katalog/bilder/setImages.ts das mkdir vor dem Schreiben gestrichen
 *      → rot: „das Bild landet, auch wenn der Ordner fehlt“ (null statt Pfad)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'setbild-ordner-'));
process.env.APP_ROOT = wurzel;
const _req = require('./helpers/sources').buildAndRequire();
const { downloadSetImage } = _req('src/katalog/bilder/setImages.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

const FIX = path.join(__dirname, 'fixtures');
const key = fs.readFileSync(path.join(FIX, 'abruf-test.key'));
const cert = fs.readFileSync(path.join(FIX, 'abruf-test.crt'));
const BILD = Buffer.alloc(600, 0xff);

let port = 0;
const server = https.createServer({ key, cert }, (_q, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end(BILD);
});

/** Jede Verbindung landet beim Testserver; SNI und Zertifikatsprüfung bleiben echt. */
class Umlenker extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect({ ...opt, host: '127.0.0.1', port, ca: cert, servername: opt.servername || opt.host }, cb);
  }
}

test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(undefined)));
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});
test.after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('das Bild landet, auch wenn der Ordner fehlt', async t => {
  const echt = https.globalAgent;
  https.globalAgent = new Umlenker();
  t.after(() => {
    https.globalAgent.destroy();
    https.globalAgent = echt;
  });
  assert.ok(SET_IMAGES_DIR.startsWith(wurzel), 'der Ordner liegt im Testverzeichnis');
  assert.equal(fs.existsSync(SET_IMAGES_DIR), false, 'der Ordner fehlt vor dem Abruf');
  assert.equal(
    await downloadSetImage('https://cdn.rebrickable.com/media/sets/10001-1.jpg', '10001-1'),
    '/images/sets/10001-1.jpg',
  );
  assert.equal(fs.readFileSync(path.join(SET_IMAGES_DIR, '10001-1.jpg')).length, BILD.length);
});
