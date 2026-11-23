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

/** Intercept https.get and http.get; `antwort(url)` returns { status, head, teile }. */
function intercept(t, response) {
  const original = { https: https.get, http: http.get };
  const fetched = [];
  const fang = (url, _opt, cb) => {
    fetched.push(String(url));
    const req = /** @type {any} */ (new EventEmitter());
    req.setTimeout = () => req;
    req.destroy = () => {};
    const a = response(String(url));
    const res = /** @type {any} */ (new PassThrough());
    res.statusCode = a.status;
    res.headers = a.head || {};
    setImmediate(() => {
      cb(res);
      (async () => {
        for (const part of a.parts || []) {
          if (res.destroyed) return;
          res.write(part);
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
    https.get = original.https;
    http.get = original.http;
  });
  return fetched;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-download-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const target = name => path.join(dir, name);

test('only https', async t => {
  const fetched = intercept(t, () => ({ status: 200, parts: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('http://cdn.rebrickable.com/media/x.pdf', target('a.pdf')), false);
  assert.deepEqual(fetched, [], 'an http address is fetched');
  assert.equal(fs.existsSync(target('a.pdf')), false);
});

test('a redirect to http is not followed', async t => {
  const fetched = intercept(t, u =>
    u.endsWith('/start.pdf')
      ? { status: 302, head: { location: 'http://cdn.rebrickable.com/ziel.pdf' } }
      : { status: 200, parts: [Buffer.alloc(500, 1)] },
  );
  assert.equal(await downloadFile('https://cdn.rebrickable.com/start.pdf', target('b.pdf')), false);
  assert.equal(fetched.length, 1);
});

test('above the limit: aborted in the stream, nothing stored', async t => {
  intercept(t, () => ({ status: 200, parts: Array.from({ length: 50 }, () => Buffer.alloc(1000, 2)) }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross.pdf', target('c.pdf'), 10_000), false);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fs.existsSync(target('c.pdf')), false, 'the oversized file is on disk');
});

test('Content-Length above the limit: not even written', async t => {
  intercept(t, () => ({ status: 200, head: { 'content-length': '999999' }, parts: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross2.pdf', target('d.pdf'), 10_000), false);
  assert.equal(fs.existsSync(target('d.pdf')), false);
});

test('below the limit: stored', async t => {
  intercept(t, () => ({ status: 200, parts: [Buffer.alloc(3000, 3), Buffer.alloc(3000, 4)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/klein.pdf', target('e.pdf'), 10_000), true);
  assert.equal(fs.statSync(target('e.pdf')).size, 6000);
});
