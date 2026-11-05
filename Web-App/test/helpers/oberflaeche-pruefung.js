/**
 * Die ganze Oberfläche in Chrome, für ein Design und ein Gerät (Rechner
 * 1280 × 900 oder Telefon 390 × 844), hell und dunkel: jeder Reiter, alle
 * Abschnitte der Einstellungen, die Seiten hinter dem Menü und die
 * wichtigsten Dialoge. Je Zustand:
 *   - axe-core: kein Verstoss der Stufe serious oder critical;
 *   - Layout (layout-messung.js): kein waagrechter Überlauf, jedes Tippziel
 *     ≥ 44 × 44 px am Telefon und ≥ 24 × 24 px am Rechner, keine überlappenden
 *     Bedienelemente, kein abgeschnittener Text ohne „…“, Text und Platzhalter
 *     ≥ 4,5:1 (gross 3:1), Feldgrenzen, Sinnbild-Knöpfe, Knopfgrenzen und
 *     aktive Zustände (Ansicht, Sammlungswahl, Zeitraum, Reiter) ≥ 3:1;
 *   - in jedem Dialog: Tab erreicht jedes Bedienelement, jede Klickfläche
 *     nimmt den Fokus, und der Fokus bleibt im Dialog.
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
 * Gegenproben (01.11.2026, je einzeln, gemessen an classic/rechner):
 *   F  `summary` aus FOKUSSIERBAR (01-dialoge.js) → „Set-Detail“ („Weitere
 *      Aktionen“ nicht per Tab erreichbar)
 *   G  Dateifeld der Anleitungen wieder display:none → „Set-Detail“ (Knopf ohne Tastatur)
 *   H  --feldrand wieder var(--bdr) → fast jede Ansicht (Feldgrenze 1,18:1)
 *   I  .btn ohne min-height 24px → „Hintergrundarbeiten“, „Set-Detail“ u. a. (21–23 px)
 * Gegenproben (02.11.2026, je einzeln):
 *   K  .bs wieder border var(--bdr) → classic/rechner „Sammlung“, „Teile“,
 *      „Einstellungen“, Sichten u. a. (Knopfgrenze, z. B. „Schliessen“)
 *   L  .vb.active ohne border-color → classic/rechner „Sammlung“, „Teile“,
 *      „Minifiguren“, „Benutzermenü“, „Import-Menü“ (aktiver Zustand „Karten“)
 *   M  noppe dunkel .ntab.active ohne hellen Rand → noppe/rechner „Sammlung“,
 *      „Teileliste“, „Finanzen“ u. a. (aktiver Zustand 1,13:1)
 * Gegenproben (04.11.2026, zusammen angewendet, classic/telefon und schmal):
 *   N  Merklisten-Zeile ohne eigene Zeile für Etikett und Preis → „Merkliste“
 *      (schmal 0 px, 7 Zeilen: .mk-titel)
 *   O  Seitentitel der Sammlung ohne min-height 44px → „Teile“ (verdeckt:
 *      Untertitel unter „Importieren“)
 *   P  (einzeln, 320 px Seitenschrift 200 %) Finanzzeile ohne die
 *      Container-Abfrage 17rem → „Finanzen“ (schmal 0 px: .fin-name)
 * Gegenproben (04.11.2026, Bestand mit Unterkonto, musterHaushalt):
 *   Q  .toast-aktion wieder --b500, .pl-chip-name wieder --mut →
 *      classic/rechner „Toast mit Aktion“ (3,67:1) und „Bauliste mit Sets“ (4,37:1)
 *   R  .haushalt-liste wieder max-content max-content ohne Umbruch des Knopfs
 *      → 390 px Seitenschrift 200 % „Sicht haushalt“ (Überlauf 432 px);
 *      mit musterSammlung statt musterHaushalt blieb dieselbe Prüfung grün —
 *      die Lücke, durch die der Befund der UI-Prüfung 12 rutschte.
 * Gegenproben (04.11.2026, je einzeln; Wortbruch, Zeichenfläche, Auswahlfeld):
 *   S  Zeitraumknöpfe wieder im 2×2-Raster ohne nowrap, Diagrammkarte mit
 *      vollem Innenrand → 320 px Seitenschrift 200 % „Finanzen“ (Wortbruch
 *      „Woch|e“, „Mona|t“); nur Raster und nowrap zurück blieb grün, weil der
 *      schmalere Innenrand allein schon Platz schafft
 *   T  achsenLage immer aussen → 320 px Seitenschrift 200 % „Finanzen“
 *      (schmal (Diagramm) -2 px Kurve) und „Set-Detail“ (101 px)
 *   U  Merklisten-Filter wieder je halbe Zeile → 320 px EN „Merkliste“
 *      (Auswahl gekürzt „All conditions“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./app-browser');
const { musterHaushalt } = require('./bestand');
const { AXE_LAUF, LAYOUT, tabPruefung } = require('./layout-messung');

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
  ['Teil hinzufügen', [reiter('parts'), klick('button[data-click="oeffneErfassen"][data-arg="part"]')]],
  ['Minifigur hinzufügen', [reiter('minifigs'), klick('button[data-click="oeffneErfassen"][data-arg="fig"]')]],
  ['Teil-Detail', [reiter('parts'), klick('.man-tile[data-click="openManDetail"]')]],
  ['Teil aus Set', [reiter('parts'), klick('.part-card[data-click="openSetItemDetail"]')]],
  ['Merkposten-Detail', [reiter('wanted'), klick('.mk-zeile[data-click="oeffneMerkpostenDetail"]')]],
  ['Löschen bestätigen', [reiter('parts'), klick('.man-tile .delbtn')]],
  // Ein Toast mit Knopf und die Bauliste mit Chips, darunter einer, den der Katalog nicht kennt.
  ['Toast mit Aktion', [reiter('gallery'), `location.hash = '#/sammlung/set/99999-9'; true`]],
  ['Bauliste mit Sets', [reiter('partslist'), `(() => { document.getElementById('pl-setnr').value = '10294-1, 99999-1';
    document.querySelector('[data-click="plAddSet"]').click(); return true; })()`, klick('#btn-pl-gen')]],
];

const SCHLIESSEN = `(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.querySelector('[data-click^="close"], [data-click^="schliesse"], .mx')?.click());
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
  document.querySelectorAll('details[open]:not(#mk-kasten):not(#pl-optionen)').forEach(d => { d.open = false; });
  document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
  const pop = document.getElementById('umenu-pop'); if (pop) pop.style.display = 'none';
  return true; })()`;

/** Registriert den Test für ein Design und ein Gerät. */
function pruefeOberflaeche(design, geraet) {
  test(`Oberfläche ${design}, ${geraet}: axe und Layout`, { concurrency: 1, timeout: 300_000 }, async (t) => {
    const app = await starteApp(t, { name: `ofl_${design}_${geraet}_${process.pid}`, bestand: musterHaushalt });
    if (app.grund) { t.skip(app.grund); return; }
    const { b } = app;
    const [w, h, mobil] = GERAETE[geraet];
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });
    // Ohne Rebrickable-Schlüssel öffnet nach dem Start der Einrichtungsassistent.
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
      for (const f of await tabPruefung(b)) funde.push(`Tastatur: ${f}`);
      await t.test(ansicht, () => assert.deepEqual(funde, []));
    }
    await b.auswerten(SCHLIESSEN);
  });
}

