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
 *   F  carriesSessionCookie() erkennt wieder nur `connect.sid` → rot: „eine
 *      Cookie-Sitzung ohne jede Herkunftsangabe", „ein Bearer-Kopf …"
 * Gegenprobe (am 15.11.2026 gemessen):
 *   G  in onlyOwnHost() wieder `if (!adresse) return next()` → rot: „ohne
 *      APP_BASE_URL nimmt der Host-Filter keinen Namen an“ (200 statt 421)
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { onlyOwnOrigin, onlyOwnHost } = _req('src/http/origin.js');
const http = require('node:http');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('origin of writing requests', async t => {
  const app = express();
  app.use(onlyOwnOrigin);
  app.all('/x', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const ruf = async (method, kopf = {}) =>
    (await fetch(`http://127.0.0.1:${srv.address().port}/x`, { method, headers: kopf })).status;

  await t.test('a foreign website', async () => {
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await ruf('DELETE', { 'sec-fetch-site': 'cross-site' }), 403);
  });
  await t.test('a neighboring subdomain', async () => {
    assert.equal(await ruf('PUT', { 'sec-fetch-site': 'same-site' }), 403);
  });
  await t.test('the own site', async () => {
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'none' }), 200, 'vom Nutzer selbst eingegeben');
  });
  await t.test('without header and without session: app, scripts', async () => {
    assert.equal(await ruf('POST'), 200);
    assert.equal(await ruf('POST', { authorization: 'Bearer abc' }), 200);
  });
  const eigen = () => `http://127.0.0.1:${srv.address().port}`;
  const SESSION = { cookie: '__Host-bim.sid=s%3Aabc' };
  await t.test('a cookie session without any origin information', async () => {
    assert.equal(await ruf('POST', SESSION), 403);
    assert.equal(await ruf('DELETE', SESSION), 403);
    assert.equal(await ruf('GET', SESSION), 200, 'lesend bleibt erlaubt');
  });
  await t.test('an old browser without Sec-Fetch-Site, from a foreign site', async () => {
    assert.equal(await ruf('POST', { ...SESSION, origin: 'https://boese.example' }), 403);
    assert.equal(await ruf('POST', { ...SESSION, origin: 'null' }), 403, 'Origin „null" (Sandbox, Datei)');
    assert.equal(await ruf('POST', { ...SESSION, referer: 'https://boese.example/seite' }), 403);
    assert.equal(await ruf('POST', { origin: 'https://boese.example' }), 403, 'auch ohne Sitzung (Anmelde-CSRF)');
  });
  await t.test('a host that only starts like the own one', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await ruf('POST', { ...SESSION, origin: 'https://lego.example.org.boese.example' }), 403);
      assert.equal(await ruf('POST', { ...SESSION, referer: 'https://lego.example.org.boese.example/' }), 403);
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });
  await t.test('an old browser from the own site', async () => {
    assert.equal(await ruf('POST', { ...SESSION, origin: eigen() }), 200);
    assert.equal(await ruf('POST', { ...SESSION, referer: `${eigen()}/#/sets` }), 200);
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await ruf('POST', { ...SESSION, origin: 'https://lego.example.org' }), 200, 'APP_BASE_URL');
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });
  await t.test('reading and with token', async () => {
    assert.equal(await ruf('GET', { 'sec-fetch-site': 'cross-site' }), 200);
    assert.equal(await ruf('POST', { 'sec-fetch-site': 'cross-site', authorization: 'Bearer abc' }), 200);
  });
  await t.test('a bearer header next to the session cookie switches nothing off', async () => {
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

test('without APP_BASE_URL the host filter accepts no name, only loopback and IP addresses', async t => {
  environment({ APP_BASE_URL: undefined });
  const app = express();
  app.use(onlyOwnHost);
  app.all('/{*pfad}', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(r => srv.close(r)));
  await new Promise(r => srv.once('listening', r));
  const withHost = (host, pfad = '/api/v1/auth/me') =>
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
  const fremd = await withHost('boese.example');
  assert.equal(fremd.status, 421);
  assert.equal(JSON.parse(fremd.text).code, 'fremder_host');
  assert.match(JSON.parse(fremd.text).error, /127\.0\.0\.1/, 'die Absage nennt die eigene Adresse');
  assert.equal((await withHost('nas.local:3000')).status, 421);
  for (const h of ['localhost:3000', '127.0.0.1', '192.168.1.20:3000', '[fe80::1]:8080'])
    assert.equal((await withHost(h)).status, 200, h);
  assert.equal((await withHost('boese.example', '/api/v1/health')).status, 200, 'Gesundheit bleibt frei');
});
