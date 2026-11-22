/**
 * Observability: the metrics of a process in the Prometheus text format (src/infra/metrics.ts) —
 * HTTP by route pattern and status, job runs and queue, connection pools, external calls — the
 * /metrics endpoint with its access rule, the port of the jobs-only process, and the request
 * identifier in error responses.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  routePattern() returns the raw path → red: “HTTP responses are counted by route pattern …”
 *   B  metricsAllowed() without the X-Forwarded-For condition → red: “without a token only …”
 *   C  in measured() (src/infra/fetch.ts) every host taken as label → red: “external calls …”
 *   D  in runJobFrom() the counting removed → red: “a job run is counted …”
 *   E  escapeLabel() returns the value unchanged → red: “label values are escaped”
 *   F  withRequestId() returns the body unchanged → red: “an error response names the request …”
 *   G  registerCollectors() without the queue → red: “pools and the queue are read …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer, portOf } = require('./helpers/server');
const { httpsStub, reply } = require('./helpers/https-stub');

const M = _req('src/infra/metrics.js');
const { metricsEndpoint } = _req('src/http/metrics.js');
const { registerCollectors, startMetricsServer } = _req('startup/metrics.js');
const { holeHttps } = _req('src/infra/fetch.js');

/** The value of one series, or undefined. */
function value(text, name, labels) {
  const want = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  for (const line of text.split('\n')) {
    const m = /^(\w+)(?:\{(.*)\})? (\S+)$/.exec(line);
    if (m?.[1] !== name) continue;
    const have = (m[2] ?? '').split(/,(?=\w+=")/).filter(Boolean);
    if (want.every(w => have.includes(w)) && have.length === want.length) return Number(m[3]);
  }
  return undefined;
}

test('metrics', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('HTTP responses are counted by route pattern and status, not by path', async st => {
    M.resetMetrics();
    const { base } = testServer(_req, { t: st });
    assert.equal((await fetch(`${base}/api/v1/sets/10294-1`)).status, 401);
    await fetch(`${base}/api/v1/sets/10295-1`);
    const text = await (await fetch(`${base}/metrics`)).text();
    assert.equal(
      value(text, 'http_requests_total', { method: 'GET', route: '/api/v1/sets/:setNumber', status: 401 }),
      2,
    );
    assert.equal(
      value(text, 'http_request_duration_seconds_count', { method: 'GET', route: '/api/v1/sets/:setNumber' }),
      2,
    );
    assert.doesNotMatch(text, /10294-1/, 'ein roher Pfad als Bezeichnung liesse die Reihen unbegrenzt wachsen');
    assert.match(text, /^# TYPE http_request_duration_seconds histogram$/m);
  });

  await t.test('without a token only a loopback client without proxy; with one only the token', async st => {
    const { base } = testServer(_req, { t: st });
    assert.equal((await fetch(`${base}/metrics`)).status, 200);
    const proxied = await fetch(`${base}/metrics`, { headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert.equal(proxied.status, 404, 'über Caddy (X-Forwarded-For) bleibt /metrics zu');
    const app = express();
    app.use(metricsEndpoint('geheimes-token'));
    const srv = app.listen(0);
    st.after(() => new Promise(r => srv.close(r)));
    const url = `http://127.0.0.1:${portOf(srv)}/metrics`;
    assert.equal((await fetch(url)).status, 404, 'mit Token reicht Loopback nicht');
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer falsch' } })).status, 404);
    const ok = await fetch(url, { headers: { authorization: 'Bearer geheimes-token' } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/);
  });

  await t.test('pools and the queue are read at the scrape', async st => {
    const services = q.testServices();
    const off = registerCollectors(q.testAccess(), services.jobQueue);
    st.after(off);
    await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);
    await db.run(
      `INSERT INTO jobs (type, payload) VALUES ('brickset', '{"set_number":"10179-1"}'), ('brickset', '{"set_number":"10180-1"}')`,
    );
    const text = await M.renderMetrics();
    assert.ok(value(text, 'db_pool_connections', { pool: 'app', state: 'total' }) >= 0, text);
    const queued = text.split('\n').filter(z => z.startsWith('jobs_queue{type="brickset"'));
    assert.deepEqual(
      queued.map(z => z.replace(/status="[^"]+"/, 'status="…"')),
      ['jobs_queue{type="brickset",status="…"} 2'],
    );
    await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);
    assert.ok(!(await M.renderMetrics()).includes('jobs_queue{type="brickset"'), 'eine leere Art bleibt nicht stehen');
  });

  await t.test('a job run is counted with kind, result and duration', async () => {
    M.resetMetrics();
    const { createWorker } = _req('jobs/jobWorker.js');
    await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);
    await db.run(`INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', '{"set_number":"10179-1"}', 1)`);
    await db.run(`INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', '{"set_number":"10180-1"}', 1)`);
    const w = createWorker(
      q.testServices().jobQueue,
      {
        brickset: {
          ausfuehren: async n => {
            if (n.set_number === '10180-1') throw new Error('Brickset weg');
          },
        },
      },
      { deadlineSec: 60 },
    );
    assert.equal(await w.processOne(), true);
    assert.equal(await w.processOne(), true);
    const text = await M.renderMetrics();
    assert.equal(value(text, 'jobs_runs_total', { type: 'brickset', result: 'ok' }), 1);
    assert.equal(value(text, 'jobs_runs_total', { type: 'brickset', result: 'error' }), 1);
    assert.equal(value(text, 'job_duration_seconds_count', { type: 'brickset', result: 'ok' }), 1);
    await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);
  });

  await t.test('external calls by host and outcome; a foreign host is no label', async st => {
    M.resetMetrics();
    await httpsStub(st, (_c, res) => reply(res, 503, 'weg'));
    const o = { hosts: ['rebrickable.com'], maxBytes: 1000, zeitlimitMs: 5000 };
    assert.equal((await holeHttps('https://rebrickable.com/api/v3/lego/sets/', o)).status, 503);
    await assert.rejects(holeHttps('https://angreifer-123.example.org/x', o), /nicht erlaubt/);
    const text = await M.renderMetrics();
    assert.equal(value(text, 'external_requests_total', { host: 'rebrickable.com', outcome: '5xx' }), 1);
    assert.equal(value(text, 'external_requests_total', { host: 'other', outcome: 'adresse' }), 1);
    assert.equal(value(text, 'external_request_duration_seconds_count', { host: 'rebrickable.com' }), 1);
    assert.doesNotMatch(text, /angreifer/);
  });

  await t.test('the jobs-only process serves /metrics alone on its port', async st => {
    const srv = startMetricsServer(0, 'job-token');
    st.after(() => new Promise(r => srv.close(r)));
    await new Promise(r => (srv.listening ? r(undefined) : srv.once('listening', r)));
    const base = `http://127.0.0.1:${portOf(srv)}`;
    assert.equal((await fetch(`${base}/metrics`)).status, 404);
    assert.equal((await fetch(`${base}/anderes`, { headers: { authorization: 'Bearer job-token' } })).status, 404);
    const ok = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer job-token' } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /^# TYPE /m);
  });

  await t.test('label values are escaped', async () => {
    M.resetMetrics();
    M.counter('probe_total', 'Probe.').inc({ wert: 'a"b\\c\nd' });
    assert.match(await M.renderMetrics(), /^probe_total\{wert="a\\"b\\\\c\\nd"\} 1$/m);
  });

  await t.test('an error response names the request, taken over from X-Request-Id', async st => {
    const { base } = testServer(_req, { t: st });
    // Without login: the entrance answers 401 through the common error path.
    const r = await fetch(`${base}/api/v1/sets`, { headers: { 'X-Request-Id': 'abc-123' } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('x-request-id'), 'abc-123');
    assert.equal((await r.json()).request_id, 'abc-123');
    const eigen = await fetch(`${base}/api/gibt-es-nicht`, { headers: { 'X-Request-Id': 'zwei zeilen' } });
    assert.equal(eigen.status, 404);
    const rid = eigen.headers.get('x-request-id');
    assert.match(rid ?? '', /^[0-9a-z]{4}$/, 'eine Kennung mit Leerzeichen wird ersetzt');
    assert.equal((await eigen.json()).request_id, rid);
  });
});
