/**
 * Ein Konto ohne Verwalterrecht verbraucht höchstens ein Viertel des
 * Tageskontingents eines Dienstes; Verwalter und Hintergrundjobs zählen nur
 * gegen das Gesamtkontingent. Ein abgewiesener Aufruf zählt auch gesamt nicht.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  die Zählung je Konto in checkAndIncrementRateLimit entfernt → rot:
 *      „ein Konto bekommt ein Viertel …“
 *   B  bei voller Kontogrenze nicht zurückgerollt (return statt throw) → rot:
 *      „… und der abgewiesene Aufruf zählt gesamt nicht“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const k = _req('utils/apiKontingent.js');
const { imNamenVon } = _req('utils/anfrageKonto.js');

test('Tageskontingent je Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const vorher = await db.get("SELECT value FROM global_settings WHERE key = 'api_limit_brickset'");
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('api_limit_brickset', '8')
                ON CONFLICT (key) DO UPDATE SET value = '8'`);
  await k.setzeKontingentZurueck('brickset');
  t.after(async () => {
    await k.setzeKontingentZurueck('brickset');
    if (vorher) await db.run("UPDATE global_settings SET value = $1 WHERE key = 'api_limit_brickset'", [vorher.value]);
    else await db.run("DELETE FROM global_settings WHERE key = 'api_limit_brickset'");
    await db.pool.end().catch(() => {});
  });
  const kind = { apiUser: { user_id: 990101, is_admin: 0 } };
  const chef = { apiUser: { user_id: 990102, is_admin: 1 } };
  const zaehle = (req) => imNamenVon(req, () => k.checkAndIncrementRateLimit('brickset'));

  await t.test('ein Konto bekommt ein Viertel, und der abgewiesene Aufruf zählt gesamt nicht', async () => {
    assert.equal((await zaehle(kind)).allowed, true);
    assert.equal((await zaehle(kind)).allowed, true);
    const dritter = await zaehle(kind);
    assert.equal(dritter.allowed, false);
    assert.equal(dritter.jeKonto, true);
    assert.equal((await k.getRateLimitStatus('brickset')).count, 2);
    assert.equal((await imNamenVon(kind, () => k.kontingentFrei('brickset'))).allowed, false);
  });

  await t.test('Verwalter und Hintergrund zählen nur gesamt', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await zaehle(chef)).allowed, true, `Verwalter ${i + 1}`);
    assert.equal((await k.checkAndIncrementRateLimit('brickset')).allowed, true, 'Hintergrund');
    assert.equal((await k.checkAndIncrementRateLimit('brickset')).allowed, false, 'gesamt voll');
    assert.equal((await k.getRateLimitStatus('brickset')).count, 8);
  });
});
