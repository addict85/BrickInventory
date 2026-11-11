/**
 * Beide Oberflächen rechnen keine Geldbeträge nach.
 *
 * Gegenproben (08.11.2026 gemessen): in finance.js den Gesamtwert wieder
 * selbst addieren (`const grandTotal = setsQtyAvg + extra`) → rot: „die
 * Webapp zeigt den Gesamtwert des Servers“. Dass der Server ihn liefert,
 * prüft geschenk-guv-db.test.js („der Gesamtwert kommt fertig …“, C).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

/** Feldnamen, deren Summe eine Geschäftsregel wäre. */
const GELDFELDER =
  'display_value|total_value|purchase_price|unit_price|current_price|avg_price|qty_avg_price|market_price|price';

/**
 * Stellen, die eine Summe bilden DÜRFEN — mit Begründung.
 *
 * Kurz halten: Jede Zeile hier ist eine Ausnahme von der Regel und sollte
 * erklären, warum der Server sie nicht liefern kann.
 */
const ERLAUBT = [
  // Fortschrittsbalken rechnen Prozent aus done/total — kein Geld.
];

test('die Webapp summiert keine Geldbeträge selbst', () => {
  const dir = path.join(ROOT, 'public', 'js');
  const treffer = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'app.bundle.js')) {
    const src = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    const re = new RegExp(String.raw`reduce\((?:\([^)]*\)|\w+)\s*=>[^;]{0,120}?\.(${GELDFELDER})\b`, 'g');
    for (const m of src.matchAll(re)) {
      const zeile = src.slice(0, m.index).split('\n').length;
      const eintrag = `${f}:${zeile} summiert .${m[1]}`;
      if (!ERLAUBT.includes(eintrag)) treffer.push(eintrag);
    }
  }
  assert.deepEqual(treffer, [],
    'Die Oberfläche bildet eine Geldsumme selbst:\n  ' + treffer.join('\n  ') +
    '\nDer Server liefert solche Summen fertig (total_value, totals.grand_total). ' +
    'Zwei Rechenwege bedeuten zwei Ergebnisse, sobald sich die Regel ändert.');
});

test('die Webapp zeigt den Gesamtwert des Servers', async () => {
  // Ohne Marktpreis bei den Posten trägt die Kopfzahl den Gesamtwert; der Server sagt 777,
  // die eigene Summe der Tabellen wäre 0.
  const { w, d } = await oeffneOberflaeche({
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { purchase: '0', current: '777.00', grand_total: '777.00' } },
  });
  try {
    await reiter(w, 'finance');
    assert.ok(await warte(() => /777/.test(d.getElementById('portfolio-current')?.textContent || '')),
      `Kopfzahl: ${d.getElementById('portfolio-current')?.textContent}`);
  } finally { w.close(); }
});
