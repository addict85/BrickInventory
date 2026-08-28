/**
 * Die Portfoliokurve gehört zum GEWÄHLTEN Konto, nicht zum Betrachter.
 *
 * ── Woher dieser Test kommt (Marcos Fund, Nachtrag 78) ──────────────────────
 * „Wenn ich meinen Account wähle oder ein anderes Unterkonto, wird immer
 * -0,5 % angezeigt."
 *
 * Ursache: Der Schlüssel des Portfolio-Schnappschusses hing an der ID des
 * BETRACHTERS (`'__portfolio__' + viewerId`). Wählte das Hauptkonto im Filter
 * ein Unterkonto, wurde trotzdem der eigene Schnappschuss gelesen — gleiche
 * Kurve, gleicher Prozentwert, egal was im Filter stand. Der Filter sah aus,
 * als täte er nichts, und genau so hat Marco es beschrieben.
 *
 * Die Aussage gilt unverändert, der WEG dahin nicht mehr: Seit Nachtrag 82
 * gibt es die Portfolio-Schnappschüsse nicht mehr. Sie hielten fest, was AN
 * JENEM TAG erfasst war, und konnten die Frage „was wäre der heutige Bestand
 * damals wert gewesen" grundsätzlich nicht beantworten — daran hing Marcos
 * zweiter Fund, die +850 % durch neu erfasste Sets. Die Kurve wird jetzt für
 * jede Kontoauswahl aus dem Preisverlauf JE SET rekonstruiert.
 *
 * Dieser Test prüft deshalb dasselbe an den Beständen statt an den
 * Schnappschüssen: Jedes Konto hat ein eigenes Set mit eigenem Preis, und wer
 * im Filter steht, entscheidet, welches davon in der Kurve landet.
 *
 * Gegenprobe (durchgeführt): in getPortfolioHistory statt `ids` wieder
 * `viewerId` als Blickfeld benutzt → beide Kurven werden gleich.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('die Portfoliokurve folgt dem gewählten Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `vh-${process.pid}`, SUB = `vs-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);
  for (const u of [hauptId, subId])
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [u]);

  // Jedes Konto braucht Bestand, sonst entsteht gar keine Kurve.
  const SN_H = `9991-${process.pid}`, SN_S = `9992-${process.pid}`;
  await db.run(`DELETE FROM sets WHERE set_number IN ($1,$2)`, [SN_H, SN_S]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                VALUES ($1,$2,'A',1,'N',100)`, [hauptId, SN_H]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                VALUES ($1,$2,'B',1,'N',200)`, [subId, SN_S]);

  // Deutlich verschiedene Preise — bei einer Verwechslung fällt es auf.
  await db.run(`DELETE FROM price_history WHERE set_number IN ($1,$2)`, [SN_H, SN_S]);
  for (const [sn, basis] of [[SN_H, 1000], [SN_S, 5000]]) {
    for (let tag = 3; tag >= 0; tag--) {
      await db.run(
        `INSERT INTO price_history (set_number,currency_code,condition,qty_avg_price,avg_price,recorded_at)
         VALUES ($1,'CHF','N',$2,$2, NOW() - ($3 || ' days')::interval)`,
        [sn, basis + tag, String(tag)]);
    }
  }

  const { getPortfolioHistory } = _req('utils/portfolioHistory.js');
  const { getSetting } = _req('utils/settings.js');
  const kurve = async (uids) => {
    // Betrachter ist IMMER das Hauptkonto — genau darum geht es.
    const r = await getPortfolioHistory(hauptId, uids, 'week', db, getSetting);
    return (r?.points || []).map(p => p.value);
  };

  try {
    const eigen = await kurve([hauptId]);
    const fremd = await kurve([subId]);

    assert.ok(eigen.length && fremd.length, 'beide Kurven müssen Punkte haben');
    assert.ok(eigen[eigen.length - 1] >= 1000 && eigen[eigen.length - 1] < 2000,
      `die eigene Kurve muss den eigenen Bestand zeigen, war: ${eigen.join(',')}`);
    assert.ok(fremd[fremd.length - 1] >= 5000,
      `die Kurve des Unterkontos muss dessen Bestand zeigen, war: ${fremd.join(',')} — ` +
      'bei gleichen Werten wie oben hängt das Blickfeld wieder am Betrachter');
    assert.notDeepEqual(eigen, fremd,
      'Beide Konten liefern dieselbe Kurve — der Filter wirkt dann nicht');
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.run(`DELETE FROM price_history WHERE set_number IN ($1,$2)`, [SN_H, SN_S]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number IN ($1,$2)`, [SN_H, SN_S]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
