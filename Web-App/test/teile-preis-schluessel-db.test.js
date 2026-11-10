/**
 * Der Teile-Preis-Cache hat EINEN Schlüsselraum.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { fetchPartPrice } = _req('src/finanzen/financeCalc.js');
const { getPartPriceHistory } = _req('src/finanzen/priceHistory.js');
const { haeltTeil } = require('./helpers/bestand');

test('Teile-Preise stehen unter EINER Nummer', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  // part_price_history steht nur in db/migrations/0003.
  const migClient = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(migClient); }
  finally { migClient.release(); }

  const p = String(process.pid).slice(-5);
  const NUTZER = `pks_${p}`;
  const RB = `pt${p}`;          // so steht das Teil in der Sammlung
  const BL = `pt${p}bl`;        // so kennt BrickLink es
  const FARBE = 0;              // 0 wird nicht übersetzt (resolveBlColorId)
  const RB2 = `qt${p}`;         // zweites Teil: GAR KEINE Zuordnung
  const WAEHRUNG = 'CHF';

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  // Kontowährung wie die abgefragte: Eine andere würde umgerechnet (Migration 0077).
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)`, [uid, WAEHRUNG]);
  // Die Zuordnung steht seit Migration 0037 in bl_zuordnung (art, rb_id, bl_id).
  await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ('part',$1,$2)
                ON CONFLICT (art, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id`, [RB, BL]);

  try {
    // ── 1. Cache-Treffer über die BrickLink-Nummer ─────────────────────────
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,$2,'N',$3,12.00,12.00,NOW())
       ON CONFLICT (part_number,color_id,condition,currency_code)
       DO UPDATE SET avg_price=12.00, qty_avg_price=12.00, fetched_at=NOW()`,
      [BL, FARBE, WAEHRUNG]);

    const preis = await fetchPartPrice(RB, FARBE, 'N', WAEHRUNG, 24);
    assert.equal(Number(preis?.avg_price), 12,
      `fetchPartPrice lieferte ${JSON.stringify(preis)} statt des zwischengespeicherten 12. ` +
      'Der Eintrag liegt unter der BrickLink-Nummer; wer mit der Rebrickable-Nummer ' +
      'ruft, legt sonst eine zweite Zeile für denselben Gegenstand an und fragt ' +
      'BrickLink erneut.');
    assert.equal(preis?.from_cache, true, 'Der Wert kam nicht aus dem Cache');

    // ── 2. Der Verlauf findet BEIDE Nummern ───────────────────────────────
    // Erfassung unter der Nummer des Benutzers — so hat er das Teil erfasst.
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
       VALUES ($1,$2,$3,1,5.00,'N')`, [uid, RB, FARBE]);
    // Ein ALTER Verlaufspunkt unter der Rebrickable-Nummer — so hat ihn die
    // Teileansicht bis jetzt geschrieben.
    await db.run(
      `INSERT INTO part_price_history (part_number,color_id,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,$2,'N',$3,11.00,11.00)`, [RB, FARBE, WAEHRUNG]);

    const v = await getPartPriceHistory(uid, RB, FARBE, WAEHRUNG);
    assert.ok(v.history_new.length >= 1,
      'Der Verlauf ist leer. Punkte unter der Rebrickable-Nummer sind alter Bestand — ' +
      'sie dürfen nicht aus dem Diagramm verschwinden, bloss weil künftig unter der ' +
      'BrickLink-Nummer geschrieben wird.');
    assert.ok(v.by_condition?.N,
      'Für den Zustand „N" kam keine Zeile zurück, obwohl eine Erfassung existiert');
    assert.equal(Number(v.by_condition.N.market_price), 12,
      `Der Marktpreis kam als ${v.by_condition.N.market_price} statt 12 zurück — ` +
      'der Cache-Eintrag unter der BrickLink-Nummer wird nicht gefunden.');
    assert.equal(Number(v.by_condition.N.purchase_price), 5,
      'Der Kaufpreis steht unter der Nummer des Benutzers und muss weiter gefunden werden');

    // 3. OHNE Zuordnung gilt die Rebrickable-Nummer
    await haeltTeil(db, uid, RB2, { menge: 1, colorId: FARBE });
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,$2,'N',$3,15.00,15.00,NOW())
       ON CONFLICT (part_number,color_id,condition,currency_code)
       DO UPDATE SET avg_price=15.00, qty_avg_price=15.00, fetched_at=NOW()`,
      [RB2, FARBE, WAEHRUNG]);

    const preis2 = await fetchPartPrice(RB2, FARBE, 'N', WAEHRUNG, 24);
    assert.equal(Number(preis2?.avg_price), 15,
      `fetchPartPrice lieferte ${JSON.stringify(preis2)} statt 15. Ohne Zuordnung ` +
      'muss die Rebrickable-Nummer selbst der Schlüssel sein — sonst fragt jeder ' +
      'Aufruf BrickLink neu, obwohl der Preis dasteht.');
  } finally {
    await db.run(`DELETE FROM part_price_history WHERE part_number = ANY($1)`, [[RB, BL, RB2]]).catch(() => {});
    await db.run(`DELETE FROM part_price_cache   WHERE part_number = ANY($1)`, [[RB, BL, RB2]]).catch(() => {});
    await db.run(`DELETE FROM bl_zuordnung WHERE art='part' AND rb_id = ANY($1)`, [[RB, RB2]]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
