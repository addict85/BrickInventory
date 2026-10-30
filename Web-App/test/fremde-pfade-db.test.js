/**
 * Eine Setnummer aus der Anfrage bleibt in der Adresse bei Rebrickable genau
 * EIN Pfadsegment. Roh eingesetzt führte `x/../../users` mit dem API-Schlüssel
 * des Servers an eine andere Stelle der API, `?…` hängte eigene Parameter an.
 *
 * Geprüft über GET /sets/:setNumber/parts-list mit abgefangenem https.get.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in getAllSetPartsApi() wieder `${n}` statt `${pfadSegment(n)}` → rot:
 *      „verlässt das Pfadsegment“
 *   B  pfadSegment() ohne die Prüfung auf Punktsegmente → rot: „„..“ geht durch“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const https  = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('pfadSegment', () => {
  const { pfadSegment, nummernListe } = _req('utils/fremdeAdressen.js');
  assert.equal(pfadSegment('10294-1'), '10294-1');
  assert.equal(pfadSegment('x/../y?z'), 'x%2F..%2Fy%3Fz');
  for (const p of ['', '.', '..', '...']) assert.throws(() => pfadSegment(p), /Pfadsegment/, `„${p}“ geht durch`);
  assert.equal(nummernListe(['3001', 'a&b=c', '3,4']), '3001,a%26b%3Dc,3%2C4');
});

test('Setnummer aus der Anfrage bleibt ein Pfadsegment', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const S = _req('utils/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await S.setGlobalSetting('rebrickable_api_key', 'testschluessel-pfade');
  const echt = https.get;
  const abgerufen = [];
  https.get = (url, opt, cb) => {
    // httpsGetRobust ruft mit Optionen statt Adresse.
    abgerufen.push(typeof url === 'string' ? url : `https://${url.hostname}${url.path}`);
    const fertig = typeof opt === 'function' ? opt : cb;
    const req = new EventEmitter();
    req.setTimeout = () => req; req.destroy = () => {}; req.end = () => {};
    setImmediate(() => {
      const r = new EventEmitter(); r.statusCode = 404; r.headers = {}; r.resume = () => {};
      r.setEncoding = () => {};
      fertig(r); setImmediate(() => r.emit('end'));
    });
    return req;
  };
  t.after(async () => {
    https.get = echt;
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
    else await S.deleteGlobalSetting('rebrickable_api_key');
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: 1 }, apiNutzer: { user_id: 1, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  let geprueft = 0;
  for (const roh of ['x%2F..%2F..%2Fusers', '10294-1%3Fsearch%3Dboese', '%2E%2E%2Fcolors']) {
    abgerufen.length = 0;
    await fetch(`${base}/api/v1/sets/${roh}/parts-list`);
    const api = abgerufen.filter(u => u.includes('/api/v3/'));
    for (const u of api) {
      geprueft++;
      const p = new URL(u);
      assert.match(p.pathname, /^\/api\/v3\/lego\/sets\/[^/]+\/parts\/$/, `${roh}: ${u} verlässt das Pfadsegment`);
      assert.deepEqual([...p.searchParams.keys()].sort(), ['inc_part_details', 'page_size'], `${roh}: ${u}`);
    }
  }
  assert.ok(geprueft >= 2, `nur ${geprueft} Abrufe gesehen — dann prüft die Schleife nichts`);
});
