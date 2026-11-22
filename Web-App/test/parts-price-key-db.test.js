/**
 * The parts price cache has ONE key space.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { fetchPartPrice } = _req('src/finances/financeCalc.js');
const { priceHistoryPart } = _req('src/finances/priceHistory.js');
const { holdsPart } = require('./helpers/inventory');

test('part prices are under ONE number', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  // part_price_history only stands in db/migrations/0003.
  const migClient = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(migClient);
  } finally {
    migClient.release();
  }

  const p = String(process.pid).slice(-5);
  const NUTZER = `pks_${p}`;
  const RB = `pt${p}`; // this is how the part stands in the collection
  const BL = `pt${p}bl`; // this is how BrickLink knows it
  const FARBE = 0; // 0 is not translated (resolveBlColorId)
  const RB2 = `qt${p}`; // second part: NO mapping AT ALL
  const CURRENCY = 'CHF';

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  // Account currency like the queried one: another one would be converted (migration 0077).
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)`, [uid, CURRENCY]);
  // Since migration 0037 the mapping stands in bl_mapping (type, rb_id, bl_id).
  await db.run(
    `INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('part',$1,$2)
                ON CONFLICT (type, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id`,
    [RB, BL],
  );

  try {
    // ── 1. Cache hit via the BrickLink number ─────────────────────────
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,$2,'N',$3,12.00,12.00,NOW())
       ON CONFLICT (part_number,color_id,condition,currency_code)
       DO UPDATE SET avg_price=12.00, qty_avg_price=12.00, fetched_at=NOW()`,
      [BL, FARBE, CURRENCY],
    );

    const preis = await fetchPartPrice(RB, FARBE, 'N', CURRENCY, 24);
    assert.equal(
      Number(preis?.avg_price),
      12,
      `fetchPartPrice lieferte ${JSON.stringify(preis)} statt des zwischengespeicherten 12. ` +
        'Der Eintrag liegt unter der BrickLink-Nummer; wer mit der Rebrickable-Nummer ' +
        'ruft, legt sonst eine zweite Zeile für denselben Gegenstand an und fragt ' +
        'BrickLink erneut.',
    );
    assert.equal(preis?.from_cache, true, 'Der Wert kam nicht aus dem Cache');

    // ── 2. The history finds BOTH numbers ───────────────────────────────
    // Acquisition under the user's number — that is how he captured the part.
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
       VALUES ($1,$2,$3,1,5.00,'N')`,
      [uid, RB, FARBE],
    );
    // An OLD history point under the Rebrickable number — that is how the
    // parts view wrote it until now.
    await db.run(
      `INSERT INTO part_price_history (part_number,color_id,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,$2,'N',$3,11.00,11.00)`,
      [RB, FARBE, CURRENCY],
    );

    const v = await priceHistoryPart(uid, RB, FARBE, CURRENCY);
    assert.ok(
      v.history_new.length >= 1,
      'Der Verlauf ist leer. Punkte unter der Rebrickable-Nummer sind alter Bestand — ' +
        'sie dürfen nicht aus dem Diagramm verschwinden, bloss weil künftig unter der ' +
        'BrickLink-Nummer geschrieben wird.',
    );
    assert.ok(v.by_condition?.N, 'Für den Zustand „N" kam keine Zeile zurück, obwohl eine Erfassung existiert');
    assert.equal(
      Number(v.by_condition.N.market_price),
      12,
      `Der Marktpreis kam als ${v.by_condition.N.market_price} statt 12 zurück — ` +
        'der Cache-Eintrag unter der BrickLink-Nummer wird nicht gefunden.',
    );
    assert.equal(
      Number(v.by_condition.N.purchase_price),
      5,
      'Der Kaufpreis steht unter der Nummer des Benutzers und muss weiter gefunden werden',
    );

    // 3. WITHOUT a mapping the Rebrickable number applies
    await holdsPart(db, uid, RB2, { quantity: 1, colorId: FARBE });
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,$2,'N',$3,15.00,15.00,NOW())
       ON CONFLICT (part_number,color_id,condition,currency_code)
       DO UPDATE SET avg_price=15.00, qty_avg_price=15.00, fetched_at=NOW()`,
      [RB2, FARBE, CURRENCY],
    );

    const preis2 = await fetchPartPrice(RB2, FARBE, 'N', CURRENCY, 24);
    assert.equal(
      Number(preis2?.avg_price),
      15,
      `fetchPartPrice lieferte ${JSON.stringify(preis2)} statt 15. Ohne Zuordnung ` +
        'muss die Rebrickable-Nummer selbst der Schlüssel sein — sonst fragt jeder ' +
        'Aufruf BrickLink neu, obwohl der Preis dasteht.',
    );
  } finally {
    await db.run(`DELETE FROM part_price_history WHERE part_number = ANY($1)`, [[RB, BL, RB2]]).catch(() => {});
    await db.run(`DELETE FROM part_price_cache   WHERE part_number = ANY($1)`, [[RB, BL, RB2]]).catch(() => {});
    await db.run(`DELETE FROM bl_mapping WHERE type='part' AND rb_id = ANY($1)`, [[RB, RB2]]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