/** Funde, die grosse Schrift betreffen: Überlauf, Abschneiden, Überlappung, Tippziel, Leiste, schmaler oder verdeckter Text, Wortbruch.
 * Ein gekürztes Auswahlfeld zählt nur bei normaler Schrift: Bei 200 % passt nicht jeder Eintrag in 320 px. */
const GROSS = /^(Überlauf|abgeschnitten|Überlappung|Tippziel|Leiste|schmal|verdeckt|Wortbruch)/;
const LEISTE = `[...document.querySelectorAll('nav .ntab')].filter(t => t.checkVisibility()).map(t => t.querySelector('.tab-label'))
  .filter(l => l.getBoundingClientRect().width <= 1 || l.scrollWidth > l.clientWidth + 1).map(l => 'Leiste: „' + l.textContent.trim() + '“ abgeschnitten')`;

/**
 * Alle Ansichten bei 320 px (oder `breite`) und 200 % Schrift, in allen sechs Designs hell
 * und dunkel. `modus` 'browser' vergrössert wie die Browsereinstellung
 * (Page.setFontSizes), 'seite' setzt die Grundschrift der Seite auf 200 %,
 * 'schmal' misst 320 px bei normaler Schrift auf Englisch.
 */
function pruefeGrosseSchrift(modus, breite = 320) {
  test(`Oberfläche ${breite} px (${modus}): alle Ansichten`, { concurrency: 1, timeout: 300_000 }, async (t) => {
    // Schmal auf Englisch: Die längeren Beschriftungen sind dort der enge Fall.
    const app = await starteApp(t, { name: `ofl_gross_${modus}_${process.pid}`, bestand: musterHaushalt, sprache: modus === 'schmal' ? 'en' : 'de' });
    if (app.grund) { t.skip(app.grund); return; }
    const { b } = app;
    await b.tab('Emulation.setDeviceMetricsOverride', { width: breite, height: 640, deviceScaleFactor: 1, mobile: true });
    await warte(1000);
    await b.auswerten(klick('#einrichtung-modal.open [data-click="einrichtungSpaeter"]'));
    if (modus === 'browser') await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    else if (modus === 'seite') await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
    const designs = modus === 'browser' ? ['classic', 'brick', 'noppe', 'werkbank', 'farbfaecher', 'hochglanz']
      : modus === 'schmal' ? ['classic', 'noppe'] : ['classic'];
    for (const [ansicht, schritte] of ANSICHTEN) {
      const funde = [];
      await b.auswerten(SCHLIESSEN);
      for (const s of schritte) { await b.auswerten(s); await warte(250); }
      await warte(400);
      // Gemessen wird der geladene Inhalt, nicht das Gerüst davor (Marktpreis im Set-Dialog).
      await app.bis(`!document.querySelector('.ovl.open .skelett-zeile, .tab.active .skelett-zeile')`, 'Inhalt geladen', 40).catch(() => {});
      for (const design of designs) for (const dunkel of [false, true]) {
        await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
        await b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
        const wo = `${design} ${dunkel ? 'dunkel' : 'hell'}`;
        for (const f of [...await b.auswerten(LAYOUT(true)), ...await b.auswerten(LEISTE)]) if (GROSS.test(f) || (modus === 'schmal' && f.startsWith('Auswahl'))) funde.push(`${wo}: ${f}`);
      }
      await t.test(ansicht, () => assert.deepEqual(funde, []));
    }
    await b.auswerten(SCHLIESSEN);
  });
}

module.exports = { pruefeOberflaeche, pruefeGrosseSchrift };
