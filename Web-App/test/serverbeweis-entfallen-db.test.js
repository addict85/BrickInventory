/**
 * Der Serverbeweis für Klartext-Verbindungen ist entfallen: Die Android-App
 * nimmt im Release nur noch HTTPS an. Der Pfad ist nicht mehr öffentlich (401
 * ohne Anmeldung) und existiert auch angemeldet nicht (404).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  `serverbeweis` zurück in die öffentlichen Pfade von anmeldungAmEingang
 *      → rot: „ohne Anmeldung 401" (404 statt 401)
 *   B  eine Route POST /serverbeweis (Antwort 400 wie die alte bei falscher
 *      Eingabe) wieder in routes/auth.ts → rot: „angemeldet 404"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('POST /api/v1/auth/serverbeweis gibt es nicht mehr', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  t.after(() => db.pool.end().catch(() => {}));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = req.get('x-probe-angemeldet') ? { userId: 1 } : {}; next(); });
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const frage = (kopf = {}) => fetch(`http://127.0.0.1:${srv.address().port}/api/v1/auth/serverbeweis`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
    body: JSON.stringify({ kennung: '0123456789abcdef', nonce: 'ab'.repeat(16) }) }).then(r => r.status);

  await t.test('ohne Anmeldung 401', async () => assert.equal(await frage(), 401));
  await t.test('angemeldet 404', async () => assert.equal(await frage({ 'x-probe-angemeldet': '1' }), 404));
});
