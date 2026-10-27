/**
 * Ein async-Handler, der wirft, wird zu einer 500 — ohne eigenen Wrapper.
 *
 * Unter Express 4 blieb die Antwort aus, und ein Reverse-Proxy lieferte nach
 * seinem Timeout 502; server.ts umschloss deshalb jeden Router-Handler.
 * Express 5 (router 2) reicht abgelehnte Promises selbst an next() weiter.
 * Dieser Test hält fest, dass das für die installierte Fassung gilt — für
 * Handler wie für Middleware über router.use.
 *
 * Gegenprobe (am 27.10. gemessen): ein Handler, der nie antwortet, statt des
 * werfenden → rot mit „hängt" — die Sonde erkennt einen Hänger also.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

function probe(app, pfad) {
  return new Promise(resolve => {
    const srv = app.listen(0, () => {
      const req = http.get({ port: srv.address().port, path: pfad, timeout: 800 }, res => {
        res.resume();
        res.on('end', () => { srv.close(); resolve(res.statusCode); });
      });
      req.on('timeout', () => { req.destroy(); srv.close(); resolve('hängt'); });
      req.on('error', () => { srv.close(); resolve('hängt'); });
    });
  });
}

function app() {
  const a = express();
  const r = express.Router();
  r.get('/boom', async () => { throw new Error('kaputt'); });
  const m = express.Router();
  m.use(async () => { throw new Error('auch kaputt'); });
  a.use('/api', r);
  a.use('/mw', m);
  a.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return a;
}

test('ein werfender async-Handler wird zur 500', async () => {
  assert.equal(await probe(app(), '/api/boom'), 500);
});

test('eine werfende async-Middleware ebenso', async () => {
  assert.equal(await probe(app(), '/mw/x'), 500);
});
