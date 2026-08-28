/**
 * Der Marktpreis eines manuell erfassten Teils erreicht das Detailfenster.
 *
 * ── Marcos Befund (Nachtrag 143) ────────────────────────────────────────────
 * Auf der Finanzseite steht für „Primo Brick 1 x 1 (Blau)" CHF 0.13 als
 * Marktpreis. Im Detailfenster desselben Teils: „—".
 *
 * ── Zwei Schlüsselräume, die man nicht mischen darf ─────────────────────────
 * `part_price_cache` und `part_price_history` schreibt fetchPartPrice() — unter
 * der BRICKLINK-Teilenummer und der BRICKLINK-Farbnummer. BrickLink antwortet
 * auf Rebrickable-Nummern mit 404, deshalb wird vor dem Abruf übersetzt
 * (resolveBlPartNumber / resolveBlColorId), und der Cache erbt diesen Schlüssel.
 *
 * `part_acquisitions` trägt dagegen die REBRICKABLE-Nummer — so hat der
 * Benutzer sie eingegeben.
 *
 * getPartPriceHistory() nahm die Rebrickable-Werte für BEIDES. Für Teile ohne
 * Zuordnung stimmen die Schlüssel zufällig überein; für alle anderen fand die
 * Preisabfrage nichts, und die Zeile blieb leer.
 *
 * Die Finanzseite war nie betroffen: computePartsValuation() übersetzt selbst.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();

test('Preise stehen unter der BrickLink-Nummer, Erfassungen unter der Rebrickable-Nummer', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const ph = _req('utils/priceHistory.js');
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ('t_'||floor(random()*1e9),'x') RETURNING id`);

  // Marcos Lage nachgebaut: Die BrickLink-Nummer weicht ab, die Farbe auch.
  await db.run(
    `INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES ('31000','bl31000')
     ON CONFLICT DO NOTHING`);
  await db.run(
    `INSERT INTO rb_colors (id, name, bl_color_id) VALUES (1,'Blue',7)
     ON CONFLICT (id) DO UPDATE SET bl_color_id = 7`);

  // Erfassung mit Rebrickable-Schlüssel …
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
     VALUES ($1,'31000',1,2,'0.11','U')`, [u.id]);
  // … Preis mit BrickLink-Schlüssel.
  await db.run(
    `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
     VALUES ('bl31000',7,'U','CHF',0.13,0.13)
     ON CONFLICT (part_number,color_id,condition,currency_code) DO UPDATE SET avg_price = 0.13`);

  const r = await ph.getPartPriceHistory([u.id], '31000', 1, 'CHF');

  assert.ok(r.by_condition.U, 'Für den erfassten Zustand fehlt die Zeile ganz');
  assert.equal(r.by_condition.U.market_price, 0.13,
    'Der Marktpreis kommt nicht an — die Abfrage sucht ihn unter der ' +
    'Rebrickable-Nummer, geschrieben wurde er unter der BrickLink-Nummer.');
  assert.equal(r.by_condition.U.purchase_price, 0.11,
    'Der Kaufpreis kommt nicht an — die Erfassung steht unter der ' +
    'Rebrickable-Nummer und darf NICHT mit übersetzt werden.');
  assert.equal(r.by_condition.U.pnl_pct, 18.2);

  await db.run('DELETE FROM part_acquisitions WHERE user_id = $1', [u.id]);
  await db.pool.end().catch(() => {});
});
