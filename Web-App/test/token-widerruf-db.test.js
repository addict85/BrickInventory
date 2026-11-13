/**
 * Ein Token-Widerruf wirkt sofort im Token-Cache des Web-Prozesses, nicht
 * erst nach dessen Frist (5 s). Der Cache gilt nur, solange die Horch-
 * Verbindung für fremde Widerrufe steht; fällt sie aus, fragt jede Prüfung
 * die Datenbank (fail closed).
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in leereTokenCache() `_tokenCache.clear()` entfernt → rot: „die
 *      Token-Verwaltung leert den Cache“ und „ein Passwortwechsel …“
 *   B  in invalidateToken() `_tokenCache.delete(token)` entfernt → rot:
 *      „Abmelden wirkt sofort“
 *   C  (08.11.) TOKEN_TTL_MS wieder 60 s → rot: „ohne Benachrichtigung gilt
 *      ein widerrufener Token höchstens die Cache-Frist“ (Token gilt nach 6 s noch)
 *   D  (09.11.) in cacheNutzbar() (src/konto/tokenCache.ts) nur `return true` → rot:
 *      „ohne Horch-Verbindung gilt der Cache nicht“ (Token gilt nach dem Abriss weiter)
 *   E  (09.11.) in pgNotify.retire() `_lauscht.clear()` entfernt → rot: dieselbe Stelle
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const auth = _req('src/konto/geraeteToken.js');
const tokenCache = _req('src/konto/tokenCache.js');
const pgNotify = _req('db/database.js').standardDb().benachrichtigung;
const { bis } = require('./helpers/zeit');

test('Token-Widerruf wirkt sofort', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const name = `tw_${process.pid}`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
      [name],
    )
  ).id;
  t.after(async () => {
    await pgNotify.close();
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  tokenCache.horcheAufTokenWiderruf();
  assert.ok(await bis(() => pgNotify.hoertZu('token_widerrufen')), 'die Horch-Verbindung kam nicht zustande');
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
    tokenCache.invalidateToken(token);
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('die Token-Verwaltung leert den Cache', async () => {
    const token = await imCacheOhneZeile();
    tokenCache.leereTokenCache();
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('ein Passwortwechsel widerruft auch zwischengespeicherte Tokens', async () => {
    const token = await auth.createToken(uid, 'Test');
    assert.ok(await auth.validateToken(token));
    await auth.revokeAllTokens(uid);
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('ohne Benachrichtigung gilt ein widerrufener Token höchstens die Cache-Frist', async t2 => {
    assert.ok(tokenCache.TOKEN_TTL_MS < 10_000, 'die Frist ist unter 10 s');
    const token = await imCacheOhneZeile();
    t2.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t2.mock.timers.tick(tokenCache.TOKEN_TTL_MS + 1000);
    assert.equal(await auth.validateToken(token), null);
  });

  await t.test('ohne Horch-Verbindung gilt der Cache nicht', async () => {
    const token = await imCacheOhneZeile();
    // Die Verbindung reisst ab, wie bei einem Neustart der Datenbank; bis zum
    // Wiederverbinden (1 s) käme ein Widerruf aus einem anderen Prozess nicht an.
    await db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE 'LISTEN "token_widerrufen"%'`);
    assert.ok(await bis(() => !pgNotify.hoertZu('token_widerrufen'), 2000), 'der Abriss kam nicht an');
    assert.equal(await auth.validateToken(token), null);
    assert.ok(await bis(() => pgNotify.hoertZu('token_widerrufen'), 5000), 'die Verbindung kam nicht wieder');
  });
});
