/**
 * Ein Token-Widerruf wirkt sofort im Token-Cache des Web-Prozesses, nicht
 * erst nach dessen Frist (5 s). Den Cache hält nur der Web-Prozess, und nur
 * er widerruft; der Job-Prozess löscht abgelaufene Tokens, die der Cache
 * ohnehin an ihrer Frist abweist. Ein NOTIFY zwischen Prozessen braucht es
 * deshalb nicht mehr.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in leereTokenCache() `_tokenCache.clear()` entfernt → rot: „die
 *      Token-Verwaltung leert den Cache“ und „ein Passwortwechsel …“
 *   B  in invalidateToken() `_tokenCache.delete(token)` entfernt → rot:
 *      „Abmelden wirkt sofort“
 *   C  (08.11.) TOKEN_TTL_MS wieder 60 s → rot: „ohne Benachrichtigung gilt
 *      ein widerrufener Token höchstens die Cache-Frist“ (Token gilt nach 6 s noch)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');
const auth = _req('src/konto/auth.js');

test('Token-Widerruf wirkt sofort', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const name = `tw_${process.pid}`;
  const uid = (await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name])).id;
  t.after(async () => {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  /** Ein Token, der im Cache steht; danach ist seine Zeile still gelöscht. */
  const imCacheOhneZeile = async () => {
    const token = await auth.createToken(uid, 'Test');
    assert.ok(await auth.validateToken(token), 'Vorbedingung: der Token gilt');
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    assert.ok(await auth.validateToken(token), 'Gegenprobe: der Cache bedient ihn noch');
    return token;
  };

  await t.test('Abmelden wirkt sofort', async () => {
    const token = await imCacheOhneZeile();
    auth.invalidateToken(token);
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('die Token-Verwaltung leert den Cache', async () => {
    const token = await imCacheOhneZeile();
    auth.leereTokenCache();
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('ein Passwortwechsel widerruft auch zwischengespeicherte Tokens', async () => {
    const token = await auth.createToken(uid, 'Test');
    assert.ok(await auth.validateToken(token));
    await auth.revokeAllTokens(uid);
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('ohne Benachrichtigung gilt ein widerrufener Token höchstens die Cache-Frist', async (t2) => {
    assert.ok(auth.TOKEN_TTL_MS < 10_000, 'die Frist ist unter 10 s');
    const token = await imCacheOhneZeile();
    t2.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t2.mock.timers.tick(auth.TOKEN_TTL_MS + 1000);
    assert.equal(await auth.validateToken(token), null);
  });
});
