/**
 * Schreibende Anfragen einer fremden Seite werden abgewiesen (CSRF), alles
 * andere geht durch. Dass server.ts die Wache einhängt, prüft
 * signale-zwei-worker-db am echten Server.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  nur 'cross-site' abgewiesen statt alles ausser same-origin/none → rot:
 *      „eine Nachbar-Subdomain"
 *   B  die Cookie-Bedingung an der Bearer-Ausnahme entfernt → rot: „ein
 *      Bearer-Kopf neben dem Sitzungs-Cookie schaltet nichts ab"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { nurEigeneHerkunft } = _req('utils/herkunft.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('Herkunft schreibender Anfragen', async (t) => {
  const app = express();
  app.use(nurEigeneHerkunft);
  app.all('/x', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const ruf = async (method, kopf = {}) =>
    (await fetch(`http://127.0.0.1:${srv.address().port}/x`, { method, headers: kopf })).status;

  await t.test('eine fremde Website', async () => {
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await ruf('DELETE', { 'sec-fetch-site': 'cross-site' }), 403);
  });
  await t.test('eine Nachbar-Subdomain', async () => {
    assert.equal(await ruf('PUT', { 'sec-fetch-site': 'same-site' }), 403);
  });
  await t.test('die eigene Seite', async () => {
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'none' }), 200, 'vom Nutzer selbst eingegeben');
  });
  await t.test('ohne Kopf: App, Skripte, alte Browser', async () => {
    assert.equal(await ruf('POST'), 200);
  });
  await t.test('lesend und mit Token', async () => {
    assert.equal(await ruf('GET', { 'sec-fetch-site': 'cross-site' }), 200);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'cross-site', authorization: 'Bearer abc' }), 200);
  });
  await t.test('ein Bearer-Kopf neben dem Sitzungs-Cookie schaltet nichts ab', async () => {
    // Mit Cookie gilt die Sitzung, nicht das Token — die Herkunft zählt also.
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'same-site', authorization: 'Bearer x',
                                     cookie: 'theme=dunkel; connect.sid=s%3Aabc' }), 403);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'same-origin', authorization: 'Bearer x',
                                     cookie: 'connect.sid=s%3Aabc' }), 200);
  });
});
