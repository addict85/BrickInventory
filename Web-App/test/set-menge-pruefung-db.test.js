/**
 * Eine kaputte Menge löscht keinen Bestand, und Menge 0 geht in den
 * Papierkorb.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  bestandsMenge() in updateSet durch `parseInt(body.quantity) || 0`
 *      ersetzt → rot: „eine kaputte Menge wird abgewiesen" (200, Set weg)
 *   B  legeInPapierkorb() im Zweig für Menge 0 entfernt → rot: „Menge 0
 *      legt das Set in den Papierkorb"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { haeltSet, mengeVon } = require('./helpers/bestand');

test('Mengenänderung am Set: Prüfung und Papierkorb', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `menge-pruef-${process.pid}`, SN = `31150-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await haeltSet(db, uid, SN, 2, { preis: 40 });

  const { base } = testServer(_req, {
    sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });
  const setze = (menge) => fetch(`${base}/api/v1/sets/${SN}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: menge }) });

  try {
    await t.test('eine kaputte Menge wird abgewiesen', async () => {
      for (const kaputt of [{ a: 1 }, 'abc', -1, 1.5]) {
        const r = await setze(kaputt);
        assert.equal(r.status, 400, JSON.stringify(kaputt));
      }
      assert.equal(await mengeVon(db, uid, SN), 2, 'der Bestand ist unverändert');
    });

    await t.test('eine gültige Menge als Text wird angenommen', async () => {
      const r = await setze('3');
      assert.equal(r.status, 200);
      assert.equal(await mengeVon(db, uid, SN), 3);
    });

    await t.test('Menge 0 legt das Set in den Papierkorb', async () => {
      const r = await setze(0);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.quantity, 0);
      assert.ok(j.papierkorb, 'die Antwort nennt den Papierkorb-Eintrag');
      const eintrag = await db.get('SELECT art, nummer FROM papierkorb WHERE id=$1 AND user_id=$2', [j.papierkorb, uid]);
      assert.equal(eintrag?.nummer, SN);
      assert.equal(await db.get('SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2', [uid, SN]), undefined);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
