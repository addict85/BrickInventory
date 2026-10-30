/**
 * Die ganze Oberfläche in Chrome: jede Ansicht, jeder Reiter, jeder Abschnitt
 * der Einstellungen, die Seiten hinter dem Menü und die wichtigsten Dialoge —
 * in allen sechs Designs, hell und dunkel, am Rechner (1280 × 900) und am
 * Telefon (390 × 844). Je Zustand:
 *   - axe-core: kein Verstoss der Stufe serious oder critical;
 *   - Layout (helpers/layout-messung.js): kein waagrechter Überlauf, am
 *     Telefon jedes Tippziel ≥ 44 × 44 px, keine überlappenden Bedienelemente,
 *     kein abgeschnittener Text ohne „…“, Text und Platzhalter ≥ 4,5:1
 *     (gross 3:1).
 * Gemessen werden Eigenschaften statt Bilder: Pixelvergleiche hingen an den
 * Schriften der Maschine.
 *
 * Gegenproben (am 30.10.2026 gemessen, auf die genannten Ansichten verengt):
 *   A  .v-btn aus der 44-px-Regel in mobile.css genommen → rot: „Sicht
 *      gutscheine“ (Tippziel 26×26)
 *   B  themes/farbfaecher.css --mut wieder #8a8a8a → rot: „Sammlung“, „Teile“
 *      (farbfaecher/hell: Kontrast 3.45:1)
 *   C  die ::placeholder-Regel in styles.css entfernt → rot: „Sammlung“,
 *      „Teile“ (dunkel: Platzhalter 3.55:1)
 *   D  der Papierkorb der Set-Kachel wieder <button tabindex="-1"> → rot:
 *      „Sammlung“ (axe nested-interactive)
 *   E  die Telefonregel des Import-Menüs entfernt → rot: „Import-Menü“
 *      (Überlauf 104 px)
 *
 * Ohne Chrome oder Test-DB wird übersprungen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');
const { AXE_LAUF, LAYOUT } = require('./helpers/layout-messung');

const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];
const GERAETE = [['rechner', 1280, 900, false], ['telefon', 390, 844, true]];

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
  ...['einst-design', 'einst-bl', 'einst-rb', 'einst-bs', 'usermgmt', 'einst-smtp', 'einst-konfig']
    .map(a => [`Einstellungen/${a}`, [reiter('settings'), klick(`.einst-nav a[data-arg="${a}"]`)]]),
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

test('Oberfläche: axe und Layout in allen Designs', { concurrency: 1, timeout: 1_500_000 }, async (t) => {
  const app = await starteApp(t, { name: `oberflaeche_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b } = app;
  // Ohne Rebrickable-Schlüssel springt die App nach dem Start in die Einstellungen.
  await warte(1200);
  await b.auswerten(klick('#einrichtung-modal.open [data-click="einrichtungSpaeter"]'));
  const bild = () => b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);

  for (const [ansicht, schritte] of ANSICHTEN) {
    const funde = [];
    for (const [geraet, w, h, mobil] of GERAETE) {
      await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });
      await b.auswerten(SCHLIESSEN);
      await b.auswerten(`document.documentElement.setAttribute('data-theme', 'classic'); document.documentElement.removeAttribute('data-dunkel'); true`);
      for (const s of schritte) { await b.auswerten(s); await warte(500); }
      await warte(400);
      for (const design of DESIGNS) for (const dunkel of [false, true]) {
        await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}');
          document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
        await bild();
        const wo = `${design}/${dunkel ? 'dunkel' : 'hell'}/${geraet}`;
        for (const f of await b.auswerten(LAYOUT(mobil))) funde.push(`${wo}: ${f}`);
        for (const f of await b.auswerten(AXE_LAUF)) funde.push(`${wo}: axe ${f}`);
      }
    }
    await t.test(ansicht, () => assert.deepEqual(funde, []));
  }
  await b.auswerten(SCHLIESSEN);
});
