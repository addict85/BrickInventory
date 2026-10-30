/**
 * Die ganze Oberfläche in Chrome, für ein Design und ein Gerät (Rechner
 * 1280 × 900 oder Telefon 390 × 844), hell und dunkel: jeder Reiter, alle
 * Abschnitte der Einstellungen, die Seiten hinter dem Menü und die
 * wichtigsten Dialoge. Je Zustand:
 *   - axe-core: kein Verstoss der Stufe serious oder critical;
 *   - Layout (layout-messung.js): kein waagrechter Überlauf, am Telefon jedes
 *     Tippziel ≥ 44 × 44 px, keine überlappenden Bedienelemente, kein
 *     abgeschnittener Text ohne „…“, Text und Platzhalter ≥ 4,5:1 (gross 3:1).
 * Gemessen werden Eigenschaften statt Bilder: Pixelvergleiche hingen an den
 * Schriften der Maschine. Je Design und Gerät eine Testdatei, damit jede
 * unter der Zeitgrenze einer Datei (60 s) bleibt.
 *
 * Gegenproben (30.10.2026, zusammen angewendet; welche Datei rot war, steht
 * in ihrem Kopf):
 *   A  .v-btn aus der 44-px-Regel in mobile.css → „Sicht gutscheine“ (26×26)
 *   B  farbfaecher --mut wieder #8a8a8a → fast jede Ansicht hell (3,45:1)
 *   C  ::placeholder-Regel entfernt → „Sammlung“, „Teile“ dunkel (3,55:1)
 *   D  Papierkorb der Set-Kachel wieder <button tabindex="-1"> → „Sammlung“
 *      (axe nested-interactive)
 *   E  Telefonregel des Import-Menüs entfernt → „Import-Menü“ (Überlauf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./app-browser');
const { musterSammlung } = require('./bestand');
const { AXE_LAUF, LAYOUT } = require('./layout-messung');

const GERAETE = { rechner: [1280, 900, false], telefon: [390, 844, true] };

const klick = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const reiter = (r) => klick(`.ntab[data-tab="${r}"]`);
const ANSICHTEN = [
  ['Sammlung', [reiter('gallery')]],
  ['Teile', [reiter('parts')]],
  ['Minifiguren', [reiter('minifigs')]],
  ['Teileliste', [reiter('partslist')]],
  ['Finanzen', [reiter('finance')]],
  ['Merkliste', [reiter('wanted')]],
  ['Katalog', [reiter('catalog')]],
  ['Hintergrundarbeiten', [reiter('monitor')]],
  // Alle Abschnitte auf einmal: Sie stehen sonst einzeln da, gemessen wird dasselbe.
  ['Einstellungen', [reiter('settings'), `document.querySelectorAll('#global-settings-grid > .ssec').forEach(a => a.classList.add('einst-aktiv')); true`]],
  ...['profil', 'gutscheine', 'alarme', 'lagerorte', 'haushalt', 'daten', 'app']
    .map(s => [`Sicht ${s}`, [klick(`.umenu-item[data-arg="${s}"]`)]]),
  ['Benutzermenü', [reiter('gallery'), klick('#btn-umenu')]],
  ['Import-Menü', [reiter('gallery'), `document.querySelector('#tab-gallery details.import-menue').open = true; true`]],
  ['Set hinzufügen', [reiter('gallery'), klick('button[data-click="oeffneErfassen"][data-arg="set"]')]],
  ['Set-Detail', [reiter('gallery'), klick('#gallery [data-click="openModal"]')]],
  ['Kaufpreise', [reiter('gallery'), klick('#gallery [data-click="openModal"]'), klick('#set-modal [data-click="openAcqModal"]')]],
  ['Teil-Detail', [reiter('parts'), klick('.man-tile[data-click="openManDetail"]')]],
  ['Löschen bestätigen', [reiter('parts'), klick('.man-tile .delbtn')]],
];

const SCHLIESSEN = `(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.querySelector('[data-click^="close"], [data-click^="schliesse"], .mx')?.click());
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
  document.querySelectorAll('details[open]').forEach(d => { d.open = false; });
  const pop = document.getElementById('umenu-pop'); if (pop) pop.style.display = 'none';
  return true; })()`;

/** Registriert den Test für ein Design und ein Gerät. */
function pruefeOberflaeche(design, geraet) {
  test(`Oberfläche ${design}, ${geraet}: axe und Layout`, { concurrency: 1, timeout: 300_000 }, async (t) => {
    const app = await starteApp(t, { name: `ofl_${design}_${geraet}_${process.pid}`, bestand: musterSammlung });
    if (app.grund) { t.skip(app.grund); return; }
    const { b } = app;
    const [w, h, mobil] = GERAETE[geraet];
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });
    // Ohne Rebrickable-Schlüssel springt die App nach dem Start in die Einstellungen.
    await warte(1000);
    await b.auswerten(klick('#einrichtung-modal.open [data-click="einrichtungSpaeter"]'));
    const bild = () => b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    // Statt fester Pausen: warten, bis keine Anfrage mehr läuft, dann zwei Bilder.
    await b.auswerten(`(() => { if (window.__offen === undefined) { window.__offen = 0; const f = window.fetch;
      window.fetch = (...a) => { window.__offen++; return f(...a).finally(() => setTimeout(() => window.__offen--, 60)); }; } return true; })()`);
    const ruhig = async () => { await warte(60); await app.bis('window.__offen === 0', 'Anfragen fertig', 60); await bild(); };

    for (const [ansicht, schritte] of ANSICHTEN) {
      const funde = [];
      // Steht die Anmeldemaske da, misst der Rest nur sie; dann lieber die Ursache nennen.
      if (await b.auswerten(`getComputedStyle(document.getElementById('app')).display === 'none'`))
        assert.fail(`Sitzung vor „${ansicht}“ verloren; 401 auf: ${app.abgewiesen.join(', ') || 'keine'}`);
      await b.auswerten(SCHLIESSEN);
      await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.removeAttribute('data-dunkel'); true`);
      for (const s of schritte) { await b.auswerten(s); await ruhig(); }
      for (const dunkel of [false, true]) {
        await b.auswerten(`document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
        await bild();
        const wo = dunkel ? 'dunkel' : 'hell';
        for (const f of await b.auswerten(LAYOUT(mobil))) funde.push(`${wo}: ${f}`);
        for (const f of await b.auswerten(AXE_LAUF)) funde.push(`${wo}: axe ${f}`);
      }
      await t.test(ansicht, () => assert.deepEqual(funde, []));
    }
    await b.auswerten(SCHLIESSEN);
  });
}

module.exports = { pruefeOberflaeche };
