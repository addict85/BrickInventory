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
 * Gegenproben (am 30.10. gemessen):
 *   C  Origin/Referer nicht geprüft (Zweig entfernt) → rot: „ein alter
 *      Browser ohne Sec-Fetch-Site, von einer fremden Seite"
 *   D  ohne Kopf immer durchgelassen → rot: „eine Cookie-Sitzung ohne jede
 *      Herkunftsangabe"
 *   E  Host-Vergleich durch `startsWith` ersetzt → rot: „ein Host, der nur
 *      so anfängt wie der eigene"
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
  await t.test('ohne Kopf und ohne Sitzung: App, Skripte', async () => {
    assert.equal(await ruf('POST'), 200);
    assert.equal(await ruf('POST', { authorization: 'Bearer abc' }), 200);
  });
  const eigen = () => `http://127.0.0.1:${srv.address().port}`;
  const SITZUNG = { cookie: 'connect.sid=s%3Aabc' };
  await t.test('eine Cookie-Sitzung ohne jede Herkunftsangabe', async () => {
    assert.equal(await ruf('POST', SITZUNG), 403);
    assert.equal(await ruf('DELETE', SITZUNG), 403);
    assert.equal(await ruf('GET', SITZUNG), 200, 'lesend bleibt erlaubt');
  });
  await t.test('ein alter Browser ohne Sec-Fetch-Site, von einer fremden Seite', async () => {
    assert.equal(await ruf('POST', { ...SITZUNG, origin: 'https://boese.example' }), 403);
    assert.equal(await ruf('POST', { ...SITZUNG, origin: 'null' }), 403, 'Origin „null" (Sandbox, Datei)');
    assert.equal(await ruf('POST', { ...SITZUNG, referer: 'https://boese.example/seite' }), 403);
    assert.equal(await ruf('POST', { origin: 'https://boese.example' }), 403, 'auch ohne Sitzung (Anmelde-CSRF)');
  });
  await t.test('ein Host, der nur so anfängt wie der eigene', async () => {
    process.env.APP_BASE_URL = 'https://lego.example.org';
    try {
      assert.equal(await ruf('POST', { ...SITZUNG, origin: 'https://lego.example.org.boese.example' }), 403);
      assert.equal(await ruf('POST', { ...SITZUNG, referer: 'https://lego.example.org.boese.example/' }), 403);
    } finally { delete process.env.APP_BASE_URL; }
  });
  await t.test('ein alter Browser von der eigenen Seite', async () => {
    assert.equal(await ruf('POST', { ...SITZUNG, origin: eigen() }), 200);
    assert.equal(await ruf('POST', { ...SITZUNG, referer: `${eigen()}/#/sets` }), 200);
    process.env.APP_BASE_URL = 'https://lego.example.org';
    try { assert.equal(await ruf('POST', { ...SITZUNG, origin: 'https://lego.example.org' }), 200, 'APP_BASE_URL'); }
    finally { delete process.env.APP_BASE_URL; }
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
