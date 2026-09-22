/**
 * Reihenfolge der Reiter-Bereiche: Erfassen → Suche/Filter → Liste.
 *
 * ── Woher dieser Test kommt (Nachtrag 32) ───────────────────────────────────
 * Marcos Wunsch aus dem Betrieb: Die Filter-Bedienelemente sollen NACH der
 * Erfassung stehen, nicht im Kopf des Reiters — sie stehen damit direkt über
 * der Liste, auf die sie wirken. Gilt für Galerie, Teile und Minifiguren;
 * Finanzen ausdrücklich nicht (dort gibt es keine Erfassen-Box), Teileliste
 * hat keine Filter, der Katalog keine Erfassung.
 *
 * Der Test prüft die REIHENFOLGE im Markup, nicht Pixel: Erfassen-Formular
 * vor Filterleiste vor Listencontainer. Zusätzlich: Jede Bedienelement-ID
 * genau einmal — die IDs sind der Vertrag mit dem JS, ein verschobenes
 * Duplikat würde die Handler an das falsche Element binden.
 *
 * Gegenprobe (durchgeführt): Filterleiste der Galerie probeweise zurück in
 * den .ph-Kopf gesetzt → der Galerie-Schritt wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const REITER = [
  // [Name, Erfassen-Kennung, Filter-Kennung, Listen-Kennung]
  ['Galerie',     'id="btn-add"',       'id="gs"',           '<div id="gallery"></div>'],
  ['Teile',       'id="btn-add-part"',  'id="parts-search"', '<div class="parts-layout">'],
  ['Minifiguren', 'id="af-num-inline"', 'id="fig-search"',   '<div id="figs-list"></div>'],
];

test('Erfassen steht vor den Filtern, die Filter stehen vor der Liste', () => {
  for (const [name, erfassen, filter, liste] of REITER) {
    const a = html.indexOf(erfassen);
    const b = html.indexOf(filter);
    const c = html.indexOf(liste);
    assert.ok(a >= 0 && b >= 0 && c >= 0, `${name}: Kennungen nicht gefunden`);
    assert.ok(a < b, `${name}: die Filterleiste muss NACH der Erfassen-Box stehen (Marcos Wunsch, Nachtrag 32)`);
    assert.ok(b < c, `${name}: die Filterleiste muss VOR der Liste stehen, auf die sie wirkt`);
  }
});

test('die Reiterköpfe enthalten keine Filter-Bedienelemente mehr', () => {
  // Der Kopf (.ph) trägt nur noch den Titel. Ein Filterelement, das dorthin
  // zurückwandert, stünde wieder VOR der Erfassung.
  for (const [name, , filter] of REITER) {
    const kopfStart = html.indexOf(filter) >= 0 ? html.lastIndexOf('<div class="ph"', html.indexOf(filter)) : -1;
    const kopfEnde  = kopfStart >= 0 ? html.indexOf('</div>', html.indexOf('</h2>', kopfStart)) : -1;
    const kopf = kopfStart >= 0 ? html.slice(kopfStart, kopfEnde) : '';
    assert.ok(!kopf.includes(filter),
      `${name}: ${filter} steht wieder im Reiterkopf statt unter der Erfassen-Box`);
  }
});

test('jede Bedienelement-ID existiert genau einmal', () => {
  const ids = ['id="gs"', 'id="gtheme"', 'id="gsort"', 'id="scope-gallery"', 'id="vg"', 'id="vl"',
               'id="parts-search"', 'id="parts-spare"', 'id="parts-view"', 'id="scope-parts"',
               // fig-source ist entfernt: ein Auswahlfeld mit einer einzigen
               // Option, das von nirgends gefüllt wurde.
               'id="fig-search"', 'id="figs-view"', 'id="scope-minifigs"'];
  for (const id of ids) {
    const n = html.split(id).length - 1;
    assert.equal(n, 1, `${id} kommt ${n}× vor — die IDs sind der Vertrag mit dem JS`);
  }
});

test('die manuell erfassten Listen stehen unter der Filterleiste (Nachtrag 34)', () => {
  // Marcos Hinweis: Der Filter der Reiter Teile und Minifiguren wirkt auf
  // BEIDE Listen — die manuell erfassten Einträge und die aus Sets. Stand die
  // manuelle Liste über der Filterleiste, sah es aus, als beträfe der Filter
  // nur die Set-Einträge.
  const faelle = [
    ['Teile',       'id="btn-add-part"',  'id="parts-search"', 'id="manual-parts-list"', '<div class="parts-layout">'],
    ['Minifiguren', 'id="af-num-inline"', 'id="fig-search"',   'id="manual-figs-list"',  '<div id="figs-list"></div>'],
  ];
  for (const [name, erfassen, filter, manuelleListe, setListe] of faelle) {
    const a = html.indexOf(erfassen), b = html.indexOf(filter);
    const c = html.indexOf(manuelleListe), d = html.indexOf(setListe);
    assert.ok(a >= 0 && b >= 0 && c >= 0 && d >= 0, `${name}: Kennungen nicht gefunden`);
    assert.ok(a < b, `${name}: Erfassen vor der Filterleiste`);
    assert.ok(b < c, `${name}: die manuelle Liste muss UNTER der Filterleiste stehen — der Filter betrifft sie`);
    assert.ok(c < d, `${name}: die manuelle Liste steht vor der Liste aus Sets`);
  }
});

test('der Katalogtitel steht allein, die Suche darunter', () => {
  // Analog zu den anderen Reitern (Marcos Wunsch, Nachtrag 34).
  const titel = html.indexOf('data-tab-title="catalog"');
  const suche = html.indexOf('id="cat-search"');
  const liste = html.indexOf('id="catalog-grid"');
  assert.ok(titel >= 0 && suche >= 0 && liste >= 0);
  assert.ok(titel < suche, 'der Titel steht vor der Suche');
  assert.ok(suche < liste, 'die Suche steht über der Liste');
  // Der Kopf trägt nur noch den Titel.
  const kopfStart = html.lastIndexOf('<div class="ph"', titel);
  const kopfEnde = html.indexOf('</div>', html.indexOf('</h2>', kopfStart));
  assert.ok(!html.slice(kopfStart, kopfEnde).includes('id="cat-search"'),
    'die Katalogsuche steht wieder im Reiterkopf');
});

test('die Filterleisten halten Abstand zur Liste', () => {
  // Marcos Wunsch: „Der Zwischenraum sollte grösser sein, damit es schön
  // aussieht." Gemeinsamer Wert für alle vier Filterleisten — 1rem war zu eng.
  // Nur die Leisten selbst (gap:8px) sind gemeint; andere Bereiche mit
  // margin-bottom:1rem bleiben unberührt.
  const LEISTE = /display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:([\d.]+)rem/g;
  const abstaende = [...html.matchAll(LEISTE)].map(m => parseFloat(m[1]));
  assert.equal(abstaende.length, 4,
    `erwartet werden vier Filterleisten (Galerie, Teile, Minifiguren, Katalog), gefunden: ${abstaende.length}`);
  for (const a of abstaende) {
    assert.ok(a >= 1.5, `eine Filterleiste steht noch auf ${a}rem — zu eng (mindestens 1.5rem)`);
  }
});

/**
 * Der eigene Bestand steht in der Teileliste auf einer EIGENEN Zeile.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Bitte die rot umkreisten Buttons auf eine neue Zeile verschieben. Diese
 * gehören thematisch nicht zum Rest." Gemeint waren „Eigenen Bestand
 * eintragen" und „nur lose Teile".
 *
 * Er hat recht, und die erste Zeile sagt jetzt auch, warum: Dort steht das
 * ZUSAMMENSTELLEN der Liste (Set-Nr., Hinzufügen, Erstellen) und das
 * WEITERGEBEN (PDF, BrickLink, Reset). Der eigene Bestand ist keines von
 * beidem — er trägt Zahlen IN die fertige Liste ein.
 *
 * ── Warum eine Regel und nicht nur die Änderung ─────────────────────────────
 *
 * Die erste Zeile trägt `flex-wrap:nowrap` und einen waagerechten Rollbalken.
 * Ein Knopf, der dort wieder hineinrutscht, faellt nicht auf — er schiebt
 * bloss den Rest aus dem Bild. Genau so ist die Vermischung ueberhaupt
 * entstanden.
 *
 * NACHGEMESSEN (Chromium, 1440px): Werkzeugzeile auf y=486, Bestand-Zeile auf
 * y=524 — zwei Zeilen, 8px Abstand. Ohne erzeugte Liste ist der Kopf 72px
 * statt 108px hoch, es bleibt also KEIN leerer Streifen stehen.
 *
 * Gegenproben (beide durchgefuehrt): den Bestand-Knopf zurueck in die erste
 * Zeile gesetzt → Schritt 1 rot; in der App `partslist_fill_owned` zurueck
 * in die Werkzeug-Row → Schritt 2 rot.
 */
