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
 * Gegenprobe (am 01.11.2026 gemessen):
 *   F  traegtSitzungsKeks() erkennt wieder nur `connect.sid` → rot: „eine
 *      Cookie-Sitzung ohne jede Herkunftsangabe", „ein Bearer-Kopf …"
 * Gegenprobe (am 15.11.2026 gemessen):
 *   G  in nurEigenerHost() wieder `if (!adresse) return next()` → rot: „ohne
 *      APP_BASE_URL nimmt der Host-Filter keinen Namen an“ (200 statt 421)
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { nurEigeneHerkunft, nurEigenerHost } = _req('src/http/herkunft.js');
const http = require('node:http');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('Herkunft schreibender Anfragen', async t => {
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
  const SITZUNG = { cookie: '__Host-bim.sid=s%3Aabc' };
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
    umgebung({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await ruf('POST', { ...SITZUNG, origin: 'https://lego.example.org.boese.example' }), 403);
      assert.equal(await ruf('POST', { ...SITZUNG, referer: 'https://lego.example.org.boese.example/' }), 403);
    } finally {
      umgebung({ APP_BASE_URL: undefined });
    }
  });
  await t.test('ein alter Browser von der eigenen Seite', async () => {
    assert.equal(await ruf('POST', { ...SITZUNG, origin: eigen() }), 200);
    assert.equal(await ruf('POST', { ...SITZUNG, referer: `${eigen()}/#/sets` }), 200);
    umgebung({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await ruf('POST', { ...SITZUNG, origin: 'https://lego.example.org' }), 200, 'APP_BASE_URL');
    } finally {
      umgebung({ APP_BASE_URL: undefined });
    }
  });
  await t.test('lesend und mit Token', async () => {
    assert.equal(await ruf('GET', { 'sec-fetch-site': 'cross-site' }), 200);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'cross-site', authorization: 'Bearer abc' }), 200);
  });
  await t.test('ein Bearer-Kopf neben dem Sitzungs-Cookie schaltet nichts ab', async () => {
    // Mit Cookie gilt die Sitzung, nicht das Token — die Herkunft zählt also.
    assert.equal(
      await ruf('POST', {
        'sec-fetch-site': 'same-site',
        authorization: 'Bearer x',
        cookie: 'theme=dunkel; bim.sid=s%3Aabc',
      }),
      403,
    );
    assert.equal(
      await ruf('POST', { 'sec-fetch-site': 'same-origin', authorization: 'Bearer x', cookie: 'bim.sid=s%3Aabc' }),
      200,
    );
  });
});

test('ohne APP_BASE_URL nimmt der Host-Filter keinen Namen an, nur Loopback und IP-Adressen', async t => {
  umgebung({ APP_BASE_URL: undefined });
  const app = express();
  app.use(nurEigenerHost);
  app.all('/{*pfad}', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(r => srv.close(r)));
  await new Promise(r => srv.once('listening', r));
  const mitHost = (host, pfad = '/api/v1/auth/me') =>
    new Promise((fertig, fehler) => {
      const r = http.request(
        { host: '127.0.0.1', port: srv.address().port, path: pfad, setHost: false, headers: { host } },
        res => {
          let text = '';
          res.on('data', d => {
            text += d;
          });
          res.on('end', () => fertig({ status: res.statusCode, text }));
        },
      );
      r.on('error', fehler);
      r.end();
    });
  // Ein umgebogener Name (DNS-Rebinding) zeigt auf dieselbe Adresse, trägt aber seinen Namen.
  const fremd = await mitHost('boese.example');
  assert.equal(fremd.status, 421);
  assert.equal(JSON.parse(fremd.text).code, 'fremder_host');
  assert.match(JSON.parse(fremd.text).error, /127\.0\.0\.1/, 'die Absage nennt die eigene Adresse');
  assert.equal((await mitHost('nas.local:3000')).status, 421);
  for (const h of ['localhost:3000', '127.0.0.1', '192.168.1.20:3000', '[fe80::1]:8080'])
    assert.equal((await mitHost(h)).status, 200, h);
  assert.equal((await mitHost('boese.example', '/api/v1/health')).status, 200, 'Gesundheit bleibt frei');
});
