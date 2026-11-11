/**
 * Die Marktpreise eines Merkpostens: Eine Nummer, die kein Katalog kennt, löst
 * keinen BrickLink-Abruf aus (das Tageskontingent teilen alle Konten).
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  die Katalogprüfung in preiseBeiderZustaende() entfernt
 *      → rot: „erfundene Nummer …“ und „eine kein-Preis-Markierung …“
 *   B  setImKatalog() verneint immer (auch bekannte Sets)
 *      → rot: „bekanntes Set wird abgerufen“
 *   C  setImKatalog() zählt die NONE-Markierung als Treffer
 *      → rot: „eine kein-Preis-Markierung ist kein Katalogeintrag“
 *
 * BrickLink selbst wird nicht gefragt: https.get ist eine Attrappe, die jeden
 * Aufruf zählt. Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

/** @type {string[]} */
const aufrufe = [];
// @ts-expect-error — Attrappe mit genau dem, was clients/bricklink.ts benutzt.
https.get = (url, _opts, cb) => {
  aufrufe.push(new URL(url).pathname);
  const req = new EventEmitter();
  const data = { avg_price: '12.50', qty_avg_price: '12.00', min_price: '10', max_price: '15', total_quantity: '3' };
  setImmediate(() => {
    cb(
      /** @type {any} */ (
        Object.assign(Readable.from([JSON.stringify({ meta: { code: 200 }, data })]), { statusCode: 200, headers: {} })
      ),
    );
  });
  return req;
};

test('Merkposten-Preise rufen BrickLink nur für Sets des Katalogs', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  const ERFUNDEN = '98765-1';
  const BEKANNT = '98766-1';
  const MARKIERT = '98767-1';
  const zugang = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const setze = async (k, v) =>
    db.run(`INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [
      k,
      v,
    ]);
  const alterZugang = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [zugang]);
  for (const k of zugang) await setze(k, 'test');
  await _req('src/einstellungen/settings.js').verschluesseleGlobaleAltwerte();
  await db.run('DELETE FROM users WHERE username = $1', ['preise_erfunden']);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ('preise_erfunden','x') RETURNING id`))
    .id;
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, num_parts) VALUES ($1,'Bekannt',2020,100)
                ON CONFLICT (set_num) DO NOTHING`,
    [BEKANNT],
  );
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,'NONE',true)
                ON CONFLICT (set_number) DO UPDATE SET bl_type='NONE', is_gear=true`,
    [MARKIERT],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM rb_sets WHERE set_num = $1', [BEKANNT]);
    await db.run('DELETE FROM catalog_cache WHERE set_number = ANY($1)', [[MARKIERT, BEKANNT, ERFUNDEN]]);
    await db.run('DELETE FROM price_cache WHERE set_number = ANY($1)', [[BEKANNT, ERFUNDEN]]);
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [zugang]);
    for (const z of alterZugang) await setze(z.key, z.value);
    await db.pool.end().catch(() => {});
  });
  const { preiseBeiderZustaende } = _req('src/merkliste/merkliste.js');

  await t.test('erfundene Nummer: kein BrickLink-Aufruf', async () => {
    aufrufe.length = 0;
    const r = await preiseBeiderZustaende(uid, ERFUNDEN);
    assert.deepEqual(r.current, {});
    assert.equal(aufrufe.length, 0, `unnötig abgerufen: ${aufrufe.join(' | ')}`);
  });

  await t.test('eine kein-Preis-Markierung ist kein Katalogeintrag', async () => {
    aufrufe.length = 0;
    const r = await preiseBeiderZustaende(uid, MARKIERT);
    assert.deepEqual(r.current, {});
    assert.equal(aufrufe.length, 0, `unnötig abgerufen: ${aufrufe.join(' | ')}`);
  });

  await t.test('bekanntes Set wird abgerufen', async () => {
    aufrufe.length = 0;
    const r = await preiseBeiderZustaende(uid, BEKANNT);
    assert.ok(aufrufe.length > 0, 'die Attrappe sah keinen Aufruf — die Gegenprobe oben bewiese nichts');
    assert.equal(parseFloat(String(r.current.N.avg_price)), 12.5);
  });
});
