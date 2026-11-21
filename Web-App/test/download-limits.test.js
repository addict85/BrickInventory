/**
 * downloadFile (clients/rebrickable.ts) fetches instructions and images onto the
 * disk, from where they go to all accounts. Only over https, and a file
 * over the limit is aborted in the stream and not stored.
 *
 * https.get is intercepted: the test sees what would be fetched and
 * delivers the response itself.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  the check `url.startsWith('https://')` removed and again `http`
 *      for http addresses → red: “an http address is fetched”
 *   B  the abort in the data handler removed → red: “the too large file
 *      lies on disk”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const _req = require('./helpers/sources').buildAndRequire();
const { downloadFile } = _req('clients/rebrickable.js');

/** Intercept https.get and http.get; `antwort(url)` returns { status, kopf, teile }. */
function intercept(t, antwort) {
  const echt = { https: https.get, http: http.get };
  const abgerufen = [];
  const fang = (url, _opt, cb) => {
    abgerufen.push(String(url));
    const req = /** @type {any} */ (new EventEmitter());
    req.setTimeout = () => req;
    req.destroy = () => {};
    const a = antwort(String(url));
    const res = /** @type {any} */ (new PassThrough());
    res.statusCode = a.status;
    res.headers = a.kopf || {};
    setImmediate(() => {
      cb(res);
      (async () => {
        for (const teil of a.teile || []) {
          if (res.destroyed) return;
          res.write(teil);
          await new Promise(r => setImmediate(r));
        }
        res.end();
      })();
    });
    return req;
  };
  /** @type {any} */ (https).get = fang;
  /** @type {any} */ (http).get = fang;
  t.after(() => {
    https.get = echt.https;
    http.get = echt.http;
  });
  return abgerufen;
}

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-download-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
const ziel = name => path.join(ordner, name);

test('only https', async t => {
  const abgerufen = intercept(t, () => ({ status: 200, teile: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('http://cdn.rebrickable.com/media/x.pdf', ziel('a.pdf')), false);
  assert.deepEqual(abgerufen, [], 'eine http-Adresse wird abgerufen');
  assert.equal(fs.existsSync(ziel('a.pdf')), false);
});

test('a redirect to http is not followed', async t => {
  const abgerufen = intercept(t, u =>
    u.endsWith('/start.pdf')
      ? { status: 302, kopf: { location: 'http://cdn.rebrickable.com/ziel.pdf' } }
      : { status: 200, teile: [Buffer.alloc(500, 1)] },
  );
  assert.equal(await downloadFile('https://cdn.rebrickable.com/start.pdf', ziel('b.pdf')), false);
  assert.equal(abgerufen.length, 1);
});

test('above the limit: aborted in the stream, nothing stored', async t => {
  intercept(t, () => ({ status: 200, teile: Array.from({ length: 50 }, () => Buffer.alloc(1000, 2)) }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross.pdf', ziel('c.pdf'), 10_000), false);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fs.existsSync(ziel('c.pdf')), false, 'die zu grosse Datei liegt auf der Platte');
});

test('Content-Length above the limit: not even written', async t => {
  intercept(t, () => ({ status: 200, kopf: { 'content-length': '999999' }, teile: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross2.pdf', ziel('d.pdf'), 10_000), false);
  assert.equal(fs.existsSync(ziel('d.pdf')), false);
});

test('below the limit: stored', async t => {
  intercept(t, () => ({ status: 200, teile: [Buffer.alloc(3000, 3), Buffer.alloc(3000, 4)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/klein.pdf', ziel('e.pdf'), 10_000), true);
  assert.equal(fs.statSync(ziel('e.pdf')).size, 6000);
});
