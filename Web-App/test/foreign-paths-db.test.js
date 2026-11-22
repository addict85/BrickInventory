/**
 * A set number from the request stays exactly ONE path segment in the address at
 * Rebrickable. Inserted raw, `x/../../users` led with the server's API key
 * to another place of the API, `?…` appended own parameters.
 *
 * Checked twice: GET /sets/:setNumber/parts-list rejects such numbers at the
 * entrance (contract: PATH), and behind it fetchSetParts() builds the address with
 * intercepted https.get.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in getAllSetPartsApi() again `${n}` instead of `${pathSegment(n)}` → red:
 *      “leaves the path segment”
 *   B  pathSegment() without the check for dot segments → red: ““..” gets through”
 *   C  (05.11.2026) setNumber in PATH without pattern (TEXT) → red: “gets through at the
 *      entrance”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const db = testData();

test('pathSegment', () => {
  const { pathSegment, numbersList } = _req('src/infra/foreignAddresses.js');
  assert.equal(pathSegment('10294-1'), '10294-1');
  assert.equal(pathSegment('x/../y?z'), 'x%2F..%2Fy%3Fz');
  for (const p of ['', '.', '..', '...']) assert.throws(() => pathSegment(p), /Pfadsegment/, `„${p}“ geht durch`);
  assert.equal(numbersList(['3001', 'a&b=c', '3,4']), '3001,a%26b%3Dc,3%2C4');
});

test('the set number from the request stays a path segment', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const S = _req('src/settings/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await S.setGlobalSetting('rebrickable_api_key', 'testschluessel-pfade');
  const echt = https.get;
  const abgerufen = [];
  /** @type {any} */ (https).get = (url, opt, cb) => {
    // httpsGetRobust calls with options instead of an address.
    abgerufen.push(typeof url === 'string' ? url : `https://${url.hostname}${url.path}`);
    const fertig = typeof opt === 'function' ? opt : cb;
    const req = /** @type {any} */ (new EventEmitter());
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => {};
    setImmediate(() => {
      const r = /** @type {any} */ (new EventEmitter());
      r.statusCode = 404;
      r.headers = {};
      r.resume = () => {};
      r.setEncoding = () => {};
      fertig(r);
      setImmediate(() => r.emit('end'));
    });
    return req;
  };
  t.after(async () => {
    https.get = echt;
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
    else await S.deleteGlobalValues('rebrickable_api_key');
    await db.pool.end().catch(() => {});
  });

  const { base } = routerServer(_req, {
    sitzung: { userId: 1 },
    apiNutzer: { user_id: 1, is_admin: 0 },
    routen: { '/api/v2': 'routes/api_v1/index.js' },
    t,
  });
  let geprueft = 0;
  const { fetchSetParts } = require('./helpers/sources').testServices().externalSources.sources;
  for (const roh of ['x%2F..%2F..%2Fusers', '10294-1%3Fsearch%3Dboese', '%2E%2E%2Fcolors']) {
    const r = await fetch(`${base}/api/v2/sets/${roh}/parts-list`);
    assert.equal(r.status, 400, `${roh}: kommt am Eingang durch`);
    abgerufen.length = 0;
    await fetchSetParts(decodeURIComponent(roh));
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
