/**
 * Ein Lauf des Preis-Jobs hinterlässt GENAU EINEN Intervall-Timer.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Im Zweig „keine Sets vorhanden" rief runPriceRefresh() scheduleNext()
 * direkt — und der finally-Block tat es anschliessend nochmal. Ergebnis: zwei
 * Timer für denselben Lauf (am laufenden Job nachgezählt: 2 × 3600000 ms).
 *
 * Das ist kein blosser Schönheitsfehler. Jeder gefeuerte Timer startet einen
 * Lauf, und jeder Lauf stellt wieder Timer — die Zahl der geplanten Läufe
 * wächst also mit der Zeit, statt konstant zu bleiben. Der Job liefe
 * irgendwann deutlich häufiger als eingestellt und verbrennt das
 * BrickLink-Tageskontingent. Im Testlauf hielten die überzähligen Timer
 * ausserdem den Prozess am Leben, bis der Runner nach 60 s abbrach: Der TEST
 * war grün, die DATEI trotzdem rot.
 *
 * Gezählt werden nur lange Timer (≥ 60 s) — kurze gehören zum normalen
 * Ablauf (Wiederholungen, Entprellung) und sind hier nicht gemeint.
 *
 * Gegenprobe (durchgeführt): scheduleNext() im No-sets-Zweig wieder ergänzt →
 * dieser Test wird rot (2 statt 1).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('ein Lauf des Preis-Jobs stellt genau einen Intervall-Timer',
  { concurrency: 1 }, async (t) => {

  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Fake-Zugangsdaten: sonst bricht runPriceRefresh() vor dem eigentlichen
  // Ablauf ab. Leere sets-Tabelle: dann endet der Lauf im No-sets-Zweig, ohne
  // je das Netz anzufassen — genau der Zweig, um den es hier geht.
  await db.run(`INSERT INTO global_settings (key, value)
                VALUES ('bricklink_consumer_key','test-nur-fuer-diesen-test')
                ON CONFLICT (key) DO UPDATE SET value='test-nur-fuer-diesen-test'`);
  await db.run(`DELETE FROM sets`);

  const priceJob = _req('jobs/priceJob.js');

  const echterSetTimeout = global.setTimeout;
  const lange = [];
  global.setTimeout = function (fn, ms, ...rest) {
    const t = echterSetTimeout(fn, ms, ...rest);
    if (ms >= 60_000) lange.push(ms);
    return t;
  };

  try {
    const gestartet = await priceJob.triggerNow();
    assert.equal(gestartet, true, 'der Lauf muss starten (Sperre frei, Zugangsdaten gesetzt)');
    // Der Lauf ist kurz (keine Sets) — kurz warten, bis der finally-Block durch ist.
    await new Promise(r => echterSetTimeout(r, 1500));

    assert.equal(lange.length, 1,
      `ein Lauf darf genau EINEN Intervall-Timer stellen, gestellt wurden ${lange.length} (${lange.join(', ')} ms)`);
  } finally {
    global.setTimeout = echterSetTimeout;
    priceJob.stop();
    await db.run(`DELETE FROM global_settings
                  WHERE key='bricklink_consumer_key' AND value='test-nur-fuer-diesen-test'`).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
