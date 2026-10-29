/**
 * Geheimnisse liegen verschlüsselt in der Datenbank und kommen lesbar wieder
 * heraus: globale Schlüssel, Gutschein-PIN, TOTP-Geheimnis. Klartext aus der
 * Zeit davor wird beim Start nachverschlüsselt. Mit falschem Schlüssel gibt es
 * null statt eines falschen Werts.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in setGlobalSetting den Wert unverschlüsselt geschrieben → rot:
 *      „globale Schlüssel …“
 *   B  in POST /vouchers verschluessele() weggelassen → rot: „Gutschein-PIN …“
 *   C  verschluesseleAltbestand() überspringt die Gutscheine → rot:
 *      „Altbestand …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const g = _req('utils/geheimnis.js');

const NAME = `geheim_${process.pid}`;

test('Geheimnisse verschlüsselt', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const vorher = await db.get("SELECT value FROM global_settings WHERE key = 'brickset_api_key'");
  t.after(async () => {
    if (vorher) await db.run("UPDATE global_settings SET value = $1 WHERE key = 'brickset_api_key'", [vorher.value]);
    else await db.run("DELETE FROM global_settings WHERE key = 'brickset_api_key'");
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const settings = _req('utils/settings.js');

  await t.test('globale Schlüssel', async () => {
    await settings.setGlobalSetting('brickset_api_key', 'klar-brickset-4242');
    const roh = (await db.get("SELECT value FROM global_settings WHERE key = 'brickset_api_key'")).value;
    assert.ok(roh.startsWith('v1:') && !roh.includes('4242'), roh);
    assert.equal(await settings.getGlobalSetting('brickset_api_key'), 'klar-brickset-4242');
    const gelesen = await settings.readSettings(uid, true);
    assert.ok(gelesen.brickset_api_key.endsWith('4242'), 'die Maske zeigt die letzten vier Zeichen des Klartexts');
  });

  await t.test('Gutschein-PIN', async () => {
    const { base } = testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
      routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
    const r = await fetch(`${base}/api/v1/vouchers`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: '5045076374450012121', pin: '8642', amount: 50, currency: 'CHF' }) });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.equal(b.voucher.pin, '8642');
    const roh = (await db.get('SELECT pin FROM vouchers WHERE id = $1', [b.voucher.id])).pin;
    assert.ok(roh.startsWith('v1:') && !roh.includes('8642'), roh);
    const liste = await (await fetch(`${base}/api/v1/vouchers`)).json();
    assert.equal(liste.vouchers.find(v => v.id === b.voucher.id).pin, '8642');
  });

  await t.test('TOTP-Geheimnis', async () => {
    const zf = _req('utils/zweiterFaktor.js');
    const geheimnis = await zf.beginneEinrichtung(uid);
    const roh = (await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid])).geheimnis;
    assert.ok(roh.startsWith('v1:') && !roh.includes(geheimnis), roh);
    assert.equal(g.entschluessele(roh), geheimnis);
  });

  await t.test('Altbestand wird nachverschlüsselt', async () => {
    const id = (await db.get(`INSERT INTO vouchers (user_id, number, pin, amount, currency)
      VALUES ($1, '5045076374450013131', '9753', 10, 'CHF') RETURNING id`, [uid])).id;
    await _req('utils/geheimnisAltbestand.js').verschluesseleAltbestand();
    const roh = (await db.get('SELECT pin FROM vouchers WHERE id = $1', [id])).pin;
    assert.ok(roh.startsWith('v1:'), roh);
    assert.equal(g.entschluessele(roh), '9753');
  });

  await t.test('falscher Schlüssel ergibt null, nicht Unsinn', async () => {
    const wert = g.verschluessele('geheim');
    process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
    g._vergissSchluessel();
    const echt = console.warn; console.warn = () => {};
    try { assert.equal(g.entschluessele(wert), null); } finally { console.warn = echt; }
  });
});
