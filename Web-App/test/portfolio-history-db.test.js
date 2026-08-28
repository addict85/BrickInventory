/**
 * Portfolio-Kurve: Rechnet die SQL-Fassung dasselbe wie eine unabhängige
 * JavaScript-Fassung derselben Regel?
 *
 * ── Warum dieser Test die Vergleichsfassung selbst mitbringt ────────────────
 * Die Rekonstruktion liegt in der Datenbank (Fortschreibung über Differenzen
 * statt über ein carry-Objekt). Ein Test, der nur „liefert Punkte" prüft,
 * würde eine verschobene Kurve nicht bemerken. Deshalb steht die Regel hier
 * ein zweites Mal, geradeheraus in JavaScript, und beide müssen auf denselben
 * Daten dasselbe ergeben.
 *
 * Die Vergleichsfassung ist bewusst eine Kopie und kein Import: Sie soll sich
 * NICHT mitändern, wenn jemand die Umsetzung anfasst.
 *
 * ── Die Regel hat sich geändert (Nachtrag 82, Marcos Fund) ──────────────────
 * „Neu hinzugefügte Sets sollen nicht dazu führen, dass sich der %-Wert
 * ändert. Die +850.2% sind offensichtlich nicht korrekt."
 *
 * Vorher zeigte die Kurve „Wert dessen, was zu diesem Zeitpunkt erfasst WAR" —
 * ein Set trat an dem Tag in die Summe ein, an dem sein Preisverlauf begann.
 * Wer an einem Tag zwei Dutzend Sets erfasste, sah dort einen Sprung, und die
 * Prozentzahl daneben meldete den Zuwachs der SAMMLUNG als Wertentwicklung.
 *
 * Jetzt zeigt sie „was der HEUTIGE Bestand über die Zeit wert gewesen wäre":
 * Jedes Set steht mit seinem ERSTEN bekannten Preis von Anfang an im Korb.
 * Die Vergleichsfassung unten bildet genau das ab — der Unterschied zur
 * früheren ist die Vorbelegung von `carry`.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

/** Dieselbe Regel geradeheraus: Tageswerte laden, in JS gruppieren, fortschreiben. */
async function vergleichsFassung(setNumbers, setQty, currency, condition, dateFilter) {
  const platzhalter = setNumbers.map((_, i) => `$${i + 3}`).join(',');
  const rows = await db.all(
    `SELECT set_number, qty_avg_price, avg_price,
            to_char(recorded_at,'YYYY-MM-DD') AS day,
            to_char(recorded_at,'YYYY-MM')    AS month
     FROM price_history
     WHERE currency_code=$1 AND condition IN ('U','N') AND set_number IN (${platzhalter})
       AND (qty_avg_price>0 OR avg_price>0)
     ${dateFilter} ORDER BY recorded_at ASC, (condition = $2) ASC`,
    [currency, condition, ...setNumbers]);

  const buckets = {};
  for (const r of rows) {
    const k = r.day;
    if (!buckets[k]) buckets[k] = { day: r.day, month: r.month, sets: {} };
    const p = parseFloat(r.avg_price || 0) || parseFloat(r.qty_avg_price || 0);
    if (p > 0) buckets[k].sets[r.set_number] = p;
  }
  // Rückschreibung: Jedes Set steht mit seinem ERSTEN bekannten Preis von
  // Anfang an im Korb. Rückwärts über die Tage laufen und zuweisen lässt am
  // Ende je Set den frühesten Wert stehen — das ist die ganze Änderung
  // gegenüber der früheren Fassung, die hier mit einem leeren carry begann.
  const carry = {};
  for (const k of Object.keys(buckets).sort().reverse()) Object.assign(carry, buckets[k].sets);

  let punkte = Object.keys(buckets).sort().map(k => {
    const b = buckets[k];
    Object.assign(carry, b.sets);
    const total = Object.entries(carry).reduce((s, [sn, p]) => s + p * (setQty[sn] || 1), 0);
    return { day: b.day, fullDay: b.day, month: b.month, total: parseFloat(total.toFixed(2)) };
  }).filter(p => p.total > 0);

  // Verdichtung wie früher: erst ab 120 Punkten, letzter Punkt je Monat, der
  // allererste Punkt bleibt exakt erhalten.
  if (punkte.length > 120) {
    const byMonth = new Map();
    for (const p of punkte) byMonth.set(p.month || p.day.slice(0, 7), p);
    const monatlich = [...byMonth.values()].map(p => ({ ...p, day: p.month || p.day.slice(0, 7) }));
    const erster = punkte[0];
    if (monatlich.length && monatlich[0].fullDay !== erster.fullDay) {
      monatlich[0] = { ...erster, day: erster.month || erster.day.slice(0, 7) };
    }
    punkte = monatlich;
  }
  return punkte;
}

