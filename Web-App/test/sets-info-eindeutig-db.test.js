/**
 * Unter /api/v1/sets hängen zwei Router (routes/api_v1 und routes/sets.ts,
 * wie in server.ts). Der Namensabruf /sets/info/:setNumber stand im zweiten,
 * und eine Nummer, die wie ein Pfadwort der ersten aussieht, landete dort:
 * GET /api/v1/sets/info/price-history traf /sets/:setNumber/price-history mit
 * „info“ als Setnummer. Jetzt steht der Abruf im v1-Router vor allen Pfaden
 * mit Parameter.
 *
 * Gegenprobe (am 29.10.2026 gemessen): die Route /sets/info/:setNumber aus
 * routes/api_v1/sets.ts zurück an ihren alten Platz in routes/sets.ts → rot:
 * „ein Pfadwort als Setnummer“ (die Antwort kam vom Preisverlauf).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('der Namensabruf unter /api/v1/sets ist eindeutig', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const NAME = `setinfo-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const nummern = ['price-history-1', `${process.pid}-1`];
  await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ($1, 'Pfadwort'), ($2, 'Gewöhnlich')
                ON CONFLICT (set_number) DO UPDATE SET name = EXCLUDED.name`, nummern);
  // Dieselbe Reihenfolge wie server.ts: zuerst der v1-Router, dann routes/sets.ts.
  const { base } = testServer(_req, {
    sitzung: { userId: uid, username: NAME, isAdmin: false },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });

  try {
    await t.test('eine gewöhnliche Nummer', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/${process.pid}-1`)).json();
      assert.equal(r.name, 'Gewöhnlich');
    });
    await t.test('ein Pfadwort als Setnummer', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/price-history`)).json();
      assert.equal(r.set_number, 'price-history-1', JSON.stringify(r));
      assert.equal(r.name, 'Pfadwort');
    });
  } finally {
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
