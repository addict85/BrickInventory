/**
 * An async handler that throws becomes a 500 — without its own wrapper.
 *
 * Counter-check (measured on 27.10.): a handler that never answers instead of the
 * throwing one → red with “hangs" — so the probe recognizes a hang.
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
        res.on('end', () => {
          srv.close();
          resolve(res.statusCode);
        });
      });
      req.on('timeout', () => {
        req.destroy();
        srv.close();
        resolve('hängt');
      });
      req.on('error', () => {
        srv.close();
        resolve('hängt');
      });
    });
  });
}

function app() {
  const a = express();
  const r = express.Router();
  r.get('/boom', async () => {
    throw new Error('kaputt');
  });
  const m = express.Router();
  m.use(async () => {
    throw new Error('auch kaputt');
  });
  a.use('/api', r);
  a.use('/mw', m);
  a.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return a;
}

test('a throwing async handler becomes a 500', async () => {
  assert.equal(await probe(app(), '/api/boom'), 500);
});

test('a throwing async middleware likewise', async () => {
  assert.equal(await probe(app(), '/mw/x'), 500);
});
