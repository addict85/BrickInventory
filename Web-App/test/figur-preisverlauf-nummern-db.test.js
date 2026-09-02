/**
 * Der Preisverlauf einer Minifigur findet ihre Preise auch unter der
 * BrickLink-Nummer.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Für Teile ist das in Nachtrag 143 beschrieben und behoben: Preise stehen
 * unter der BrickLink-Nummer, Erfassungen unter der des Benutzers, also
 * braucht die Abfrage ZWEI Schlüssel. Für Minifiguren stand ein Schlüssel für
 * beides — und der Kommentar an manualPriceHistory behauptete ausdrücklich,
 * bei Minifiguren stimmten beide überein.
 *
 * Sie stimmen nicht überein, sobald eine Figur eine eigene bl_fig_number
 * trägt. getCurrentFigMarketPrice versucht `[blFigNumber, figNumber]` der
 * Reihe nach; fetchMinifigPrice legt Cache und Verlauf unter der Nummer ab,
 * mit der der Abruf geklappt hat. Gesucht wurde unter der Nummer des
 * Benutzers.
 *
 * Sichtbar wie bei den Teilen: In der Finanzliste steht ein Marktpreis, im
 * Detailfenster ein „—", und das Diagramm bleibt leer.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 * Die Aussage ist, welche Zeilen eine Abfrage findet. Am Quelltext wäre es die
 * Frage, ob irgendwo zwei Parameter stehen.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { getMinifigPriceHistory } = _req('utils/priceHistory.js');

test('der Figuren-Preisverlauf findet die Preise unter der BrickLink-Nummer', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // minifig_price_history steht bewusst NUR in db/migrations/0003 (siehe die
  // Abgrenzung oben in db/schema.sql). initSchema() legt sie nicht an; ohne
  // diesen Schritt liefe der Test gegen ein Schema, das es im Betrieb nicht
  // gibt. Die Migrationen sind idempotent und überspringen bereits
  // eingespielte Stände über schema_migrations.
  const migClient = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(migClient); }
  finally { migClient.release(); }

  const p = String(process.pid).slice(-5);
  const NUTZER = `fig_${p}`;
  const EIGENE = `sw${p}`;      // so hat der Benutzer die Figur erfasst
  const BL     = `sw${p}bl`;    // so kennt BrickLink sie
  const OHNE_BL = `sw${p}x`;    // zweite Figur, ganz ohne BrickLink-Nummer
  const WAEHRUNG = 'CHF';

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  try {
    // Die Figur trägt eine ABWEICHENDE BrickLink-Nummer — der Fall, für den
    // es das Feld gibt.
    await db.run(
      `INSERT INTO minifigs (user_id,fig_number,bl_fig_number,fig_name,quantity,source)
       VALUES ($1,$2,$3,'Testfigur',1,'manual')`, [uid, EIGENE, BL]);
    // Der Kaufpreis steht unter der Nummer des Benutzers.
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,$2,1,4.00,'N')`, [uid, EIGENE]);
    // Marktpreis und Verlauf stehen unter der BRICKLINK-Nummer — so schreibt
    // sie fetchMinifigPrice, wenn der Abruf über bl_fig_number geklappt hat.
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,9.00,9.00)
       ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=9.00, qty_avg_price=9.00`, [BL, WAEHRUNG]);
    await db.run(
      `INSERT INTO minifig_price_history (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,9.00,9.00)`, [BL, WAEHRUNG]);

    const v = await getMinifigPriceHistory(uid, EIGENE, WAEHRUNG);

    assert.ok(v.by_condition?.N,
      'Für den Zustand „N" kam gar keine Zeile zurück, obwohl eine Erfassung existiert');
    assert.equal(Number(v.by_condition.N.market_price), 9,
      `Der Marktpreis kam als ${v.by_condition.N.market_price} statt 9 zurück. Er steht ` +
      'unter der BrickLink-Nummer; wird nur die Nummer des Benutzers abgefragt, ' +
      'bleibt im Detailfenster ein „—" stehen, während die Finanzliste einen Wert zeigt.');
    assert.equal(Number(v.by_condition.N.purchase_price), 4,
      'Der Kaufpreis steht unter der Nummer des Benutzers und muss weiter gefunden werden');
    assert.ok(v.history_new.length >= 1,
      'Der Verlauf ist leer — dann bleibt das Diagramm leer, obwohl Punkte da sind');

    // ── Und die andere Hälfte: die EIGENE Nummer darf nicht wegfallen ───────
    //
    // Ohne diesen Fall wäre die Regel halb bewiesen: Eine Fassung, die NUR
    // die BrickLink-Nummer abfragt, käme oben durch. Der Schätzpfad
    // (estimateFigPriceFromParts) legt aber ausdrücklich unter der Nummer des
    // Benutzers ab, und ältere Zeilen stammen aus der Zeit vor der
    // bl_fig_number.
    await db.run(
      `INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
       VALUES ($1,$2,'Testfigur ohne BL',1,'manual')`, [uid, OHNE_BL]);
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,$2,1,3.00,'N')`, [uid, OHNE_BL]);
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,7.00,7.00)
       ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=7.00, qty_avg_price=7.00`, [OHNE_BL, WAEHRUNG]);
    await db.run(
      `INSERT INTO minifig_price_history (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,7.00,7.00)`, [OHNE_BL, WAEHRUNG]);

    const w = await getMinifigPriceHistory(uid, OHNE_BL, WAEHRUNG);
    assert.ok(w.by_condition?.N, 'Ohne BrickLink-Nummer kam gar keine Zeile zurück');
    assert.equal(Number(w.by_condition.N.market_price), 7,
      `Der Marktpreis kam als ${w.by_condition.N.market_price} statt 7 zurück. Bei einer ` +
      'Figur ohne eigene BrickLink-Nummer stehen die Preise unter ihrer eigenen — ' +
      'so schreibt sie der Schätzpfad über die Einzelteile.');
    assert.ok(w.history_new.length >= 1,
      'Ohne BrickLink-Nummer bleibt der Verlauf leer');
  } finally {
    await db.run(`DELETE FROM minifig_price_history WHERE fig_number IN ($1,$2,$3)`, [EIGENE, BL, OHNE_BL]).catch(() => {});
    await db.run(`DELETE FROM minifig_price_cache   WHERE fig_number IN ($1,$2,$3)`, [EIGENE, BL, OHNE_BL]).catch(() => {});
    await db.run(`DELETE FROM minifig_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM minifigs WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
