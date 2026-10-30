/**
 * Die Drossel je Adresse (ipThrottle) hält auch gleichzeitigen Anfragen stand.
 *
 * Vorher las sie den Zähler und zählte erst danach hoch: 25 parallele
 * /register kamen alle durch, erlaubt sind 5 je Stunde.
 *
 * ── Gegenprobe (durchgeführt, Befund GEMESSEN) ──────────────────────────────
 *
 *   ipThrottle wieder mit _read + _bump (alte Fassung), viermal laufen lassen
 *   → 1 jedes Mal rot (6 bis 9 von 25 durchgelassen, in Runde 1 oder 2);
 *     2 viermal rot (6 bis 10 Antworten mit 200). Ein einzelner Schub traf
 *     das Rennen nicht immer, deshalb fährt Fall 1 fünf Runden.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const { ipThrottle } = _req('utils/loginLimiter.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test.after(() => db.pool.end().catch(() => {}));

async function dbDa(t) {
  try { await db.initSchema(); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
}

function starte(t, einhaengen) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = {}; next(); });
  einhaengen(app);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  return `http://localhost:${srv.address().port}`;
}

const parallel = (n, f) => Promise.all(Array.from({ length: n }, f));

test('1. 25 gleichzeitige Anfragen: genau 5 kommen durch, in jeder Runde', async (t) => {
  if (!await dbDa(t)) return;
  // Mehrere Runden: Das Rennen der alten Fassung trat nicht in jedem Schub auf.
  for (let runde = 1; runde <= 5; runde++) {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'parallel-probe|%'`);
    let durch = 0;
    const base = starte(t, app => app.post('/probe', ipThrottle('parallel-probe', 5, 60 * 60 * 1000),
      (_req, res) => { durch++; res.json({ ok: true }); }));
    const status = await parallel(25, () => fetch(`${base}/probe`, { method: 'POST' }).then(r => r.status));
    assert.equal(durch, 5, `Runde ${runde}: ${durch} von 25 durchgelassen, erlaubt sind 5`);
    assert.equal(status.filter(s => s === 429).length, 20);
  }
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'parallel-probe|%'`);
});

test('2. dasselbe an der echten Route /forgot-password', async (t) => {
  if (!await dbDa(t)) return;
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`);
  t.after(() => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`));
  const base = starte(t, app => app.use(AUTH, _req('routes/auth.js')));
  const status = await parallel(25, () => fetch(`${base}${AUTH}/forgot-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'niemand.parallel@example.ch' }),
  }).then(r => r.status));
  assert.equal(status.filter(s => s === 200).length, 5, `Antworten: ${status.join(',')}`);
  assert.equal(status.filter(s => s === 429).length, 20);
});
