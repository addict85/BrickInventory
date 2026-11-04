/**
 * Finanztabelle am Rechner: Die Summe lässt sich aus der sichtbaren Spalte
 * nachrechnen, und kein Tabellenkopf bricht um (1280 und 1440 px, DE und EN).
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in setRow wieder `fmtGeld(purchase,cur)` statt einstandZelle → rot:
 *      „Einstand: Spalte ergibt die Summe“ (Spalte 250 €, Summe 300 €)
 *   B  Statusspalte der Sets wieder sp-40 und `.dt-fin th{white-space:nowrap;…}`
 *      entfernt → rot: „Köpfe in einer Zeile“ („Preis“ zweizeilig)
 *   C  in preisKoepfe() wieder der volle Kopf t('finance.total_pnl') → rot:
 *      „Köpfe in einer Zeile“ (de 1280: Gewinn/Verlust ragt über die Spalte)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

/** Sichtbarer Text (ohne .vh), der umbricht oder über die Zelle ragt. */
const UMBRUCH = `[...document.querySelectorAll('.dt-fin thead th, .dt-summe thead th')].filter(e => e.getClientRects().length).map(th => {
  const tops = new Set(); let rechts = 0; const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim() || n.parentElement.closest('.vh')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) { tops.add(Math.round(q.top)); rechts = Math.max(rechts, q.right); } }
  const zelle = th.getBoundingClientRect();
  return (tops.size > 1 || rechts > zelle.right + 0.5) ? th.textContent.trim() + ': ' + tops.size + ' Zeilen' : null; }).filter(Boolean)`;

test('Finanztabelle nachrechenbar und ohne Umbruch im Kopf', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `fintab_${process.pid}`,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10294-1', 2, { preis: 100 });
      await haeltSet(db, uid, '75192-1', 1, { preis: 50 });
      for (const [nr, p] of [['10294-1', 120], ['75192-1', 60]])
        await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                      VALUES ($1, 'N', 'EUR', $2, $2, $2, $2, 10, NOW()) ON CONFLICT DO NOTHING`, [nr, p]).catch(() => {});
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const groesse = async (w) => { await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }); await warte(300); };
  await warte(1200);
  await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
  await b.auswerten(`location.hash = '#/finanzen'; true`);
  await bis(`document.querySelectorAll('[data-fin-art="sets"] tbody tr').length === 2`, 'Sets in der Finanztabelle');

  await t.test('Einstand: Spalte ergibt die Summe', async () => {
    const m = await b.auswerten(`(() => {
      const tab = document.querySelector('[data-fin-art="sets"] table');
      const spalte = [...tab.querySelectorAll('thead th')].findIndex(th => th.textContent.trim() === 'Kaufpreis');
      const zahl = s => Number(s.replace(/\\D/g, '')) / 100;
      const zellen = [...tab.querySelectorAll('tbody tr')].map(tr => tr.children[spalte]);
      return { spalte, zeilen: zellen.map(z => zahl(z.firstChild.textContent)), je: zellen.map(z => z.querySelector('.fin-je')?.textContent || ''),
               summe: zahl(tab.querySelector('tfoot .fin-fuss-wert').textContent) }; })()`);
    assert.ok(m.spalte > 0, 'Spalte „Einstand“ fehlt');
    assert.deepEqual(m.zeilen.slice().sort((a, b) => a - b), [50, 200]);
    assert.equal(m.zeilen.reduce((a, b) => a + b, 0), m.summe);
    assert.ok(m.je.some(j => /^je .*100[.,]00/.test(j)), `Stückpreis fehlt: ${JSON.stringify(m.je)}`);
  });

  await t.test('Köpfe in einer Zeile', async () => {
    const fehler = [];
    for (const sprache of ['de', 'en']) {
      if (sprache === 'en') {
        await b.auswerten(`(() => { const s = document.getElementById('lang-select'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await bis(`document.documentElement.lang === 'en'`, 'Englisch');
        await b.auswerten(`location.hash = '#/sammlung'; true`); await warte(300);
        await b.auswerten(`location.hash = '#/finanzen'; true`);
        await bis(`document.querySelectorAll('[data-fin-art="sets"] tbody tr').length === 2 && /Purchase price/.test(document.querySelector('.dt-fin thead').textContent)`, 'englische Finanztabelle');
      }
      for (const w of [1280, 1440]) {
        await groesse(w);
        for (const f of await b.auswerten(UMBRUCH)) fehler.push(`${sprache} ${w}: ${f}`);
      }
    }
    assert.deepEqual(fehler, []);
  });
});
