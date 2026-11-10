/**
 * Manuell erfasste Teile und Figuren tragen ihren Marktpreis mit.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, handlerModul } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const H  = handlerModul(_req);
const MF = _req('src/figuren/abfragen.js');
const { haeltFigur, haeltTeil } = require('./helpers/bestand');

const U = 990701;
const FIG = 'mp-fig-1', TEIL = 'mp-teil-1', FARBE = 4;

test('manuelle Listen tragen den Marktpreis aus dem Cache', async (t) => {
  try { await db.get('SELECT 1'); } catch { return t.skip('keine Test-Datenbank erreichbar'); }

  const aufraeumen = async () => {
    for (const tab of ['parts', 'minifigs']) await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIG]).catch(() => {});
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TEIL]).catch(() => {});
  };

  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,'mpreis','x') ON CONFLICT (id) DO NOTHING", [U]);
    // Die Farbe muss sich auf sich selbst abbilden, sonst liegt der
    // Cache-Schlüssel woanders — fetchPartPrice übersetzt beides, bevor es liest.
    await db.run("INSERT INTO rb_colors (id,name,bl_color_id) VALUES ($1,'Rot',$1) ON CONFLICT (id) DO UPDATE SET bl_color_id=$1", [FARBE]);
    // Der Zustand steht seit Migration 0035 in der Erfassung. Dieser Test
    // prueft den Marktpreis OHNE Erfassung, also bleibt es beim Vorgabewert
    // 'N', den conditionFromAcquisitions() ohne Erfassungen liefert.
    // bl_fig_number ist mit Migration 0037 weg; dieselbe Nummer in beiden …
    await haeltFigur(db, U, FIG, { menge: 1 });
    await haeltTeil(db, U, TEIL, { menge: 1, colorId: FARBE });

    // ── 2 zuerst: OHNE Cache-Eintrag ───────────────────────────────────────
    // Diese Reihenfolge ist Absicht. Stünde sie hinten, könnte ein Fehler in
    // Zusicherung 1 sie nie erreichen — und gerade sie schützt davor, dass
    // die Liste bei fehlendem Preis scheitert statt leer zu bleiben.
    const figsOhne  = await MF.getManualMinifigs([U], U);
    const teileOhne = await H.getManualParts([U], U);
    assert.equal(figsOhne.length, 1, 'die Figur muss auch ohne Preis in der Liste stehen');
    assert.equal(teileOhne.length, 1, 'das Teil muss auch ohne Preis in der Liste stehen');
    assert.equal(figsOhne[0].avg_price, null, 'ohne Cache-Eintrag bleibt der Marktpreis leer');
    assert.equal(teileOhne[0].avg_price, null, 'ohne Cache-Eintrag bleibt der Marktpreis leer');

    // ── 1. MIT Cache-Eintrag ───────────────────────────────────────────────
    await db.run(`INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price,fetched_at)
                  VALUES ($1,'N','EUR',12.5,12,NOW())`, [FIG]);
    await db.run(`INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
                  VALUES ($1,$2,'N','EUR',0.75,0.7,NOW())`, [TEIL, FARBE]);

    const figs  = await MF.getManualMinifigs([U], U);
    const teile = await H.getManualParts([U], U);
    assert.equal(Number(figs[0].avg_price), 12.5,
      `der Marktpreis der Figur fehlt (avg_price=${JSON.stringify(figs[0].avg_price)}) — genau das war Marcos Befund`);
    assert.equal(Number(teile[0].avg_price), 0.75,
      `der Marktpreis des Teils fehlt (avg_price=${JSON.stringify(teile[0].avg_price)})`);
  } finally {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