test('der eigene Bestand steht nicht in der Werkzeugzeile der Teileliste', () => {
  const ab = html.indexOf('id="tab-partslist"');
  const bis = html.indexOf('id="pl-sets"', ab);
  assert.ok(ab >= 0 && bis > ab, 'Der Teileliste-Reiter ist nicht mehr zu finden');
  const kopf = html.slice(ab, bis);

  // Die Werkzeugzeile: vom ersten <div style="display:flex … bis zu ihrem Ende.
  const zeileAb = kopf.indexOf('id="pl-setnr"');
  const zeileBis = kopf.indexOf('id="pl-bestand-zeile"');
  assert.ok(zeileAb >= 0, 'Das Set-Nummer-Feld fehlt');
  assert.ok(zeileBis > zeileAb,
    'Es gibt keine eigene Bestand-Zeile mehr (#pl-bestand-zeile) — sind die ' +
    'Knöpfe wieder in die Werkzeugzeile gewandert?');
  const werkzeugzeile = kopf.slice(zeileAb, zeileBis);

  for (const id of ['btn-pl-bestand', 'pl-bestand-lose']) {
    assert.ok(!werkzeugzeile.includes(`id="${id}"`),
      `#${id} steht wieder in der Werkzeugzeile. Sie trägt flex-wrap:nowrap — ` +
      'ein Knopf mehr schiebt dort den Rest aus dem Bild, statt umzubrechen.');
  }
  const zeile = kopf.slice(zeileBis);
  for (const id of ['btn-pl-bestand', 'pl-bestand-lose']) {
    assert.ok(zeile.includes(`id="${id}"`), `#${id} fehlt in der Bestand-Zeile`);
  }
});

test('die App hält den eigenen Bestand ebenfalls aus der Werkzeugzeile heraus', () => {
  // Dieselbe Regel für die andere Oberfläche. In der App ist die Reihenfolge
  // im Quelltext die Aussage: „Reset" ist der letzte Knopf der Werkzeug-Row,
  // also steht alles danach ausserhalb davon.
  const { ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(fs.readFileSync(path.join(
    __dirname, '..', '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch',
    'brickinventoryapp', 'ui', 'screens', 'PartsListScreen.kt'), 'utf8'));

  const reset  = src.indexOf('R.string.partslist_reset');
  const bestand = src.indexOf('R.string.partslist_fill_owned');
  const lose    = src.indexOf('R.string.partslist_only_loose');
  assert.ok(reset >= 0 && bestand >= 0 && lose >= 0, 'Beschriftungen nicht gefunden — Bildschirm umgebaut?');
  assert.ok(bestand > reset,
    '„Mein Bestand" steht wieder VOR dem Reset-Knopf und damit in derselben ' +
    'Werkzeug-Row. In der Webapp hat Marco genau das beanstandet.');
  assert.ok(lose > bestand,
    '„nur lose Teile" gehört neben den Bestand-Knopf, nicht davor.');
});
