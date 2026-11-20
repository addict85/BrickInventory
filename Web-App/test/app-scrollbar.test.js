/**
 * Der eigene Scrollbalken der Anwendung erscheint wirklich.
 *
 * Gegenprobe (durchgeführt): das Erzeugen entfernt und stattdessen wie vorher
 * `G('app-scrollbar')` erwartet → „Balken erzeugt" wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

/**
 * Den Scrollbalken-Code auswerten.
 */
function scrollbarCode() {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'js', 'scrollbar.js'), 'utf8');
  return roh.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '');
}

/** Kleine Bühne mit vorgetäuschtem Layout — jsdom rechnet keines. */
function stage({ scrollHeight = 5000, innerHeight = 800 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.eval('window.G = id => document.getElementById(id);');
  Object.assign(w, require('./helpers/markup').markupHelper());
  w.eval(`
    Object.defineProperty(document.documentElement,'scrollHeight',{value:${scrollHeight},configurable:true});
    Object.defineProperty(window,'innerHeight',{value:${innerHeight},configurable:true});
    window.ResizeObserver = class { constructor(cb){this.cb=cb;} observe(){} disconnect(){} };
  `);
  w.eval(scrollbarCode());
  return w;
}

test('the bar is created and appears on a scrollable page', () => {
  const w = stage();
  w.eval('initScrollbar();');
  const bar = w.document.getElementById('app-scrollbar');
  assert.ok(
    bar,
    'Kein Balken im Dokument. Er darf NICHT aus dem Markup kommen — das Skript ' +
      'läuft vor dem Ende des Body, dort notiert gäbe es ihn beim Start nicht.',
  );
  assert.equal(bar.style.display, 'block', 'Der Balken bleibt verborgen, obwohl die Seite rollbar ist');
  const thumb = w.document.getElementById('app-scrollbar-thumb');
  assert.ok(thumb && parseInt(thumb.style.height, 10) > 0, `Der Griff hat keine Höhe: ${thumb?.style.height}`);
});

test('without a scroll area it disappears again', () => {
  // Gegenrichtung: Ein Balken über einer Seite, die ganz ins Fenster passt,
  // wäre nur Zierrat — und ohne diese Prüfung wäre der Test auch grün, wenn
  // die Sichtbarkeit fest verdrahtet wäre.
  const w = stage({ scrollHeight: 700, innerHeight: 800 });
  w.eval('initScrollbar();');
  assert.equal(w.document.getElementById('app-scrollbar').style.display, 'none');
});

test('redrawing is throttled', () => {
  // drawScrollbar() LIEST Layout (scrollHeight). Ungedrosselt erzwingt
  // jedes Scroll-Ereignis eine Neuberechnung — dutzende Male je Sekunde. Die
  // Seite fühlt sich dann zäh an, obwohl der Server längst geantwortet hat.
  const code = scrollbarCode();
  assert.match(code, /requestAnimationFrame\(/, 'Das Neuzeichnen hängt ungedrosselt am Scroll-Ereignis');
  const i = code.indexOf("addEventListener('scroll'");
  assert.ok(i > 0, 'Kein Scroll-Zuhörer');
  assert.match(code.slice(0, i), /angefordert/, 'Der Zuhörer ruft nicht die gedrosselte Fassung');
});

test('the label disappears again after dragging', () => {
  // Marcos Bild
  const code = scrollbarCode();
  const i = code.indexOf('const ende =');
  assert.ok(i > 0, 'Kein Ende-Handler');
  // Bis zum ENDE des Handlers schneiden, nicht nach fester Länge: Die
  // Begründung im Kommentar ist länger als jedes Fenster, das ich raten würde
  // — dieselbe Falle, die in diesem Projekt schon fünfmal zugeschlagen hat.
  const fn = code.slice(i, code.indexOf('\n  };', i));
  assert.match(
    fn,
    /label\.style\.display = ''/,
    'Die inline gesetzte Sichtbarkeit wird nach dem Ziehen nicht zurückgenommen — ' +
      'dann bleibt das Etikett in jedem Reiter stehen',
  );
});

test('the label is unregistered when leaving the catalog', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'navigation.js'), 'utf8');
  assert.match(
    gal,
    /if \(tab !== 'catalog'\) setScrollLabel\(null\)/,
    'Beim Reiterwechsel wird die Etikett-Funktion nicht abgemeldet',
  );
});

test('the label stays empty as long as nobody registers it', () => {
  // Der Balken gehört der ganzen Anwendung; das Jahr ist eine Zutat des
  // Katalogs. Ohne Anmeldung darf dort nichts stehen — sonst zeigte jeder
  // Reiter eine Zahl, die für ihn nichts bedeutet.
  const code = scrollbarCode();
  assert.match(
    code,
    /export let scrollLabelFn = null|let scrollLabelFn = null/,
    'Es gibt keine Anmeldestelle für das Etikett',
  );
  assert.match(
    code,
    /scrollLabelFn \? scrollLabelFn\(\) : null/,
    'Das Etikett fragt die angemeldete Funktion nicht ab',
  );
});
