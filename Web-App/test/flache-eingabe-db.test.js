/**
 * Jede schreibende Route prüft den Typ ihrer Eingabe: mit eigenem Schema aus
 * dem Vertrag, sonst mit FLACHE_EINGABE (nur einfache Werte und Listen davon).
 * Ein Objekt statt eines Textes ({"$ne":1}) ist 400, bevor die Route läuft.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in eingabePruefen() ohne Rückfall auf FLACHE_EINGABE (Routen ohne
 *      Schema laufen durch) → rot: beide Tests
 *   B  FLACHE_EINGABE als z.record(z.string(), z.unknown()) → rot: beide Tests
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { VERTRAG } = _req('src/infra/vertrag/index.js');

test('verschachtelte Werte an schreibenden Routen', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const NAME = `flach_${process.pid}`;
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`, [NAME])).id;
  t.after(async () => { await db.run('DELETE FROM users WHERE id = $1', [uid]); await db.pool.end().catch(() => {}); });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: true },
    apiNutzer: { user_id: uid, is_admin: 1, username: NAME },
    routen: { '/api/v1/auth': 'routes/auth.js', '/api/v1': 'routes/api_v1/index.js' }, t });
  const sende = async (methode, pfad, rumpf) => {
    const r = await fetch(base + pfad, { method: methode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rumpf) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j.code ?? null };
  };

  await t.test('ein Objekt statt eines Lagerortnamens wird nicht gespeichert', async () => {
    assert.deepEqual(await sende('POST', '/api/v1/storage/locations', { name: { $ne: 1 } }), { status: 400, code: 'eingabe_ungueltig' });
    assert.equal((await db.get('SELECT count(*)::int AS n FROM storage_locations WHERE user_id = $1', [uid])).n, 0);
    assert.equal((await sende('POST', '/api/v1/storage/locations', { name: 'Kiste 1' })).status, 200, 'Testdaten: ein Text geht');
  });

  await t.test('jede schreibende Route ohne eigenes Schema weist ein Objekt ab', async () => {
    const ohneSchema = Object.entries(VERTRAG).filter(([k, r]) => !k.startsWith('GET ') && !r.eingabe && !r.formular);
    assert.ok(ohneSchema.length >= 50, `nur ${ohneSchema.length} Routen ohne Schema`);
    const durch = [];
    for (const [k] of ohneSchema) {
      const [methode, pfad] = k.split(' ');
      const r = await sende(methode, pfad.replace(/:\w+/g, '1'), { feld: { $ne: 1 } });
      if (r.status !== 400 || r.code !== 'eingabe_ungueltig') durch.push(`${k} → ${r.status} ${r.code}`);
    }
    assert.deepEqual(durch, []);
  });
});
