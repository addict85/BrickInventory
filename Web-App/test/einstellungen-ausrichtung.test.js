/**
 * Die Einstellungen richten ihre Spalten aneinander aus, nicht an der Textlänge.
 *
 * ── Marcos Befunde (mit Bildern) ────────────────────────────────────────────
 *
 *   1. „Kannst du einen kleinen Abstand zwischen dem Einladungscode und dem
 *      Verknüpfen Button einfügen? die sind zu nahe bei einander."
 *   2. „Kannst du sicherstellen dass die Felder alle schön gleich ausgerichtet
 *      sind wie in einer Tabelle? aktuell sind sie alle unterschiedlich lang."
 *      (Lagerorte)
 *   3. „dass alle Entfernen Buttons schön in einer Spalte sind? aktuell sind
 *      sie nicht alle gleich ausgerichtet."
 *
 * 2 und 3 haben dieselbe Ursache: Jede Zeile war ein EIGENES Flexfeld. Damit
 * beginnt die nächste Spalte dort, wo der Inhalt der vorigen aufhört — und
 * „emily.bigolin" endet woanders als „alessio.bigolin", „406 Sets, 0
 * Teilesorten, 0 Figuren" woanders als „leer".
 *
 * Die Abhilfe ist dieselbe: Das Raster steht auf der LISTE, die Zeilen sind
 * `display:contents`. Nur so teilen sich alle Zeilen DIESELBEN Spaltenbreiten.
 * Wäre jede Zeile ein eigenes Raster, hätte jede wieder ihre eigenen Breiten —
 * also genau den Zustand von vorher. Genau diesen Unterschied prüfen die Fälle
 * unten: Es reicht nicht, dass irgendwo „grid" steht.
 *
 * ── Warum das hier prüfbar IST ──────────────────────────────────────────────
 *
 * jsdom rechnet kein Layout — eine Breite in Pixeln liesse sich hier nicht
 * messen. Was die Ausrichtung entscheidet, steht aber vollständig im Markup:
 * WO das Raster sitzt und ob die Zeilen einen eigenen Kasten erzeugen. Genau
 * das wird geprüft, und zwar an der ERZEUGTEN Struktur, nicht am Quelltext.
 *
 * ── Gegenproben (durchgeführt) ──────────────────────────────────────────────
 *
 *   a) Das Raster von der Liste zurück auf die Zeile → Fall 2 und 3 rot.
 *   b) margin-top am Verknüpfen-Knopf entfernt → Fall 1 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(path.join(ROOT, 'public', 'js', '05-settings.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/** Wie in test/catalog-frontend.test.js: die Modulverpackung weg. */
function ohneModul(src) {
  return src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
}

/**
 * Eine Funktion aus 05-settings.js in einer Sandbox ausführen.
 *
 * Nur die Funktion selbst, nicht die ganze Datei: Sie zieht ein halbes Dutzend
 * andere Module nach sich (Galerie, Teile, Minifiguren), und die hier
 * nachzubauen hiesse, die Anwendung zu starten, um ein Raster zu prüfen.
 */
function fuehreAus(funktionsName, umgebung) {
  const start = QUELLE.indexOf(`function ${funktionsName}(`);
  assert.ok(start > 0, `${funktionsName}() steht nicht mehr in public/js/05-settings.js`);
  // Bis zur Klammer auf Spalte 0 — so sind diese Dateien geschrieben.
  const ende = QUELLE.indexOf('\n}\n', start) + 3;
  const code = ohneModul(QUELLE.slice(start, ende));
  const sandbox = { ...umgebung };
  vm.createContext(sandbox);
  vm.runInContext(code + `\n${funktionsName}(ARG);`, sandbox);
  return sandbox;
}

/** Minimalgerüst: nur, was die beiden Erzeuger wirklich anfassen. */
function gestell(dom, zielId) {
  const d = dom.window.document;
  return {
    document: d,
    G: (id) => d.getElementById(id),
    esc: (s) => String(s ?? ''),
    t:    (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    tRaw: (k) => k,
    ZIEL: zielId,
  };
}

test('Abstand zwischen Einladungscode und Verknüpfen-Knopf', () => {
  const d = new JSDOM(HTML).window.document;
  const knopf = d.querySelector('[data-click="redeemHouseholdInvite"]');
  assert.ok(knopf, 'Der Verknüpfen-Knopf ist nicht mehr zu finden');
  const stil = knopf.getAttribute('style') || '';
  assert.match(stil, /margin-top\s*:\s*\.?\d/,
    `Der Knopf trägt keinen oberen Abstand (style="${stil}"). Er klebt dann am ` +
    'Eingabefeld darüber — Marcos Bild.');
});

test('die verknüpften Konten stehen in zwei Spalten, nicht je Zeile neu', () => {
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<div id="household-state"></div><div id="household-invite-box"></div>' +
    '<div id="household-redeem-box"></div></body></html>');
  const umg = gestell(dom);
  umg.ARG = { is_sub: false, currency: 'CHF',
              sub_accounts: [{ id: 1, username: 'emily.bigolin' },
                             { id: 2, username: 'alessio.bigolin' },
                             { id: 3, username: 'eliano.bigolin' }] };
  fuehreAus('renderHousehold', umg);

  const liste = dom.window.document.querySelector('#household-state ul');
  assert.ok(liste, 'Die Liste der verknüpften Konten wurde nicht erzeugt');
  const stil = liste.getAttribute('style') || '';
  assert.match(stil, /display\s*:\s*grid/,
    `Die LISTE trägt kein Raster (style="${stil}") — dann richtet sich jede Zeile ` +
    'für sich aus, und die Knöpfe stehen versetzt.');
  assert.match(stil, /grid-template-columns\s*:\s*max-content\s+max-content/,
    'Die Liste hat keine zwei Inhaltsspalten — ohne sie teilen sich die Zeilen ' +
    'keine gemeinsame Breite');

  const zeilen = [...liste.querySelectorAll('li')];
  assert.equal(zeilen.length, 3, `${zeilen.length} Zeilen statt 3`);
  for (const li of zeilen) {
    assert.match(li.getAttribute('style') || '', /display\s*:\s*contents/,
      'Eine Zeile erzeugt einen eigenen Kasten — damit liegen ihre Zellen NICHT ' +
      'in den Spalten der Liste, und die Ausrichtung ist wieder dahin');
  }
  // Und jede Zeile liefert genau zwei Zellen — sonst verschieben sich die
  // Spalten ab der ersten Zeile, die anders gebaut ist.
  for (const li of zeilen) {
    assert.equal(li.children.length, 2,
      `Eine Zeile hat ${li.children.length} Zellen statt 2 — bei display:contents ` +
      'zählt jede Zelle einzeln ins Raster, eine zu viel verschiebt alles danach');
  }
  assert.equal(liste.querySelectorAll('[data-click="unlinkHousehold"]').length, 3,
    'Nicht jede Zeile hat ihren Entfernen-Knopf');
});

