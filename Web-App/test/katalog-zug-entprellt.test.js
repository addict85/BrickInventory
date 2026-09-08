/**
 * Ein Zug ueber die Jahres-Leiste holt EINE Seite, nicht hundert.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 * Marcos Befund galt der App: „wenn ich im Katalog zu einem Jahr springe dauert
 * es einige Sekunden bis die Bilder angezeigt werden. wenn ich sonst scrolle
 * kommen sie fluessig." Dort lag der Abruf unmittelbar im Rueckruf der Leiste
 * und lief bei JEDEM Beruehrungspunkt; behoben ist er jetzt entprellt
 * (KatalogSprungEntprelltTest in der App).
 *
 * Beim Nachziehen in die Webapp zeigte sich: Hier ist die Entprellung laengst
 * da (Nachtrag 96, `_catLadeTimer`). Nachgezogen wird deshalb nicht der Code,
 * sondern die REGEL — denn geprueft war bisher nur, dass die Zeile
 * `_catLadeTimer = setTimeout(tun, …)` im Quelltext vorkommt
 * (catalog-frontend.test.js). Das ist eine Aussage ueber den Text, nicht ueber
 * das Verhalten: Wer `tun()` zusaetzlich an anderer Stelle sofort aufruft oder
 * den Ladeweg am Timer vorbeifuehrt, laesst jene Pruefung gruen.
 *
 * ── Was hier gemessen wird ──────────────────────────────────────────────────
 * Der echte public/js/09-catalog.js in jsdom, mit einem Katalog aus 6000 Sets
 * (100 Seitenbloecke) und ECHTEN Blocklagen — jsdom rechnet kein Layout, also
 * liefert getBoundingClientRect() hier Koordinaten aus der Seitennummer. Ohne
 * das gilt jeder Block als sichtbar und die Messung waere wertlos.
 *
 * Dann ein Zug ueber die ganze Leiste: 40 Rollschritte von oben nach unten.
 * Gezaehlt werden die /catalog/sets-Abrufe.
 *
 * ── Die Gegenprobe laeuft MIT ───────────────────────────────────────────────
 * Derselbe Zug ein zweites Mal, mit herausgenommener Ruhe (die eine Zeile
 * ersetzt durch den sofortigen Aufruf). Ohne sie hiesse „wenige Abrufe" nur,
 * dass der Pruefstand gar nichts ausloest — der haeufigste Weg, wie eine
 * Messung sich selbst bestaetigt.
 *
 * Gemessen mit genau dieser Einstellung (40 Schritte, 50 Seitenbloecke): MIT
 * der Ruhe 2 Abrufe — die Seiten 49 und 50, also das Ziel und sein Nachbar im
 * Vorlauf. OHNE sie 48 Abrufe fuer 48 verschiedene Seiten, praktisch der ganze
 * Weg dorthin.
 *
 * Die Zusicherungen unten lassen absichtlich Luft: Auf einem ausgelasteten
 * Laeufer kann zwischen zwei Rollschritten mehr Zeit vergehen als die Ruhe
 * lang ist, dann feuert der Timer schon waehrend des Zuges. Der ABSTAND
 * zwischen beiden Laeufen bleibt davon unberuehrt, weil beide im selben
 * Prozess unter denselben Bedingungen laufen — deshalb ist er die eigentliche
 * Zusicherung.
 *
 * Der Katalog ist hier mit 50 Bloecken kleiner als in Wirklichkeit (rund 420).
 * Das ist eine Frage der Laufzeit, nicht der Aussage: Der Gegenprobe-Lauf baut
 * jede geholte Seite wirklich auf, und 420 Bloecke kosteten ein Vielfaches,
 * ohne dass der Unterschied deutlicher wuerde.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

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
      const seite = parseInt(p.get('page') || '1');
      abrufe.push(seite);
      return Promise.resolve({ success: true, total: SETS, page: seite,
        sets: daten.slice((seite - 1) * 60, seite * 60) });
    }
    if (url.startsWith('/v1/catalog/year-verteilung')) {
      return Promise.resolve({ success: true, years: [] });
    }
    return Promise.resolve({ success: false, error: 'unbekannt: ' + url });
  };
  w.eval(`
    window.G = id => document.getElementById(id);
    window.t = k => k; window.esc = s => String(s ?? '');
    window.locale = () => 'de-CH'; window.toast = () => {};
    window.PARTS_ICON_SVG = ''; window.setScrollLabel = () => {};
    window.escUrl = s => String(s ?? ''); window.imgUrl = s => s;
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
    const n = parseInt(nr);
    return { top: (n - 1) * BLOCK_HOEHE - rollY, bottom: n * BLOCK_HOEHE - rollY,
             left: 0, right: 0, width: 0, height: BLOCK_HOEHE };
  };

  w.eval(code);
  const warte = ms => new Promise(r => setTimeout(r, ms));
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
