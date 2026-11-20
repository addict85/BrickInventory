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
 *      „Altbestand …“ (seit 01.11.2026 schlüsselt reencryptNumbers()
 *      auch die PIN um)
 * Gegenprobe (am 29.10.2026 gemessen):
 *   D  geheimnisMaske() hängt wieder die letzten vier Zeichen an → rot:
 *      „globale Schlüssel …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ DATA_KEY: crypto.randomBytes(32).toString('base64') });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const g = _req('src/infra/secret.js');

const NAME = `geheim_${process.pid}`;

test('secrets encrypted', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const vorher = await db.get("SELECT value FROM global_settings WHERE key = 'brickset_api_key'");
  t.after(async () => {
    if (vorher) await db.run("UPDATE global_settings SET value = $1 WHERE key = 'brickset_api_key'", [vorher.value]);
    else await db.run("DELETE FROM global_settings WHERE key = 'brickset_api_key'");
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const settings = _req('src/settings/settings.js');

  await t.test('global keys', async () => {
    await settings.setGlobalSetting('brickset_api_key', 'klar-brickset-4242');
    const roh = (await db.get("SELECT value FROM global_settings WHERE key = 'brickset_api_key'")).value;
    assert.ok(roh.startsWith('v2:') && !roh.includes('4242'), roh);
    assert.equal(await settings.getGlobalSetting('brickset_api_key'), 'klar-brickset-4242');
    const gelesen = await settings.readSettings(uid, true);
    assert.equal(gelesen.brickset_api_key, '\u2022'.repeat(12), 'die Maske sagt nur „gesetzt"');
  });

  await t.test('voucher PIN', async () => {
    const { base } = testServer(_req, { sitzung: { userId: uid }, t });
    const r = await fetch(`${base}/api/v1/vouchers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: '5045076374450012121', pin: '8642', amount: 50, currency: 'CHF' }),
    });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.equal(b.voucher.pin, '•••', 'nach aussen nur die Maske');
    const roh = (await db.get('SELECT pin FROM vouchers WHERE id = $1', [b.voucher.id])).pin;
    assert.ok(roh.startsWith('v2:') && !roh.includes('8642'), roh);
    assert.equal(
      (await require('./helpers/sources').testArea('vouchers').vouchers.voucher(uid, b.voucher.id)).pin,
      '8642',
      'entschlüsselt lesbar',
    );
  });

  await t.test('TOTP secret', async () => {
    const zf = _req('src/factors/secondFactor.js');
    const secret = await zf.beginSetup(uid);
    const roh = (await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid])).secret;
    assert.ok(roh.startsWith('v2:') && !roh.includes(secret), roh);
    assert.equal(g.decrypt(roh, zf.secondFactorContext(uid)), secret);
  });

  await t.test('legacy stock is encrypted afterwards', async () => {
    const gs = {
      ..._req('src/vouchers/repository/vouchers.js'),
      ...require('./helpers/sources').testArea('vouchers').vouchers,
    };
    const { id } = await gs.createVoucher(uid, {
      number: '5045076374450013131',
      pin: null,
      amount: 10,
      currency: 'CHF',
    });
    await db.run("UPDATE vouchers SET pin = '9753' WHERE id = $1", [id]);
    await gs.reencryptNumbers();
    const roh = (await db.get('SELECT pin FROM vouchers WHERE id = $1', [id])).pin;
    assert.ok(roh.startsWith('v2:'), roh);
    assert.equal(g.decrypt(roh, gs.pinContext(uid, id)), '9753');
  });

  await t.test('wrong key yields null, not nonsense', async () => {
    const wert = g.encrypt('geheim', g.kontext('probe'));
    environment({ DATA_KEY: crypto.randomBytes(32).toString('base64') });
    g._forgetKey();
    const echt = console.warn;
    console.warn = () => {};
    try {
      assert.equal(g.decrypt(wert, g.kontext('probe')), null);
    } finally {
      console.warn = echt;
    }
  });
});