test('die Portfolio-Kurve rechnet dasselbe wie die Vergleichsfassung', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  const { getPortfolioHistory } = _req('utils/portfolioHistory.js');
  const getSetting = async (_u, k, d) => (k === 'currency' ? 'CHF' : d);

  await db.run("INSERT INTO users (username,password_hash) VALUES ('ph_a','x'),('ph_b','x')");
  const [u1, u2] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  // 30 Sets, hälftig auf zwei Haushaltskonten, verschiedene Mengen.
  await db.run(
    `INSERT INTO sets (user_id, set_number, name, quantity, purchase_price)
     SELECT (CASE WHEN g%2=0 THEN $1::int ELSE $2::int END), (10000+g)||'-1', 'Set '||g, 1 + (g%3), 40
       FROM generate_series(1,30) g`, [u1, u2]);

  // Preisverlauf mit LÜCKEN: Ein Set schreibt nur jeden dritten Tag. Genau
  // dort trennt sich Fortschreibung von einfacher Tagessumme — ohne Lücken
  // wäre der Vergleich wertlos.
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'N', 'CHF', 30 + g + d*0.1, 31 + g,
            (CURRENT_DATE - (400 - d))::timestamptz + interval '9 hours'
       FROM generate_series(1,30) g, generate_series(1,400) d
      WHERE (d + g) % 3 = 0`);
  // Einzelne Tage zusätzlich mit einem zweiten Zustand und späterer Uhrzeit —
  // prüft, welcher Wert je Tag gewinnt.
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'U', 'CHF', 20 + g, 21 + g,
            (CURRENT_DATE - (400 - d))::timestamptz + interval '18 hours'
       FROM generate_series(1,10) g, generate_series(1,400) d
      WHERE (d + g) % 3 = 0 AND d % 7 = 0`);

  const setsRows = await db.all('SELECT set_number, quantity FROM sets ORDER BY set_number');
  const setNumbers = setsRows.map(r => r.set_number);
  const setQty = Object.fromEntries(setsRows.map(r => [r.set_number, r.quantity]));

  const filter = {
    week:  "AND recorded_at >= NOW() - INTERVAL '7 days'",
    month: "AND recorded_at >= NOW() - INTERVAL '30 days'",
    year:  "AND recorded_at >= NOW() - INTERVAL '365 days'",
    max:   '',
  };

  for (const period of ['week', 'month', 'year', 'max']) {
    await t.test(`Zeitraum ${period}: gleiche Punkte wie die Vergleichsfassung`, async () => {
      const alt = await vergleichsFassung(setNumbers, setQty, 'CHF', 'N', filter[period]);
      const neu = await getPortfolioHistory(u1, [u1, u2], period, db, getSetting);

      assert.equal(neu.points.length, alt.length,
        `andere Anzahl Punkte: ${neu.points.length} statt ${alt.length}`);

      // Die Route liefert {x_label, value, y_frac} — verglichen werden die
      // WERTE in ihrer Reihenfolge.
      for (let i = 0; i < alt.length; i++) {
        const a = alt[i], n = neu.points[i];
        // Rundung: die alte Fassung rechnete in JS-Gleitkomma, die neue in
        // NUMERIC. Ein Rappen Unterschied ist erlaubt, mehr nicht.
        assert.ok(Math.abs(n.value - a.total) <= 0.01,
          `Punkt ${i} (${a.day}): ${n.value} statt ${a.total}`);
      }
    });
  }

  await t.test('ohne Preisverlauf bleibt die Kurve leer statt zu stürzen', async () => {
    await db.run('DELETE FROM price_history');
    await db.run('DELETE FROM price_cache');
    const r = await getPortfolioHistory(u1, [u1, u2], 'max', db, getSetting);
    assert.equal(Array.isArray(r.points), true);
  });

  // Der Pool bleibt offen — der zweite Test in dieser Datei arbeitet auf
  // demselben Schema weiter und schliesst ihn am Ende.
});

