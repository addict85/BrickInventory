/**
 * Der PDF-Betrachter kann zoomen — und verliert dabei weder die Stelle noch
 * die linke Seitenhaelfte.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 *
 * Marcos Wunsch: „Kannst du bei den PDF Viewer in der Android App und der
 * Webapp dass man Zoom kann?" Anleitungen sind der Hauptfall — und wer in einer
 * Anleitung zoomt, will eine Teilenummer lesen, nicht die Seite wechseln.
 *
 * ── Was hier geprueft wird, und was NICHT ───────────────────────────────────
 *
 * Geprueft wird der echte public/js/12-pdfviewer.js in jsdom. jsdom rechnet
 * kein Layout, deshalb werden clientWidth/clientHeight und die Rollstaende hier
 * ausdruecklich gesetzt — ohne das waeren alle Masse 0 und jede Rechnung ginge
 * trivial auf. Ebenso gestellt: IntersectionObserver (gibt es in jsdom nicht)
 * und PDF.js.
 *
 * NICHT geprueft wird hier die FLEXBOX-Falle, also ob die linke Seitenhaelfte
 * beim Hineinzoomen erreichbar bleibt — dazu braucht es eine Maschine, die
 * Layout rechnet. Die liegt dem Kommentar in _pdfMassPlatzhalter() zugrunde und
 * wurde in Chromium 142 gemessen:
 *
 *                              Seite 1200px breit in 400px-Behaelter
 *                              scrollWidth   linker Rand erreichbar bei
 *   align-items:center (vorher)        800                        −400
 *   center + margin:0 auto            1200                           0
 *
 * Hier bleibt davon nur die Zusicherung, dass die auto-Raender ueberhaupt
 * gesetzt werden (Fall „Platzhalter traegt die auto-Raender"). Das ist eine
 * Aussage ueber den Bauteil, nicht ueber die Wirkung — die Wirkung steht oben
 * und ist gemessen. Eine schwaechere Zusicherung als die Messung, aber die
 * einzige, die in dieser Werkbank ueberhaupt etwas bedeutet.
 *
 * ── Die Gegenprobe laeuft MIT ───────────────────────────────────────────────
 *
 * Fall „Gegenprobe: ohne Ankerrechnung springt es" nimmt genau die beiden
 * Zeilen heraus, die den Ankerpunkt wiederherstellen, und besteht darauf, dass
 * die Stelle dann WEGLAEUFT. Ohne das hiesse „der Anker haelt" nur, dass in
 * dieser Werkbank gar nichts rollt — der haeufigste Weg, auf dem sich eine
 * Messung selbst bestaetigt.
 *
 * Ausserdem in Chromium 142 von Hand nachgefahren (playwright-core, echtes
 * Layout, gefaelschtes PDF.js, 20 Seiten A4): Anker haelt auf 0,30 px genau;
 * bei 477 % sind linker und rechter Seitenrand beide erreichbar (scrollWidth
 * 2728 = volle Seitenbreite); Strg+Rad zoomt, Rad ohne Strg rollt weiter
 * (scrollTop 82 → 382); Tasten +/−/0 wirken; zwei Finger auseinander 100 % →
 * 142 %, zusammen 244 % → 209 %; der Leinwandriegel greift bei 16,0 MPixel
 * (3363 x 4758). Das steht hier, weil playwright-core keine Abhaengigkeit
 * dieses Projekts ist und der Lauf deshalb nicht Teil der Testreihe sein kann.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const QUELLE = path.join(__dirname, '..', 'public', 'js', '12-pdfviewer.js');

const BEHAELTER_W = 600;
const BEHAELTER_H = 400;
const SEITE_W = 595, SEITE_H = 842;   // A4 bei scale 1, so liefert es PDF.js
const SEITEN = 20;

/** import/export entfernen — die Datei wird hier als klassisches Skript ausgewertet. */
function ohneModulhuelle(src) {
  return src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
}

/**
 * Eine Werkbank mit dem echten Betrachter darin.
 *
 * @param {(code: string) => string} [umbau] Gegenprobe: baut den Quelltext um,
 *        bevor er ausgewertet wird. Muss etwas aendern, sonst schlaegt es fehl.
 */
