/**
 * Eine fremde Erfassung zu löschen gibt 404 und ändert nichts — für Teile und
 * Figuren wie für Sets. Vorher antworteten Teile und Figuren mit Erfolg, ohne
 * etwas zu tun, und der Aufrufer konnte das nicht unterscheiden.
 *
 * Gegenprobe (am 28.10.2026 gemessen): in der DELETE-Route die 404-Zeile
 * entfernt → rot: beide Teilschritte (200 statt 404).
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

const A = `fremd_a_${process.pid}`, B = `fremd_b_${process.pid}`;

test('fremde Erfassungen löschen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[A, B]]);
  const neu = async (n) => (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  const a = await neu(A), b = await neu(B);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    await db.pool.end().catch(() => {});
  });
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001', 4, 'manual')`, [b]);
  const teil = (await db.get(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition)
    VALUES ($1, '3001', 4, 2, 'N') RETURNING id`, [b])).id;
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'sw0001', 'manual')`, [b]);
  const figur = (await db.get(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, condition)
    VALUES ($1, 'sw0001', 1, 'N') RETURNING id`, [b])).id;

  const { base } = testServer(_req, { sitzung: { userId: a }, apiNutzer: { user_id: a, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const loesche = (pfad) => fetch(base + pfad, { method: 'DELETE' }).then(r => r.status);

  await t.test('Teil', async () => {
    assert.equal(await loesche(`/api/v1/parts/3001/4/acquisitions/${teil}`), 404);
    assert.ok(await db.get('SELECT 1 FROM part_acquisitions WHERE id = $1', [teil]), 'die fremde Zeile ist weg');
  });
  await t.test('Figur', async () => {
    assert.equal(await loesche(`/api/v1/minifigs/sw0001/acquisitions/${figur}`), 404);
    assert.ok(await db.get('SELECT 1 FROM minifig_acquisitions WHERE id = $1', [figur]), 'die fremde Zeile ist weg');
  });
});
