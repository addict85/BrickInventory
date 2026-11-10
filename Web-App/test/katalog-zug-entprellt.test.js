/**
 * Ein Zug ueber die Jahres-Leiste holt EINE Seite, nicht hundert.
 * Ausführlich: docs/begruendungen/test/katalog-zug-entprellt.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { warte } = require('./helpers/zeit');

const JS = path.join(__dirname, '..', 'public', 'js');

/** import/export entfernen — die Datei wird hier als klassisches Skript ausgewertet. */
function ohneModulhuelle(src) {
  return 'function registerActions(){}\n'
       + 'function tRaw(k, v){ return typeof t === "function" ? t(k, v) : k; }\n'
       + src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
}

const BLOCK_HOEHE = 900;   // Pixel je Seitenblock
const SEITEN = 50;
const SETS = SEITEN * 60;
const SCHRITTE = 40;       // Beruehrungspunkte eines Zuges
const SCHRITT_MS = 15;     // Abstand zwischen zwei Punkten — schneller als die Ruhe

/**
 * Einen Zug ueber die ganze Leiste fahren und die Seitenabrufe zaehlen.
 * @param {boolean} entprellt false = Gegenprobe, die Ruhe wird herausgenommen
 */
async function zugMessen(entprellt) {
  let code = ohneModulhuelle(fs.readFileSync(path.join(JS, '01-bausteine.js'), 'utf8'))
    + '\n' + ohneModulhuelle(fs.readFileSync(path.join(JS, '09-catalog.js'), 'utf8'));
  if (!entprellt) {
    const vorher = code;
    code = code.replace(/_catLadeTimer = setTimeout\(tun, \d+\)/, 'tun()');
    assert.notEqual(code, vorher,
      'Die Gegenprobe hat die Entprellung nicht gefunden. Entweder heisst sie ' +
      'anders — dann diese Datei nachziehen — oder es gibt sie nicht mehr.');
  }

  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="cat-search"/>
    <select id="cat-theme"><option value=""></option></select>
    <select id="cat-year-from"><option value=""></option></select>
    <select id="cat-year-to"><option value=""></option></select>
    <select id="cat-sort"><option value="year_desc" selected></option></select>
    <div id="cat-count"></div><div id="catalog-grid"></div>
    <div id="cat-modal"></div><button id="cat-m-add"></button>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  const daten = [];
  for (let i = 0; i < SETS; i++) {
    daten.push({ set_number: `${i}-1`, name: `Set ${i}`, year: 2000 + (i % 27),
      theme_id: 1, theme_name: 'X', num_parts: 100, image_url: '',
      owned: false, owned_quantity: 0 });
  }

  const abrufe = [];
  w.api = (_methode, url) => {
    if (url.startsWith('/v1/catalog/meta')) {
      return Promise.resolve({ success: true, themes: [], year_min: 2000, year_max: 2026, year_counts: [] });
    }
    if (url.startsWith('/v1/catalog/sets?')) {
      const p = new w.URLSearchParams(url.split('?')[1]);
      const seite = parseInt(p.get('page') || '1', 10);
      abrufe.push(seite);
      return Promise.resolve({ success: true, total: SETS, page: seite,
        sets: daten.slice((seite - 1) * 60, seite * 60) });
    }
    if (url.startsWith('/v1/catalog/year-verteilung')) {
      return Promise.resolve({ success: true, years: [] });
    }
    return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
  };
  Object.assign(w, require('./helpers/markup').markupHelfer());
  w.eval(`
    window.G = id => document.getElementById(id);
    window.alle = (s, w = document) => [...w.querySelectorAll(s)]; window.eins = (s, w = document) => w.querySelector(s);
    window.t = k => k; window.tRaw = k => k;
    window.locale = () => 'de-CH'; window.toast = () => {}; window.meldeTreffer = () => {};
    window.PARTS_ICON_SVG = ''; window.setScrollLabel = () => {};
    window.imgUrl = s => s;
    window.bildTag = o => '<img src="' + o.src + '" alt="">'; window.platzhalterInhalt = () => '';
    window.thumbUrl = s => s; window.fullUrl = s => s; window.detailZeile = () => '';
  `);

  // Echte Blocklagen statt der Nullen, die jsdom ohne Layout liefert. Sonst
  // gilt JEDER Block als sichtbar, _ladeSichtbareSeiten() laedt einmal alles
  // und der Zug misst nichts mehr.
  let rollY = 0;
  Object.defineProperty(w, 'scrollY', { get: () => rollY, configurable: true });
  Object.defineProperty(w, 'innerHeight', { get: () => 800, configurable: true });
  w.Element.prototype.getBoundingClientRect = function () {
    const nr = this.dataset && this.dataset.page;
    if (!nr) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const n = parseInt(nr, 10);
    return { top: (n - 1) * BLOCK_HOEHE - rollY, bottom: n * BLOCK_HOEHE - rollY,
             left: 0, right: 0, width: 0, height: BLOCK_HOEHE };
  };

  w.eval(code);
  w.eval('initCatalog()');
  await warte(300);
  const vorDemZug = abrufe.length;

  const maxRollen = SEITEN * BLOCK_HOEHE - 800;
  for (let i = 0; i < SCHRITTE; i++) {
    rollY = Math.round((i / (SCHRITTE - 1)) * maxRollen);
    w.dispatchEvent(new w.Event('scroll'));
    await warte(SCHRITT_MS);
  }
  await warte(400);   // Ruhe nach dem Loslassen — jetzt darf geladen werden

  const imZug = abrufe.slice(vorDemZug);
  const zustand = {
    anzahl: imZug.length,
    seiten: [...new Set(imZug)].sort((a, b) => a - b),
    aufbau: vorDemZug,
  };
  dom.window.close();
  return zustand;
}

