/**
 * Der Barcode-Treffer nennt das lokale Bild eines Sets: Set-Bilder sind seit
 * Migration 0105 Katalog, die Bildroute liefert sie jedem angemeldeten Konto.
 * Der Dienst setToBarcode() kennt deshalb kein Konto mehr.
 *
 * Gegenprobe (am 11.11.2026 gemessen):
 *   B  in barcodeResult() image_local immer null → rot: „der Treffer nennt das lokale Bild“
 *
 * Ohne Rebrickable-Schlüssel antwortet nur der eigene Katalog; es geht nichts ins Netz.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('barcode hit and local image', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const SN = `BCB${process.pid}-1`;
  const S = _req('src/settings/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await db.run("DELETE FROM global_settings WHERE key = 'rebrickable_api_key'");
  await db.run("DELETE FROM users WHERE username LIKE 'bcb_%'");
  const eigen = (await db.get("INSERT INTO users (username, password_hash) VALUES ('bcb_eigen','x') RETURNING id")).id;
  const fremd = (await db.get("INSERT INTO users (username, password_hash) VALUES ('bcb_fremd','x') RETURNING id")).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [eigen, SN]);
  await catalogSet(db, SN, { name: SN, image_local: `/images/sets/${SN}.jpg` });
  await db.run('INSERT INTO catalog_cache (set_number) VALUES ($1)', [SN]);
  t.after(async () => {
    await db.run('DELETE FROM rb_sets WHERE set_num = $1', [SN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[eigen, fremd]]);
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
  });
  const { setToBarcode } = require('./helpers/sources').areaPage('sets');

  await t.test('the hit names the local image', async () => {
    const r = await setToBarcode(SN);
    assert.equal(r?.set_number, SN, 'der Treffer fehlt — die Prüfung darunter bewiese nichts');
    assert.match(String(r?.image_local), new RegExp(SN));
  });
});
