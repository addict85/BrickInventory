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
