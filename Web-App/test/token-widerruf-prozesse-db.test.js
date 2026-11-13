/**
 * Jeder Web-Prozess hält seinen eigenen Token-Zwischenspeicher (60 s). Ein
 * Widerruf in einem Prozess meldet sich über NOTIFY, die anderen leeren ihren
 * Speicher sofort — ein widerrufener Token gilt dort nicht bis zu einer Minute weiter.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  in horcheAufTokenWiderruf() das pgNotify.listen() entfernt → rot: „ein
 *      Widerruf aus einem anderen Prozess gilt sofort“
 *   B  meldeWiderruf() in leereTokenCache() entfernt → rot: „ein Widerruf hier
 *      meldet sich bei den anderen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const auth = _req('src/konto/geraeteToken.js');
const tokenCache = _req('src/konto/tokenCache.js');
const pgNotify = _req('db/database.js').standardDb().benachrichtigung;
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

test('Token-Widerruf über alle Prozesse', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `widerruf_p_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  // Der „andere Prozess“: eine eigene Verbindung, die löscht, meldet und mithört.
  const anderer = new Client({ connectionString: process.env.DATABASE_URL });
  await anderer.connect();
  t.after(async () => {
    await pgNotify.close();
    await anderer.end().catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  tokenCache.horcheAufTokenWiderruf();
  // Steht die Horch-Verbindung, leert sie einmal den Speicher; das darf nicht
  // mitten in den ersten Fall fallen. Ein eigener Horcher meldet, wann es so weit ist.
  let bereit = false;
  const fertig = () => {
    bereit = true;
  };
  pgNotify.listen('token_widerrufen', fertig);
  for (let i = 0; i < 200 && !bereit; i++) await new Promise(r => setTimeout(r, 25));
  pgNotify.unlisten('token_widerrufen', fertig);
  assert.ok(bereit, 'die Horch-Verbindung kam nicht zustande');

  await t.test('ein Widerruf aus einem anderen Prozess gilt sofort', async () => {
    const token = await auth.createToken(uid, 'Probe', true);
    assert.ok((await auth.pruefeToken(token)).nutzer, 'Vorbedingung: Token gilt');
    await anderer.query('DELETE FROM api_tokens WHERE token = $1', [auth.hashToken(token)]);
    assert.ok((await auth.pruefeToken(token)).nutzer, 'Vorbedingung: der Zwischenspeicher trägt ihn noch');
    let gilt = true;
    for (let i = 0; i < 40 && gilt; i++) {
      await anderer.query("SELECT pg_notify('token_widerrufen', '')");
      await new Promise(r => setTimeout(r, 50));
      gilt = !!(await auth.pruefeToken(token)).nutzer;
    }
    assert.equal(gilt, false, 'der widerrufene Token gilt im Zwischenspeicher weiter');
  });

  await t.test('ein Widerruf hier meldet sich bei den anderen', async () => {
    const gehoert = [];
    anderer.on('notification', m => gehoert.push(m.channel));
    await anderer.query('LISTEN token_widerrufen');
    await auth.revokeAllTokens(uid);
    for (let i = 0; i < 40 && !gehoert.length; i++) await new Promise(r => setTimeout(r, 25));
    assert.deepEqual(gehoert.slice(0, 1), ['token_widerrufen']);
  });
});
