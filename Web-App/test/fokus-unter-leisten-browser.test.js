/**
 * Wächter für WCAG 2.4.11 (Fokus nicht verdeckt): Ein Tab-Gang durch die
 * Hauptansichten, bei 390 px und bei 320 px mit 200 % Browserschrift. Kein
 * fokussiertes Bedienelement darf zu mehr als 20 % unter Kopf, unterer
 * Leiste oder schwebendem Knopf liegen (oder ausserhalb des Fensters).
 * axe prüft das nicht.
 *
 * Gegenproben (04.11.2026 gemessen):
 *   A  die Regel html{scroll-padding-…} in styles.css entfernt → rot bei 390 px:
 *      Sammlung, Teile, Konto, Gutscheine, Preisalarme; bei 320/200 %:
 *      Sammlung, Teile, Merkliste, Bauliste, Konto, Gutscheine (je 64–100 %)
 *   B  leistenMessen() mit fester Leistenhöhe 60 px statt gemessen → rot bei
 *      320/200 %: Sammlung, Merkliste, Gutscheine (die Leiste ist dort 116 px hoch)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const ANSICHTEN = ['sammlung', 'teile', 'finanzen', 'merkliste', 'bauliste', 'konto', 'gutscheine', 'alarme'];

/** Anteil des fokussierten Elements, den feste Leisten oder der Fensterrand verdecken. */
const MESSUNG = `(() => {
  const e = document.activeElement;
  if (!e || !e.closest('main') || e.closest('.ovl')) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const schnitt = (q) => Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
  const leisten = [document.querySelector('header'), document.querySelector('nav:not(.einst-nav)'), ...document.querySelectorAll('.tab.active .knopf-schwebend')]
    .filter(l => l && l !== e && !l.contains(e) && /fixed|sticky/.test(getComputedStyle(l).position) && l.checkVisibility());
  const flaeche = r.width * r.height;
  const imFenster = schnitt({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
  const verdeckt = leisten.reduce((s, l) => s + schnitt(l.getBoundingClientRect()), 0);
  const name = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' „' + (e.getAttribute('aria-label') || e.textContent || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 30) + '“';
  return { name, anteil: Math.min(1, (flaeche - imFenster + verdeckt) / flaeche), hoch: r.height };
})()`;

async function tabGang(app, ansicht) {
  const { b, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  await b.auswerten(`location.hash = '#/${ansicht}'; true`);
  await ruhig();
  await app
    .bis(`!document.querySelector('.tab.active .skelett-zeile, .skelett-raster')`, 'geladen', 60)
    .catch(() => {});
  await b.auswerten(`scrollTo(0, 0); document.getElementById('inhalt').focus({ preventScroll: true }); true`);
  const funde = [];
  let gesehen = 0;
  for (let i = 0; i < 70; i++) {
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    const m = await b.auswerten(MESSUNG);
    if (!m) {
      if (gesehen && !(await b.auswerten(`!!document.activeElement?.closest('main')`))) break;
      continue;
    }
    gesehen++;
    // Was höher als das halbe Fenster ist, passt ohnehin nicht ganz hinein.
    if (m.anteil > 0.2 && m.hoch < 0.5 * (await b.auswerten('innerHeight')))
      funde.push(`${m.name} ${Math.round(m.anteil * 100)} %`);
  }
  return { funde: [...new Set(funde)], gesehen };
}

test('Fokus unter festen Leisten', { concurrency: 1, timeout: 400_000 }, async t => {
  const app = await starteApp(t, { name: `fokl_${process.pid}`, bestand: musterHaushalt });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b } = app;
  for (const [breite, hoehe, gross] of [
    [390, 844, false],
    [320, 640, true],
  ]) {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: hoehe,
      deviceScaleFactor: 1,
      mobile: true,
    });
    if (gross) await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    for (const ansicht of ANSICHTEN) {
      const { funde, gesehen } = await tabGang(app, ansicht);
      await t.test(`${breite} px${gross ? ', 200 %' : ''}: ${ansicht}`, () => {
        // Die leere Bauliste hat seit Runde 24 nur Feld und „Hinzufügen“ („Neu berechnen“ erst mit Set).
        const mindestens = ansicht === 'bauliste' ? 2 : 3;
        assert.ok(gesehen >= mindestens, `nur ${gesehen} Elemente erreicht — greift der Tab-Gang?`);
        assert.deepEqual(funde, []);
      });
    }
  }
});
