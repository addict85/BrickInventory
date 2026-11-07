/**
 * Finanzen mit vielen Positionen (UI-Prüfung 17, Abläufe M16), echtes Bündel
 * in jsdom:
 *   - 250 Sets zeigen höchstens 100 Zeilen; kommt das Tabellenende in Sicht
 *     (Markierung #fin-sentinel), folgt der nächste Block, bis alles da ist.
 *   - Die Suche filtert über alle Positionen, nicht nur die gezeigten.
 *   - Die Köpfe Name/Kaufpreis/Wert/G&V sind Knöpfe mit aria-sort; ein Klick
 *     sortiert, ein zweiter dreht die Richtung.
 *   - Die Legende zeigt ihre Zeichen als Markup, nicht als Text „<span“.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  FIN_BLOCK = 100000 → rot: „blockweise beim Scrollen“
 *   E  (07.11.2026) in finSentinelBinden() den Beobachter nicht angelegt →
 *      rot: „blockweise beim Scrollen“ (Zeilen bleiben bei 100)
 *   B  in zeichneFinanzTabellen die Zeile `if (_finSort.feld) sets.sort(…)`
 *      entfernt → rot: „Sortierköpfe mit aria-sort“
 *   C  passt() liefert immer true → rot: „Suche über alle Positionen“
 *   D  ungeprueft() um tRaw('finance.legende') entfernt → rot: „Legende
 *      zeigt Zeichen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, reiter } = require('./helpers/oberflaeche');

function sets(n) {
  return Array.from({ length: n }, (_, i) => {
    const nr = String(10000 + i);
    const wert = 10 + i;
    return {
      set_number: `${nr}-1`,
      name: i === 217 ? 'Seltene Burg' : `Set ${nr}`,
      quantity: 1,
      avg_price: wert,
      wert_gesamt: wert,
      from_cache: true,
      is_fallback: false,
      no_price: false,
      mixed: false,
      purchase_price: 5 + (i % 7),
      pnl_prozent: i % 13,
      acquisitions: [],
    };
  });
}

async function oeffneFinanzen(anzahl) {
  const liste = sets(anzahl);
  const o = await oeffneOberflaeche(
    {
      '/v1/finance/valuation': {
        success: true,
        currency: 'EUR',
        condition: 'N',
        total_value: '1',
        kaufpreise_fremde_waehrung: 0,
        totals: { min: '0', avg: '1', max: '0', qty_avg: '1' },
        sets: liste,
      },
      '/v1/finance/pnl': {
        success: true,
        currency: 'EUR',
        sets: [],
        totals: {
          purchase: '1',
          current: '1',
          kaufpreise_fremde_waehrung: 0,
          positionen: anzahl,
          positionen_bewertet: anzahl,
          positionen_ohne_marktpreis: 0,
          positionen_ohne_kaufpreis: 0,
          basis_einstand: '1',
          basis_marktwert: '1',
          basis_guv_betrag: '0',
          pnl_prozent: 0,
        },
      },
    },
    { browserSprache: 'de-DE' },
  );
  // jsdom kennt kein Scrollen: Die Beobachter werden mitgeschrieben, der Test meldet „in Sicht“ selbst.
  o.beobachter = [];
  o.w.IntersectionObserver = class {
    constructor(rueckruf) {
      this.rueckruf = rueckruf;
      o.beobachter.push(this);
    }
    observe(el) {
      this.el = el;
    }
    unobserve() {}
    disconnect() {
      this.getrennt = true;
    }
  };
  await reiter(o.w, 'finance');
  await warte(() => o.d.querySelectorAll('#fin-tbl tbody tr[data-arg]').length > 0, 4000);
  return o;
}
/** Das Tabellenende kommt in Sicht: Der letzte lebende Beobachter der Markierung meldet es. */
function inSicht(o) {
  const b = o.beobachter.filter(x => !x.getrennt && x.el?.id === 'fin-sentinel').at(-1);
  if (!b) return false;
  b.rueckruf([{ isIntersecting: true }]);
  return true;
}
const zeilen = o => [...o.d.querySelectorAll('#fin-tbl [data-fin-art="sets"] tbody tr[data-arg]')];

test('blockweise beim Scrollen', async () => {
  const o = await oeffneFinanzen(250);
  try {
    assert.equal(zeilen(o).length, 100);
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null, 'der Weitere-Knopf ist weg');
    assert.ok(inSicht(o), 'keine Markierung am Tabellenende');
    await takt(10);
    assert.equal(zeilen(o).length, 200);
    assert.ok(inSicht(o));
    await takt(10);
    assert.equal(zeilen(o).length, 250);
    assert.equal(o.d.getElementById('fin-sentinel'), null, 'am Ende keine Markierung mehr');
  } finally {
    o.w.close();
  }
});

test('Suche über alle Positionen', async () => {
  const o = await oeffneFinanzen(250);
  try {
    const feld = o.d.getElementById('fin-suche');
    assert.ok(feld.labels?.length || feld.getAttribute('aria-label'), 'Suchfeld ohne Namen');
    feld.value = 'seltene';
    feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.ok(await warte(() => zeilen(o).length === 1, 1500), `Zeilen: ${zeilen(o).length}`);
    assert.equal(zeilen(o)[0].dataset.arg, '10217-1', 'Treffer liegt hinter dem ersten Block');
    assert.equal(o.d.querySelector('#fin-tbl [data-click="finMehr"]'), null);
  } finally {
    o.w.close();
  }
});

test('Sortierköpfe mit aria-sort', async () => {
  const o = await oeffneFinanzen(30);
  try {
    const koepfe = [...o.d.querySelectorAll('#fin-tbl [data-fin-art="sets"] th[aria-sort]')];
    assert.ok(koepfe.length >= 3, `sortierbare Köpfe: ${koepfe.length}`);
    const knopf = () => o.d.querySelector('#fin-tbl [data-click="finSortiere"][data-arg="wert"]');
    knopf().click();
    await takt(10);
    assert.equal(knopf().closest('th').getAttribute('aria-sort'), 'descending');
    assert.equal(zeilen(o)[0].dataset.arg, '10029-1', 'höchster Wert zuerst');
    assert.equal(o.d.activeElement, knopf(), 'Fokus bleibt auf dem Kopf');
    knopf().click();
    await takt(10);
    assert.equal(knopf().closest('th').getAttribute('aria-sort'), 'ascending');
    assert.equal(zeilen(o)[0].dataset.arg, '10000-1');
  } finally {
    o.w.close();
  }
});

test('Legende zeigt Zeichen', async () => {
  const o = await oeffneFinanzen(3);
  try {
    const legende = o.d.querySelector('#fin-tbl .fin-legende');
    assert.ok(legende, 'Legende fehlt');
    assert.doesNotMatch(legende.textContent, /<span/);
    assert.equal(legende.querySelectorAll('.legende-zeichen').length, 3);
  } finally {
    o.w.close();
  }
});
