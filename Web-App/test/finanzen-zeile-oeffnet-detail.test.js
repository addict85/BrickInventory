/**
 * Eine Teile- oder Figurenzeile der Finanzübersicht öffnet ihr Detail (#man-detail-modal), auch wenn in den
 * Reitern Teile und Minifiguren eine Suche steht: Die Finanztabelle zeigt den Bestand ohne diese Filter, das
 * Detail muss den Eintrag also auch ohne sie finden.
 *
 * Gegenprobe (am 07.11.2026 gemessen): openManDetail() in acquisition-modals.js wieder wie vorher —
 * fehlt der Eintrag im Cache, loadManualParts()/loadManualFigsTable() nachladen (mit Suche des Reiters)
 * → rot: „mit Suche in den Reitern“, Titel { teil: null, figur: null } (der Dialog blieb zu, es kam nur
 * /v1/parts/manual?search=Plate bzw. /v1/minifigs/manual?search=Marty). „ohne Filter“ blieb grün.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, ANMELDUNG } = require('./helpers/oberflaeche');

const teil = {
  id: 1,
  user_id: 1,
  part_number: '3001',
  color_id: 4,
  part_name: 'Brick 2 x 4',
  color_name: 'Red',
  quantity: 2,
  source: 'manual',
  avg_price: 0.5,
  wert_gesamt: 1,
  acquisitions: [],
};
const figur = {
  id: 2,
  user_id: 1,
  fig_number: 'fig-000002',
  fig_name: 'Doc Brown',
  quantity: 1,
  source: 'manual',
  avg_price: 3,
  wert_gesamt: 3,
  acquisitions: [],
};

// Wie der Server: Mit Suche (die nichts trifft) bleibt die Liste leer.
const gefiltert = (schluessel, eintrag) => url => ({
  success: true,
  [schluessel]: /[?&]search=/.test(String(url)) ? [] : [eintrag],
});

async function oeffne() {
  const o = await oeffneOberflaeche({
    '/v1/finance/parts-valuation': { ...ANMELDUNG['/v1/finance/parts-valuation'], parts: [teil], total_value: '1.00' },
    '/v1/finance/minifigs-valuation': {
      ...ANMELDUNG['/v1/finance/minifigs-valuation'],
      figs: [figur],
      total_value: '3.00',
    },
    '/v1/parts/manual': gefiltert('parts', teil),
    '/v1/minifigs/manual': gefiltert('figs', figur),
  });
  return o;
}

/** Zeile anklicken (nicht den Zeilenknopf) und den Dialogtitel zurückgeben; danach wieder schliessen. */
async function klicke(o, art) {
  const zeile = o.d.querySelector(`#fin-tbl [data-fin-art="${art}"] tbody tr[data-click="openManDetail"]`);
  assert.ok(zeile, `keine ${art}-Zeile in der Finanztabelle`);
  const m = o.d.getElementById('man-detail-modal');
  zeile.querySelector('td.fin-wert').click();
  const offen = await warte(() => m.classList.contains('open'), 2000);
  const titel = o.d.getElementById('man-detail-tit').textContent;
  if (offen) m.querySelector('[data-click="closeManDetail"]').click();
  await o.ruhig();
  return offen ? titel : null;
}

for (const [fall, suche] of [
  ['ohne Filter', false],
  ['mit Suche in den Reitern', true],
]) {
  test(`Finanzen: Teile- und Figurenzeile öffnen das Detail (${fall})`, async () => {
    const o = await oeffne();
    try {
      if (suche) {
        o.d.getElementById('parts-search').value = 'Plate';
        o.d.getElementById('fig-search').value = 'Marty';
      }
      await reiter(o.w, 'finance');
      assert.ok(
        await warte(() => o.d.querySelectorAll('#fin-tbl tr[data-click="openManDetail"]').length === 2, 3000),
        'Testdaten: je eine Teile- und Figurenzeile',
      );
      await o.ruhig();
      const titel = { teil: await klicke(o, 'parts'), figur: await klicke(o, 'figs') };
      assert.deepEqual(titel, { teil: 'Brick 2 x 4', figur: 'Doc Brown' }, 'jede Zeile öffnet ihr eigenes Detail');
      const urls = o.aufrufe.map(a => a.url);
      assert.ok(
        urls.some(u => u.includes('/v1/parts/3001/4/acquisitions')),
        'Kaufpreise des Teils geladen',
      );
      assert.ok(
        urls.some(u => u.includes('/v1/minifigs/fig-000002/acquisitions')),
        'Kaufpreise der Figur geladen',
      );
      assert.deepEqual(o.fehler, []);
    } finally {
      o.w.close();
    }
  });
}