test('die Lagerorte stehen wie in einer Tabelle', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="storage-list"></div></body></html>');
  const d = dom.window.document;

  // ladeLagerortVerwaltung() holt die Daten selbst vom Server. Geprüft wird
  // hier die ERZEUGTE Struktur, nicht das Holen — deshalb wird nur der
  // Markup-Teil ausgeführt, mit festen Daten.
  const quelle = QUELLE.slice(QUELLE.indexOf('export async function ladeLagerortVerwaltung'));
  const ende = quelle.indexOf('\n}\n') + 3;
  const rumpf = quelle.slice(0, ende);
  assert.match(rumpf, /storage-list/, 'Der Abschnitt wurde nicht gefunden');

  const sandbox = {
    document: d,
    G: (id) => d.getElementById(id),
    esc: (s) => String(s ?? ''),
    ico: (n) => `<svg class="ico"><use href="#i-${n}"/></svg>`,
    t: (k, v) => k + ' ' + JSON.stringify(v || {}),
    tRaw: (k) => k,
    // success: true, sonst kehrt die Funktion gleich am Anfang um. Und die
    // Belegung schluesselt auf `ort`, nicht auf `name` — genau Marcos Lage:
    // drei Orte mit Inhalt, einer leer, damit die Spalte „Belegung" wirklich
    // verschieden lange Texte bekommt.
    api: async (_m, pfad) => pfad.includes('locations')
      ? { success: true,
          orte: [{ id: 1, name: 'Büro' }, { id: 2, name: 'Estrich' },
                 { id: 3, name: 'Zimmer Alessio' }, { id: 4, name: 'Zimmer Emily' }],
          vorgabe: { id: 2 } }
      : { success: true,
          orte: [{ ort: 'Büro', sets: 24, teile: 0, figuren: 0 },
                 { ort: 'Estrich', sets: 406, teile: 0, figuren: 0 },
                 { ort: 'Zimmer Alessio', sets: 2, teile: 0, figuren: 0 }] },
  };
  vm.createContext(sandbox);
  vm.runInContext(rumpf.replace(/^export\s+/, '') + '\nERG = ladeLagerortVerwaltung();', sandbox);
  return sandbox.ERG.then(() => {
    const raster = d.querySelector('#storage-list > div[style*="grid"]');
    assert.ok(raster, 'Es gibt keinen Rasterbehälter — dann richtet sich jede Zeile ' +
                      'für sich aus, und die Eingabefelder sind verschieden lang');
    const stil = raster.getAttribute('style');
    assert.match(stil, /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+max-content\s+max-content\s+max-content/,
      `Das Raster hat nicht die vier erwarteten Spalten (style="${stil}"). minmax(0,1fr) ` +
      'und nicht 1fr: Ein langer Ortsname sprengte sonst die Spalte.');

    const zeilen = [...raster.children];
    assert.equal(zeilen.length, 4, `${zeilen.length} Zeilen statt 4`);
    for (const z of zeilen) {
      assert.match(z.getAttribute('style') || '', /display\s*:\s*contents/,
        'Eine Lagerortzeile erzeugt einen eigenen Kasten — damit hat sie wieder ' +
        'ihre eigenen Spaltenbreiten');
      assert.equal(z.children.length, 4,
        `Eine Zeile hat ${z.children.length} Zellen statt 4 (Feld, Belegung, Stern, Papierkorb)`);
    }
    // Der Trennstrich sass an der Zeile; ein display:contents-Element kann
    // keinen Rahmen tragen. Er muss an den ZELLEN liegen, sonst ist er weg.
    for (const zelle of zeilen[0].children) {
      assert.match(zelle.getAttribute('style') || '', /border-bottom/,
        'Eine Zelle trägt keinen Trennstrich — bei display:contents ist die Linie ' +
        'sonst verschwunden, weil die Zeile keinen Kasten mehr hat');
    }
  });
});