test('ein Preiseintrag je Set, Zustand, Währung und Tag', { concurrency: 1 }, async (t) => {
  const db2 = _req('db/database.js');
  try { await db2.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await t.test('doppelte Einträge desselben Tages werden abgewiesen', async () => {
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','N','CHF',10,10)`);
    // Genau die Klausel, die vorher ins Leere lief: Ohne passenden
    // Unique-Index legte sie stillschweigend eine zweite Zeile an.
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','N','CHF',99,99) ON CONFLICT DO NOTHING`);
    const n = await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='99999-1'`);
    assert.equal(n.c, 1, 'zweite Zeile desselben Tages angelegt — ON CONFLICT greift nicht');
  });

  await t.test('ein anderer Zustand am selben Tag ist erlaubt', async () => {
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','U','CHF',8,8) ON CONFLICT DO NOTHING`);
    const n = await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='99999-1'`);
    assert.equal(n.c, 2, 'Neu und Gebraucht müssen nebeneinander stehen dürfen');
  });

  await t.test('das Aufräumen entfernt alte Zeilen — auch die alten Schnappschüsse', async () => {
    // Die Ausnahme für '__portfolio__<id>' ist mit Nachtrag 82 entfallen: Es
    // gibt die Schnappschüsse nicht mehr, und Zeilen aus der Zeit davor sollen
    // von der Aufbewahrungsfrist wegkommen wie alles andere. Eine Ausnahme, die
    // nichts mehr schützt, hält nur noch Daten fest.
    const { purgeAltePreise } = _req('utils/priceHistory.js');
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                   VALUES ('88888-1','N','CHF',5,5, NOW() - INTERVAL '4000 days'),
                          ('__portfolio__1','N','CHF',7,7, NOW() - INTERVAL '4000 days')`);
    process.env.PRICE_HISTORY_KEEP_DAYS = '1095';
    const weg = await purgeAltePreise();
    assert.ok(weg >= 2, `nicht alles entfernt: ${weg}`);
    for (const sn of ['88888-1', '__portfolio__1'])
      assert.equal((await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number=$1`, [sn])).c, 0,
        `alte Zeile ${sn} blieb liegen`);
  });

  await t.test('PRICE_HISTORY_KEEP_DAYS=0 schaltet das Aufräumen ab', async () => {
    const { purgeAltePreise } = _req('utils/priceHistory.js');
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                   VALUES ('77777-1','N','CHF',5,5, NOW() - INTERVAL '4000 days')`);
    process.env.PRICE_HISTORY_KEEP_DAYS = '0';
    assert.equal(await purgeAltePreise(), 0);
    assert.equal((await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='77777-1'`)).c, 1);
    delete process.env.PRICE_HISTORY_KEEP_DAYS;
  });

  await db2.pool.end().catch(() => {});
});

test('der Mailer prüft Zertifikate, sofern es niemand ausdrücklich abschaltet', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'routes', 'mailer.ts'), 'utf8'));

  assert.doesNotMatch(src, /rejectUnauthorized:\s*false/,
    'Zertifikatsprüfung fest abgeschaltet — SMTP-Zugangsdaten und Rücksetz-Links gehen über eine ungeprüfte Verbindung');
  assert.match(src, /rejectUnauthorized:\s*!/, 'die Prüfung hängt an keiner Einstellung');
  assert.match(src, /smtp_insecure_tls/, 'die Ausnahme ist nicht einstellbar');

  // Die Einstellung muss auch gespeichert werden können, sonst steht ein
  // Kontrollkästchen da, das nichts tut.
  const settings = ohneKommentare(fs.readFileSync(path.join(ROOT, 'routes', 'settings.ts'), 'utf8'));
  const stellen = (settings.match(/smtp_insecure_tls/g) || []).length;
  assert.ok(stellen >= 2, `smtp_insecure_tls steht nur an ${stellen} Stelle(n) in settings.ts — Speichern oder Export fehlt`);
});