async function werkbank(umbau) {
  let code = ohneModulhuelle(fs.readFileSync(QUELLE, 'utf8'));
  if (umbau) {
    const vorher = code;
    code = umbau(code);
    assert.notEqual(code, vorher,
      'Die Gegenprobe hat ihre Stelle im Quelltext nicht gefunden. Entweder ' +
      'heisst sie anders — dann diese Datei nachziehen — oder es gibt sie nicht mehr.');
  }

  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="pdf-viewer-modal" style="display:none">
      <div id="pdf-viewer-title"></div>
      <button id="pdf-viewer-zoom-out"></button>
      <button id="pdf-viewer-zoom">100%</button>
      <button id="pdf-viewer-zoom-in"></button>
      <a id="pdf-viewer-download" download href="#"></a>
      <div id="pdf-viewer-loading"></div>
      <div id="pdf-viewer-pages"></div>
    </div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  // Masse und Rollstaende von Hand — jsdom rechnet kein Layout.
  const behaelter = w.document.getElementById('pdf-viewer-pages');
  let rollX = 0, rollY = 0;
  Object.defineProperty(behaelter, 'clientWidth', { get: () => BEHAELTER_W, configurable: true });
  Object.defineProperty(behaelter, 'clientHeight', { get: () => BEHAELTER_H, configurable: true });
  Object.defineProperty(behaelter, 'scrollLeft', {
    get: () => rollX, set: v => { rollX = Math.max(0, v); }, configurable: true });
  Object.defineProperty(behaelter, 'scrollTop', {
    get: () => rollY, set: v => { rollY = Math.max(0, v); }, configurable: true });

  /**
   * Gestellter IntersectionObserver — jsdom hat keinen.
   *
   * Der Rueckruf kommt ASYNCHRON, und das ist nicht Bequemlichkeit, sondern der
   * Punkt: Der echte Observer liefert seine Meldungen als eigene Aufgabe nach
   * dem Layout, nie im observe()-Aufruf selbst. Eine erste Fassung dieser
   * Werkbank rief synchron zurueck — damit lief der neue Renderauftrag an,
   * BEVOR ein veralteter seine Leinwand einhaengen konnte, und die Gegenprobe
   * zum Generationszaehler konnte gar nichts zeigen. Der Fehler sass in der
   * Werkbank, nicht im Betrachter.
   *
   * Der erste Rueckruf nach observe() ist dagegen echtes Verhalten: Darauf
   * beruht, dass der Betrachter nach einem Zoom neu anmeldet statt zu hoffen.
   */
  const beobachtet = [];
  let sichtbareSeiten = new Set([1, 2]);
  w.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.ziele = new Set(); }
    observe(el) {
      const n = parseInt(el.dataset.page);
      this.ziele.add(el);
      beobachtet.push(n);
      // disconnect() hebt die Anmeldung auf, ein spaeteres observe() gilt wieder
      // — deshalb wird hier das ZIEL geprueft und nicht ein Schalter am
      // Observer. Mit einem Schalter blieb er nach dem ersten Zoom fuer immer
      // stumm, und drei Faelle wurden rot, ohne dass am Betrachter etwas fehlte.
      setTimeout(() => {
        if (this.ziele.has(el)) this.cb([{ target: el, isIntersecting: sichtbareSeiten.has(n) }]);
      }, 0);
    }
    disconnect() { this.ziele.clear(); }
  };

  // Gestelltes PDF.js. `anhalten` laesst Renderauftraege haengen, bis sie
  // ausdruecklich freigegeben werden — so laesst sich der Fall bauen, in dem
  // waehrend eines laufenden Renders gezoomt wird.
  const offeneRender = [];
  let anhalten = false;
  w.pdfjsLib = {
    getDocument() {
      return { promise: Promise.resolve({
        numPages: SEITEN,
        getPage() { return Promise.resolve({
          getViewport({ scale }) { return { width: SEITE_W * scale, height: SEITE_H * scale }; },
          render({ viewport }) {
            if (!anhalten) return { promise: Promise.resolve(), cancel() {} };
            let frei; const p = new Promise(r => { frei = r; });
            offeneRender.push({ frei, breite: Math.round(viewport.width) });
            return { promise: p, cancel() { frei(); } };
          }
        }); },
        destroy() {}
      }) };
    }
  };

  const aktionen = {};
  w.registerActions = o => Object.assign(aktionen, o);
  w.G = id => w.document.getElementById(id);
  w.esc = s => String(s ?? '');
  w.t = k => k;
  w.eval(code);

  const warte = ms => new Promise(r => setTimeout(r, ms));
  await w.window.openPdfViewer('/data/instructions/BI-3004.pdf', 'Test');
  await warte(40);

  return {
    w, behaelter, aktionen, warte, beobachtet, offeneRender,
    set anhalten(v) { anhalten = v; },
    set sichtbar(v) { sichtbareSeiten = new Set(v); },
    faktor: () => parseFloat(w.document.getElementById('pdf-viewer-zoom').textContent) / 100,
    platzhalter: () => [...behaelter.querySelectorAll('.pdf-page-ph')],
    /** Wo im Dokument liegt die Mitte des Sichtfelds — in Einheiten von Zoom 1? */
    stelle() {
      const f = parseFloat(w.document.getElementById('pdf-viewer-zoom').textContent) / 100;
      return (behaelter.scrollTop + BEHAELTER_H / 2) / f;
    }
  };
}

