/**
 * downloadFile (clients/rebrickable.ts) holt Anleitungen und Bilder auf die
 * Platte, von wo sie an alle Konten gehen. Nur über https, und eine Datei
 * über der Grenze wird im Strom abgebrochen und nicht abgelegt.
 *
 * https.get wird abgefangen: Der Test sieht, was abgerufen würde, und
 * liefert selbst die Antwort.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  die Prüfung `url.startsWith('https://')` entfernt und wieder `http`
 *      für http-Adressen → rot: „eine http-Adresse wird abgerufen“
 *   B  den Abbruch im data-Handler entfernt → rot: „die zu grosse Datei
 *      liegt auf der Platte“
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const https  = require('node:https');
const http   = require('node:http');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const _req = require('./helpers/sources').buildAndRequire();
const { downloadFile } = _req('clients/rebrickable.js');

/** https.get und http.get abfangen; `antwort(url)` liefert { status, kopf, teile }. */
function abfangen(t, antwort) {
  const echt = { https: https.get, http: http.get };
  const abgerufen = [];
  const fang = (url, _opt, cb) => {
    abgerufen.push(String(url));
    const req = new EventEmitter();
    req.setTimeout = () => req; req.destroy = () => {};
    const a = antwort(String(url));
    const res = new PassThrough();
    res.statusCode = a.status; res.headers = a.kopf || {};
    setImmediate(() => {
      cb(res);
      (async () => { for (const teil of a.teile || []) { if (res.destroyed) return; res.write(teil); await new Promise(r => setImmediate(r)); } res.end(); })();
    });
    return req;
  };
  https.get = fang; http.get = fang;
  t.after(() => { https.get = echt.https; http.get = echt.http; });
  return abgerufen;
}

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-download-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
const ziel = (name) => path.join(ordner, name);

test('nur https', async (t) => {
  const abgerufen = abfangen(t, () => ({ status: 200, teile: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('http://cdn.rebrickable.com/media/x.pdf', ziel('a.pdf')), false);
  assert.deepEqual(abgerufen, [], 'eine http-Adresse wird abgerufen');
  assert.equal(fs.existsSync(ziel('a.pdf')), false);
});

test('eine Umleitung auf http wird nicht befolgt', async (t) => {
  const abgerufen = abfangen(t, (u) => u.endsWith('/start.pdf')
    ? { status: 302, kopf: { location: 'http://cdn.rebrickable.com/ziel.pdf' } }
    : { status: 200, teile: [Buffer.alloc(500, 1)] });
  assert.equal(await downloadFile('https://cdn.rebrickable.com/start.pdf', ziel('b.pdf')), false);
  assert.equal(abgerufen.length, 1);
});

test('über der Grenze: im Strom abgebrochen, nichts abgelegt', async (t) => {
  abfangen(t, () => ({ status: 200, teile: Array.from({ length: 50 }, () => Buffer.alloc(1000, 2)) }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross.pdf', ziel('c.pdf'), 10_000), false);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fs.existsSync(ziel('c.pdf')), false, 'die zu grosse Datei liegt auf der Platte');
});

test('Content-Length über der Grenze: gar nicht erst geschrieben', async (t) => {
  abfangen(t, () => ({ status: 200, kopf: { 'content-length': '999999' }, teile: [Buffer.alloc(500, 1)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/gross2.pdf', ziel('d.pdf'), 10_000), false);
  assert.equal(fs.existsSync(ziel('d.pdf')), false);
});

test('unter der Grenze: abgelegt', async (t) => {
  abfangen(t, () => ({ status: 200, teile: [Buffer.alloc(3000, 3), Buffer.alloc(3000, 4)] }));
  assert.equal(await downloadFile('https://cdn.rebrickable.com/klein.pdf', ziel('e.pdf'), 10_000), true);
  assert.equal(fs.statSync(ziel('e.pdf')).size, 6000);
});
