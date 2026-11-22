/**
 * /api/v1 stays the old API on top of v2 (src/http/apiV1Alias.ts, src/contract/v1.ts): for a
 * selection of routes with data, v1 answers exactly in the v1 contract (docs/openapi.json, German
 * fields, values and codes) and v2 in the English one; v1 requests with German names, query
 * values and path parameters reach the v2 route; only v1 carries Deprecation and Sunset.
 *
 * Counter-checks (22.11.2026):
 *   A  in apiV1Alias the res.json wrapper removed → red: “v1 answers in the v1 contract”
 *      (auftraege missing, jobs present)
 *   B  v1Keys(JobProgress, …) in src/contract/management.ts removed → red: the same test
 *      (progress.done instead of progress.erledigt)
 *   C  in v2PathOf the translation of path parameters removed → red: “path parameter and
 *      query values …” (400 for art/preise)
 *   D  in errorToV1 the code mapping removed → red: “errors keep their v1 code”
 *   E  the Deprecation header removed → red: “only v1 is deprecated”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { routeFor } = _req('src/contract/index.js');
const { toV1Schema } = _req('src/contract/v1.js');
const { unknownFields } = _req('src/contract/unknownFields.js');
const db = testData();

/** The body fits the schema and carries no field outside it. */
function fits(schema, body, label) {
  const r = schema.safeParse(body);
  assert.ok(r.success, `${label}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`);
  assert.deepEqual(unknownFields(schema, body), [], `${label}: Felder ausserhalb des Vertrags`);
}

test('API v1 as alias of v2', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const NAME = `v1alias_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',true,true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run('DELETE FROM jobs');
  await db.run(
    `INSERT INTO jobs (type, payload, status, progress, error_message)
     VALUES ('prices', '{}', 'pending', '{"done": 1, "total": 3, "text": "x"}', 'Quelle weg')`,
  );
  t.after(async () => {
    await db.run('DELETE FROM jobs');
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: true }, t });
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };

  await t.test('v1 answers in the v1 contract, v2 in the English one', async () => {
    const SAMPLE = [
      ['GET /api/v2/admin/job-queue', '/api/v1/admin/auftraege', '/api/v2/admin/job-queue'],
      ['GET /api/v2/setup/state', '/api/v1/einrichtung/stand', '/api/v2/setup/state'],
      ['GET /api/v2/trash', '/api/v1/papierkorb', '/api/v2/trash'],
    ];
    for (const [key, v1, v2] of SAMPLE) {
      const schema = routeFor(key).response;
      const a = await call('GET', v1);
      const b = await call('GET', v2);
      assert.equal(a.status, 200, `${v1}: ${JSON.stringify(a.body)}`);
      assert.equal(b.status, 200, `${v2}: ${JSON.stringify(b.body)}`);
      fits(toV1Schema(schema), a.body, v1);
      fits(schema, b.body, v2);
    }
    const v1 = (await call('GET', '/api/v1/admin/auftraege')).body;
    const v2 = (await call('GET', '/api/v2/admin/job-queue')).body;
    assert.deepEqual(
      [
        v1.auftraege[0].type,
        v1.auftraege[0].status,
        v1.auftraege[0].progress.erledigt,
        v1.auftraege[0].progress.gesamt,
      ],
      ['preise', 'offen', 1, 3],
    );
    assert.deepEqual(
      [v2.jobs[0].type, v2.jobs[0].status, v2.jobs[0].progress.done, v2.jobs[0].progress.total],
      ['prices', 'pending', 1, 3],
    );
    assert.deepEqual(v1.zusammenfassung[0], { type: 'preise', status: 'offen', anzahl: 1 });
    assert.equal(v1.job_prozess.laeuft, v2.job_process.running);
    const setup = (await call('GET', '/api/v1/einrichtung/stand')).body;
    assert.ok(
      setup.schritte.some(s => s.id === 'datenbank'),
      JSON.stringify(setup.schritte),
    );
    assert.ok((await call('GET', '/api/v2/setup/state')).body.steps.some(s => s.id === 'database'));
  });

  await t.test('path parameter and query values arrive translated', async () => {
    const filtered = (await call('GET', '/api/v1/admin/auftraege?status=offen,laeuft&art=preise')).body;
    assert.equal(filtered.auftraege.length, 1, JSON.stringify(filtered));
    const now = await call('POST', '/api/v1/admin/auftraege/art/preise/jetzt', {});
    assert.equal(now.status, 200, JSON.stringify(now.body));
    assert.equal(now.body.art, 'preise');
    assert.equal(typeof now.body.gestartet, 'boolean');
  });

  await t.test('v1 requests use v1 field names; errors keep their v1 code', async () => {
    const v1 = await call('POST', '/api/v1/settings/quelle-testen', { quelle: 'gibtsnicht' });
    const v2 = await call('POST', '/api/v2/settings/test-source', { source: 'gibtsnicht' });
    assert.equal(v1.status, v2.status);
    assert.equal(v1.body.code, 'quelle_unbekannt', JSON.stringify(v1.body));
    assert.equal(v2.body.code, 'source_unknown', JSON.stringify(v2.body));
    // Unknown fields stay unknown: the alias renames only what the v1 contract names.
    const unknown = await call('POST', '/api/v1/settings/quelle-testen', { quelle: 'brickset', gibtsnicht: 1 });
    assert.equal(unknown.body.code, 'feld_unbekannt', JSON.stringify(unknown.body));
    assert.equal((await call('GET', '/api/v1/gibt-es-nicht')).body.code, 'nicht_gefunden');
    assert.equal((await call('GET', '/api/v2/gibt-es-nicht')).body.code, 'not_found');
  });

  await t.test('only v1 is deprecated', async () => {
    const a = await call('GET', '/api/v1/einrichtung/stand');
    const b = await call('GET', '/api/v2/setup/state');
    assert.equal(a.headers.get('deprecation'), 'true');
    assert.match(a.headers.get('sunset') ?? '', /^Wed, 30 Jun 2027 00:00:00 GMT$/);
    assert.equal(a.headers.get('link'), '</api/v2/setup/state>; rel="successor-version"');
    assert.equal(b.headers.get('deprecation'), null);
    assert.equal(b.headers.get('sunset'), null);
  });
});