test('Zoom im PDF-Betrachter', async (t) => {

  await t.test('Grundzustand ist 100 % und der Minus-Knopf ist abgeschaltet', async () => {
    const b = await werkbank();
    assert.equal(b.faktor(), 1);
    assert.equal(b.w.document.getElementById('pdf-viewer-zoom-out').disabled, true,
      '1x ist der untere Anschlag — darunter gibt es nichts zu sehen.');
    assert.equal(b.platzhalter().length, SEITEN);
  });

  await t.test('Platzhalter traegt die auto-Raender', async () => {
    const b = await werkbank();
    const stil = b.platzhalter()[0].style;
    assert.equal(stil.marginLeft, 'auto');
    assert.equal(stil.marginRight, 'auto');
  });

  await t.test('Hineinzoomen vergroessert die Seite und meldet den Faktor', async () => {
    const b = await werkbank();
    const vorher = parseFloat(b.platzhalter()[0].style.width);
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(b.faktor(), 1.25);
    const nachher = parseFloat(b.platzhalter()[0].style.width);
    assert.ok(Math.abs(nachher / vorher - 1.25) < 0.01,
      `Platzhalter ging von ${vorher} auf ${nachher} — das sind nicht 1,25x.`);
  });

  await t.test('Die Anschlaege halten', async () => {
    const b = await werkbank();
    for (let i = 0; i < 25; i++) b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(b.faktor(), 5, 'oberer Anschlag');
    assert.equal(b.w.document.getElementById('pdf-viewer-zoom-in').disabled, true);
    for (let i = 0; i < 25; i++) b.aktionen.pdfZoomOut();
    await b.warte(40);
    assert.equal(b.faktor(), 1, 'unterer Anschlag');
    assert.equal(b.w.document.getElementById('pdf-viewer-zoom-out').disabled, true);
  });

  await t.test('Der Anker haelt: dieselbe Stelle bleibt in der Mitte', async () => {
    const b = await werkbank();
    b.behaelter.scrollTop = 7000;
    const vorher = b.stelle();
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    const nachher = b.stelle();
    assert.ok(Math.abs(nachher - vorher) < 1,
      `Die Stelle ist von ${vorher.toFixed(1)} auf ${nachher.toFixed(1)} gewandert ` +
      `(${Math.abs(nachher - vorher).toFixed(1)} Einheiten). Beim Zoomen soll ` +
      `der Punkt in der Sichtfeldmitte stehen bleiben.`);
  });

  await t.test('Gegenprobe: ohne Ankerrechnung springt es', async () => {
    // Die Wiederherstellung herausnehmen — die Rollstaende bleiben, wo sie waren.
    const b = await werkbank(code => code
      .replace('container.scrollLeft = dokX * ziel - ax;', '')
      .replace('container.scrollTop = dokY * ziel - ay;', ''));
    b.behaelter.scrollTop = 7000;
    const vorher = b.stelle();
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    const nachher = b.stelle();
    assert.ok(Math.abs(nachher - vorher) > 100,
      `Ohne Ankerrechnung muesste die Stelle deutlich wandern, sie ging aber nur ` +
      `von ${vorher.toFixed(1)} auf ${nachher.toFixed(1)}. Dann misst der Fall ` +
      `darueber nichts.`);
  });

  await t.test('Nach dem Zoomen werden die sichtbaren Seiten neu gerendert', async () => {
    const b = await werkbank();
    const vorher = b.beobachtet.length;
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(b.beobachtet.length, vorher + SEITEN,
      'Ein IntersectionObserver meldet sich NICHT von selbst, wenn ein ' +
      'beobachtetes Element nur seine Groesse aendert. Ohne erneutes observe() ' +
      'blieben die sichtbaren Seiten nach dem Zoomen leer.');
    assert.ok(b.platzhalter()[0].querySelector('canvas'),
      'Seite 1 ist sichtbar und muesste wieder eine Leinwand haben.');
  });

  /**
   * Ein Render laeuft asynchron. Wird waehrenddessen gezoomt, ist der
   * Platzhalter beim Fertigwerden eine andere Groesse — die alte Leinwand
   * haette dort nichts mehr zu suchen.
   *
   * @param {boolean} mitWaechter false = Gegenprobe, der Generationszaehler
   *        wird herausgenommen.
   * @returns {number[]} Breiten der Leinwaende, die am Ende haengen.
   */
  async function veralteterRender(mitWaechter) {
    const b = await werkbank(mitWaechter ? undefined : code =>
      code.replace('if (gen !== _pdfZoomGen) {', 'if (false) {'));
    b.anhalten = true;
    b.aktionen.pdfZoomIn();              // Stufe 1: Auftraege bleiben haengen
    await b.warte(40);
    assert.ok(b.offeneRender.length > 0,
      'Die Werkbank haelt keinen Auftrag an — der Fall misst nichts.');
    const alte = b.offeneRender.splice(0);
    const alteBreiten = alte.map(r => r.breite);

    b.aktionen.pdfZoomIn();              // Stufe 2: waehrend Stufe 1 noch laeuft
    await b.warte(40);
    // Erst die NEUEN fertig werden lassen, dann die alten. Genau diese
    // Reihenfolge ist der Schadensfall: Der alte Durchlauf hat weniger zu
    // rendern und kommt bei starkem Zoom regelmaessig zuletzt. Andersherum
    // raeumt der neue hinter ihm auf, und der Fehler bliebe unsichtbar.
    b.offeneRender.forEach(r => r.frei());
    await b.warte(30);
    alte.forEach(r => r.frei());
    await b.warte(40);

    const haengen = b.platzhalter().map(ph => {
      const c = ph.querySelector('canvas'); return c ? c.width : 0;
    }).filter(Boolean);
    return { haengen, alteBreiten, soll: Math.round(parseFloat(b.platzhalter()[0].style.width)) };
  }

  await t.test('Ein Render, der ueber einen Zoom hinweglaeuft, wird verworfen', async () => {
    const r = await veralteterRender(true);
    const veraltet = r.haengen.filter(w => w !== r.soll);
    assert.deepEqual(veraltet, [],
      `Leinwaende mit der alten Aufloesung (${r.alteBreiten.join(', ')}px) haengen in ` +
      `Platzhaltern, die inzwischen ${r.soll}px breit sind. Sie werden gestreckt ` +
      `— und der neue Durchlauf kehrt oben um, weil schon eine Leinwand da ist. ` +
      `Die Seite bliebe grob. Dagegen steht der Generationszaehler in _renderPdfPage.`);
  });

  await t.test('Gegenprobe: ohne Generationszaehler haengt die alte Leinwand drin', async () => {
    const r = await veralteterRender(false);
    const veraltet = r.haengen.filter(w => w !== r.soll);
    assert.ok(veraltet.length > 0,
      `Ohne den Zaehler muesste mindestens eine veraltete Leinwand (eine von ` +
      `${r.alteBreiten.join(', ')}px) in einem ${r.soll}px breiten Platzhalter ` +
      `landen; haengen geblieben sind ${r.haengen.join(', ') || 'gar keine'}. ` +
      `Dann prueft der Fall darueber nichts.`);
  });

  await t.test('Strg + Rad zoomt, Rad allein nicht', async () => {
    const b = await werkbank();
    const rad = (strg) => b.behaelter.dispatchEvent(new b.w.WheelEvent('wheel', {
      deltaY: -120, ctrlKey: strg, clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
    rad(false);
    await b.warte(40);
    assert.equal(b.faktor(), 1, 'Ohne Zusatztaste bleibt das Rad beim Rollen.');
    rad(true);
    await b.warte(40);
    assert.equal(b.faktor(), 1.25);
  });

  await t.test('Die Zuhoerer haengen nur einmal, auch nach mehrfachem Oeffnen', async () => {
    const b = await werkbank();
    for (let i = 0; i < 5; i++) {
      b.aktionen.closePdfViewer();
      await b.w.window.openPdfViewer('/data/instructions/BI-3004.pdf', 'Test');
      await b.warte(40);
    }
    b.behaelter.dispatchEvent(new b.w.WheelEvent('wheel', {
      deltaY: -120, ctrlKey: true, clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
    await b.warte(40);
    assert.equal(b.faktor(), 1.25,
      'Ein Raddreh hat mehr als einen Schritt bewirkt — dann sammelt jedes ' +
      'geoeffnete PDF einen weiteren Zuhoerer an.');
  });
});
