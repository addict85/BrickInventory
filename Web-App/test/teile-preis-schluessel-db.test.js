/**
 * Der Teile-Preis-Cache hat EINEN Schlüsselraum.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * fetchPartPrice() übersetzte nur die FARBE nach BrickLink; die Teilenummer
 * nahm es so, wie der Aufrufer sie mitbrachte. Und die drei Aufrufer bringen
 * Verschiedenes mit:
 *
 *   utils/financeCalc.ts:878   part.bl_part_number || part.part_number → BL
 *   routes/parts.ts:224        partNumber                              → RB
 *   routes/minifigs.ts:203     blPartNum                               → BL
 *
 * Für ein Teil, dessen Nummern sich unterscheiden, standen dadurch ZWEI Zeilen
 * für denselben Gegenstand in part_price_cache, jede mit eigener Frist: Die
 * Bewertung sah die Zeile nicht, die der Marktpreis der Teileansicht
 * geschrieben hatte, und umgekehrt — jede holte den Preis erneut bei
 * BrickLink. Und getPartPriceHistory suchte unter der BrickLink-Nummer, fand
 * also nur die Hälfte.
 *
 * Der Kommentar in utils/priceHistory.ts behauptete den einen Schlüsselraum
 * bereits („werden unter der BRICKLINK-Teilenummer geschrieben"). Für die
 * Farbe stimmte er, für die Nummer nicht.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 *  1. fetchPartPrice findet einen Cache-Eintrag, der unter der BrickLink-
 *     Nummer liegt, auch wenn es mit der Rebrickable-Nummer gerufen wird.
 *     Lesen und Schreiben benutzen dieselbe Variable — damit ist auch der
 *     Schreibschlüssel festgenagelt.
 *  2. getPartPriceHistory findet Preise unter BEIDEN Nummern. Die schon
 *     vorhandenen Zeilen unter der Rebrickable-Nummer sollen nicht aus dem
 *     Diagramm verschwinden.
 *
 * Kein Netzzugriff: Der Cache-Treffer beendet fetchPartPrice, bevor BrickLink
 * gefragt würde.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { fetchPartPrice } = _req('utils/financeCalc.js');
const { getPartPriceHistory } = _req('utils/priceHistory.js');

test('Teile-Preise stehen unter EINER Nummer', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // part_price_history steht nur in db/migrations/0003.
  const migClient = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(migClient); }
  finally { migClient.release(); }

  const p = String(process.pid).slice(-5);
  const NUTZER = `pks_${p}`;
  const RB = `pt${p}`;          // so steht das Teil in der Sammlung
  const BL = `pt${p}bl`;        // so kennt BrickLink es
  const FARBE = 0;              // 0 wird nicht übersetzt (resolveBlColorId)
  const RB2 = `qt${p}`;         // zweites Teil: BL-Nummer nur in parts
  const BL2 = `qt${p}bl`;
  const WAEHRUNG = 'CHF';

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await db.run(`INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES ($1,$2)
                ON CONFLICT (part_num) DO UPDATE SET bl_part_num = EXCLUDED.bl_part_num`, [RB, BL]);

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

    // ── 3. Zweite Quelle: parts.bl_part_number ohne rb_bl_mapping ─────────
    //
    // jobs/backfillBlPartNumbers.ts schreibt beide im selben Durchlauf.
    // Scheitert dort das INSERT in rb_bl_mapping, bleibt die Lücke für immer:
    // Der Job wählt beim nächsten Mal nur Teile mit leerem bl_part_number, und
    // dieses hat ja eines. Genau dieser Zustand wird hier hergestellt.
    await db.run(`DELETE FROM rb_bl_mapping WHERE part_num=$1`, [RB2]);
    await db.run(
      `INSERT INTO parts (user_id,part_number,bl_part_number,color_id,quantity,source)
       VALUES ($1,$2,$3,$4,1,'manual')`, [uid, RB2, BL2, FARBE]);
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,$2,'N',$3,15.00,15.00,NOW())
       ON CONFLICT (part_number,color_id,condition,currency_code)
       DO UPDATE SET avg_price=15.00, qty_avg_price=15.00, fetched_at=NOW()`,
      [BL2, FARBE, WAEHRUNG]);

    const preis2 = await fetchPartPrice(RB2, FARBE, 'N', WAEHRUNG, 24);
    assert.equal(Number(preis2?.avg_price), 15,
      `fetchPartPrice lieferte ${JSON.stringify(preis2)} statt 15. Für dieses Teil steht ` +
      'die BrickLink-Nummer nur in parts.bl_part_number, nicht in rb_bl_mapping — ein ' +
      'Zustand, aus dem der Nachtrag-Job von selbst nie wieder herausfindet.');
  } finally {
    await db.run(`DELETE FROM part_price_history WHERE part_number = ANY($1)`, [[RB, BL, RB2, BL2]]).catch(() => {});
    await db.run(`DELETE FROM part_price_cache   WHERE part_number = ANY($1)`, [[RB, BL, RB2, BL2]]).catch(() => {});
    await db.run(`DELETE FROM rb_bl_mapping WHERE part_num = ANY($1)`, [[RB, RB2]]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