test('Katalog: ein Zug ueber die Leiste laedt das Ziel, nicht den Weg dorthin', async () => {
  const mit  = await zugMessen(true);
  const ohne = await zugMessen(false);

  // Der Pruefstand muss ueberhaupt etwas tun: Beim Aufbau wird die erste Seite
  // geholt. Bliebe das aus, waere „wenige Abrufe" bedeutungslos.
  assert.ok(mit.aufbau >= 1, `Der Aufbau holte keine Seite (${mit.aufbau}) — der Pruefstand laeuft leer`);

  // Die Gegenprobe belegt, dass der Zug ueberhaupt ueber viele Seiten fuehrt.
  // Ohne sie koennte die Leiste auch nur ein paar Bloecke ueberstreichen.
  assert.ok(ohne.seiten.length >= 25,
    `Ohne die Ruhe wurden nur ${ohne.seiten.length} Seiten geholt. Dann fuehrt ` +
    `der Zug gar nicht ueber den ganzen Katalog und diese Messung sagt nichts aus.`);

  // Und die eigentliche Zusicherung: MIT der Ruhe bleibt es bei einer Handvoll.
  assert.ok(mit.anzahl <= 10,
    `Ein Zug ueber die Leiste loeste ${mit.anzahl} Seitenabrufe aus (Seiten ` +
    `${JSON.stringify(mit.seiten)}). Erwartet ist das Ziel samt Nachbarn. ` +
    `Geladen wird offenbar wieder unterwegs — genau Marcos „dauert einige Sekunden".`);

  // Der Abstand ist die haltbarste Aussage: Beide Laeufe stehen im selben
  // Prozess unter denselben Bedingungen, eine Verzoegerung trifft beide.
  assert.ok(ohne.anzahl >= mit.anzahl * 5,
    `Mit Ruhe ${mit.anzahl} Abrufe, ohne ${ohne.anzahl} — die Ruhe macht keinen ` +
    `Unterschied mehr. Entweder laedt der Zug am Timer vorbei, oder die ` +
    `Gegenprobe trifft die falsche Stelle.`);

  // Das Ziel muss auch wirklich ankommen: Weniger laden ist nur dann richtig,
  // wenn das Ende des Zuges danach dasteht.
  const letzte = SEITEN;
  assert.ok(mit.seiten.includes(letzte),
    `Die Zielseite ${letzte} wurde nie geholt (${JSON.stringify(mit.seiten)}) — ` +
    `dann spart die Entprellung Abrufe, indem sie den Sprung ins Leere laufen laesst.`);
});
