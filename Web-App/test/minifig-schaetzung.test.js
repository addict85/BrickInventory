'use strict';
/**
 * Ohne BrickLink-Preis wird der Minifiguren-Preis aus den Teilen geschätzt.
 *
 * Marco: „Bitte noch prüfen, dass bei den Minifiguren der Preis über die
 * einzelnen Teile berechnet wird, sofern keine bl-Id vorhanden ist." Die Kette:
 * ohne bl_fig_number wird die eigene Nummer bei BrickLink versucht; erst ohne
 * Preis dort wird über die Teile geschätzt, im ermittelten Zustand; die
 * Schätzung landet in Cache und Verlauf. BrickLink ist im Test nicht
 * eingerichtet, die Preise stehen in den Zwischenspeichern.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in figMarktpreisMitHerkunft() nur [blFigNumber] versucht → rot: „die
 *      eigene Nummer wird bei BrickLink versucht“
 *   B  schaetzeFigurenpreis() mit festem 'N' statt effCond → rot: „im Zustand
 *      der Anfrage“ (2 statt 3)
 *   C  den Cache-Eintrag der Schätzung nicht mehr geschrieben → rot: „die
 *      Schätzung wird zwischengespeichert“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

test('Minifiguren-Preis: BrickLink zuerst, sonst aus den Teilen', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const { figMarktpreisMitHerkunft } = _req('utils/marketPrice.js');
  const P = process.pid, NAME = `schaetzung-${P}`;
  const FA = `fig-sa${P}`, FB = `fig-sb${P}`, FC = `fig-sc${P}`, TA = `sa${P}`, TB = `sb${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM minifig_parts_cache WHERE fig_number = ANY($1)', [[FA, FB, FC]]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [[TA, TB]]);
  };
  await weg();
  t.after(async () => { await weg().catch(() => {}); await db.pool.end().catch(() => {}); });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);

  await t.test('die eigene Nummer wird bei BrickLink versucht', async () => {
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,'N','CHF',7)`, [FA]);
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`,
      [FA, JSON.stringify([{ part_num: TA, color_id: 777, quantity: 1 }])]);
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,777,'N','CHF',1)`, [TA]);
    const r = await figMarktpreisMitHerkunft(FA, uid, null, 'N');
    assert.deepEqual({ preis: r.preis, geschaetzt: r.geschaetzt }, { preis: 7, geschaetzt: false });
  });

  await t.test('ohne BrickLink-Preis wird aus den Teilen geschätzt, im Zustand der Anfrage', async () => {
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`,
      [FB, JSON.stringify([{ part_num: TA, color_id: 777, quantity: 2 }, { part_num: TB, color_id: 777, quantity: 1 }])]);
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price)
                  VALUES ($1,777,'U','CHF',1.5) ON CONFLICT DO NOTHING`, [TA]);
    // Teil TA: Neu 1, Gebraucht 1.5; Teil TB ohne Preis → halbe Abdeckung.
    const neu = await figMarktpreisMitHerkunft(FB, uid, null, 'N');
    assert.deepEqual({ preis: neu.preis, geschaetzt: neu.geschaetzt, abdeckung: neu.abdeckung },
      { preis: 2, geschaetzt: true, abdeckung: 0.5 });
    const gebraucht = await figMarktpreisMitHerkunft(FB, uid, null, 'U');
    assert.equal(gebraucht.preis, 3, 'im Zustand der Anfrage');
  });

  await t.test('die Schätzung wird zwischengespeichert und fortgeschrieben', async () => {
    const z = await db.all(`SELECT condition, avg_price::float AS preis, geschaetzt FROM minifig_price_cache
                             WHERE fig_number = $1 ORDER BY condition`, [FB]);
    assert.deepEqual(z, [{ condition: 'N', preis: 2, geschaetzt: true }, { condition: 'U', preis: 3, geschaetzt: true }],
      'die Schätzung wird zwischengespeichert');
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM minifig_price_history WHERE fig_number=$1', [FB])).n, 2);
    // Ohne Teilepreise bleibt der gespeicherte Wert: kein neuer Abruf je Teil.
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TA]);
    assert.equal((await figMarktpreisMitHerkunft(FB, uid, null, 'N')).preis, 2);
  });

  await t.test('ohne ein bepreistes Teil gibt es keinen Preis, nicht 0', async () => {
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`,
      [FC, JSON.stringify([{ part_num: TB, color_id: 777, quantity: 3 }])]);
    assert.equal((await figMarktpreisMitHerkunft(FC, uid, null, 'N')).preis, null);
  });
});
