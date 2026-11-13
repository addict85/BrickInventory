/**
 * Der Hinweis auf einen Proxy vor Caddy (alle Clients mit einer Adresse) steht
 * nicht nur im Protokoll: GET /api/v1/admin/jobs trägt ihn für Verwalter, und
 * die Hintergrundarbeiten zeigen ihn (proxy-hinweis-oberflaeche.test.js).
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   A  in einzigeClientAdresse() `merke(…)` gestrichen → rot: „nach dem
 *      Hinweis im Protokoll steht er in der Antwort“ (null)
 *   B  in routes/api_v1/admin.ts `proxy_hinweis` aus der Antwort gestrichen →
 *      rot: „ohne Hinweis: null“ und „nach dem Hinweis …“ (undefined)
 *   C  startup/app.ts legt den Hinweisgeber nicht in app.locals ab → rot: „die
 *      App legt ihren Hinweisgeber dort ab, …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { proxyHinweis, EINE_ADRESSE } = _req('src/http/proxyHinweis.js');

test('Proxy-Hinweis in der Antwort für Verwalter', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const NAME = `proxyhinweis-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (
    await db.get(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  // Wie startup/app.ts: Der Hinweisgeber liegt am App-Objekt, die Verwaltung liest ihn dort.
  let jetzt = 0;
  const meldungen = [];
  const mw = proxyHinweis(
    '172.28.73.10',
    m => meldungen.push(m),
    () => jetzt,
  );
  const { app, base } = testServer(_req, {
    sitzung: { userId: uid, isAdmin: 1 },
    apiNutzer: { user_id: uid, is_admin: 1 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  app.locals.proxyHinweis = mw;
  const jobs = async () => (await fetch(`${base}/api/v1/admin/jobs`)).json();

  await t.test('ohne Hinweis: null', async () => {
    const d = await jobs();
    assert.equal(d.success, true);
    assert.equal(d.proxy_hinweis, null);
  });

  await t.test('nach dem Hinweis im Protokoll steht er in der Antwort', async () => {
    // Eine Stunde lang nur die Adresse des Proxys davor, wie hinter Nginx Proxy Manager mit `keiner`.
    for (let i = 0; i <= EINE_ADRESSE.anfragen; i++) {
      jetzt = Math.round((i / EINE_ADRESSE.anfragen) * 61 * 60_000);
      const ip = '::ffff:172.28.73.20';
      mw({ ip, socket: { remoteAddress: '172.28.73.10' }, headers: { 'x-forwarded-for': ip } }, {}, () => {});
    }
    assert.equal(meldungen.length, 1, 'Hinweis im Protokoll');
    const h = (await jobs()).proxy_hinweis;
    assert.deepEqual([h?.art, h?.vars?.ip], ['eine_adresse', '172.28.73.20'], JSON.stringify(h));
    assert.ok(h.vars.minuten >= 60 && h.vars.anzahl >= EINE_ADRESSE.anfragen, JSON.stringify(h));
  });

  await t.test('die App legt ihren Hinweisgeber dort ab, wo die Verwaltung liest', () => {
    const echt = _req('startup/app.js').baueApp({
      pool: db.pool,
      konfig: _req('src/infra/konfig.js').konfig(),
      sitzungsGeheimnis: 'p'.repeat(48),
      dienste: _req('src/infra/bereich.js').prozessDienste(),
    });
    const { proxyHinweisStand } = _req('src/http/proxyHinweis.js');
    assert.equal(proxyHinweisStand(echt), null);
    const leise = console.warn;
    console.warn = () => {};
    try {
      const req = { socket: { remoteAddress: '172.28.73.30' }, headers: { 'x-forwarded-for': '198.51.100.4' } };
      echt.locals.proxyHinweis(req, {}, () => {});
    } finally {
      console.warn = leise;
    }
    assert.deepEqual(proxyHinweisStand(echt), { art: 'docker_netz', vars: { ip: '172.28.73.30' } });
  });
});
