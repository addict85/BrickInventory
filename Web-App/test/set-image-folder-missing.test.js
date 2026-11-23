/**
 * downloadSetImage creates data/images/sets itself: on a fresh
 * installation (and in the ZAP run of the CI) the folder does not exist yet, and every
 * image ended with ENOENT on the .teil file.
 *
 * Counter-check (measured 11.11.2026):
 *   A  the mkdir before writing deleted in src/images/setImages.ts
 *      → red: “the image lands even if the folder is missing” (null instead of a path)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setbild-ordner-'));
process.env.APP_ROOT = root;
const _req = require('./helpers/sources').buildAndRequire();
const { downloadSetImage } = _req('src/images/setImages.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

const FIX = path.join(__dirname, 'fixtures');
const key = fs.readFileSync(path.join(FIX, 'fetch-test.key'));
const cert = fs.readFileSync(path.join(FIX, 'fetch-test.crt'));
const IMAGE = Buffer.alloc(600, 0xff);

let port = 0;
const server = https.createServer({ key, cert }, (_q, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end(IMAGE);
});

/** Every connection lands at the test server; SNI and certificate check stay real. */
class Redirector extends https.Agent {
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
  fs.rmSync(root, { recursive: true, force: true });
});

test('the image lands even if the folder is missing', async t => {
  const original = https.globalAgent;
  https.globalAgent = new Redirector();
  t.after(() => {
    https.globalAgent.destroy();
    https.globalAgent = original;
  });
  assert.ok(SET_IMAGES_DIR.startsWith(root), 'the folder lives in the test directory');
  assert.equal(fs.existsSync(SET_IMAGES_DIR), false, 'the folder is missing before the fetch');
  assert.equal(
    await downloadSetImage('https://cdn.rebrickable.com/media/sets/10001-1.jpg', '10001-1'),
    '/images/sets/10001-1.jpg',
  );
  assert.equal(fs.readFileSync(path.join(SET_IMAGES_DIR, '10001-1.jpg')).length, IMAGE.length);
});
