/**
 * Der Barcode-Treffer nennt das lokale Bild eines Sets: Set-Bilder sind seit
 * Migration 0105 Katalog, die Bildroute liefert sie jedem angemeldeten Konto.
 * Der Dienst setZumBarcode() kennt deshalb kein Konto mehr.
 *
 * Gegenprobe (am 11.11.2026 gemessen):
 *   B  in barcodeErgebnis() image_local immer null → rot: „der Treffer nennt das lokale Bild“
 *
 * Ohne Rebrickable-Schlüssel antwortet nur der eigene Katalog; es geht nichts ins Netz.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('Barcode-Treffer und lokales Bild', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const SN = `BCB${process.pid}-1`;
  const S = _req('src/einstellungen/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await db.run("DELETE FROM global_settings WHERE key = 'rebrickable_api_key'");
  await db.run("DELETE FROM users WHERE username LIKE 'bcb_%'");
  const eigen = (await db.get("INSERT INTO users (username, password_hash) VALUES ('bcb_eigen','x') RETURNING id")).id;
  const fremd = (await db.get("INSERT INTO users (username, password_hash) VALUES ('bcb_fremd','x') RETURNING id")).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [eigen, SN]);
  await katalogSet(db, SN, { name: SN, image_local: `/images/sets/${SN}.jpg` });
  await db.run('INSERT INTO catalog_cache (set_number, name) VALUES ($1,$1)', [SN]);
  t.after(async () => {
    await db.run('DELETE FROM rb_sets WHERE set_num = $1', [SN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[eigen, fremd]]);
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
  });
  const { setZumBarcode } = _req('src/sets/index.js');

  await t.test('der Treffer nennt das lokale Bild', async () => {
    const r = await setZumBarcode(SN);
    assert.equal(r?.set_number, SN, 'der Treffer fehlt — die Prüfung darunter bewiese nichts');
    assert.match(String(r?.image_local), new RegExp(SN));
  });
});
