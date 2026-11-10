/**
 * Der eigene Scrollbalken der Anwendung erscheint wirklich.
 * Ausführlich: docs/begruendungen/test/app-scrollbar.test.js.md#kopf
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
 * Ausführlich: docs/begruendungen/test/app-scrollbar.test.js.md#scrollbalkencode
 */
function scrollbalkenCode() {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'js', '15-scrollbar.js'), 'utf8');
  return roh.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '');
}

/** Kleine Bühne mit vorgetäuschtem Layout — jsdom rechnet keines. */
function buehne({ scrollHeight = 5000, innerHeight = 800 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval('window.G = id => document.getElementById(id);');
  Object.assign(w, require('./helpers/markup').markupHelfer());
  w.eval(`
    Object.defineProperty(document.documentElement,'scrollHeight',{value:${scrollHeight},configurable:true});
    Object.defineProperty(window,'innerHeight',{value:${innerHeight},configurable:true});
    window.ResizeObserver = class { constructor(cb){this.cb=cb;} observe(){} disconnect(){} };
  `);
  w.eval(scrollbalkenCode());
  return w;
}

test('der Balken wird erzeugt und erscheint bei rollbarer Seite', () => {
  const w = buehne();
  w.eval('initScrollbalken();');
  const bar = w.document.getElementById('app-scrollbar');
  assert.ok(bar,
    'Kein Balken im Dokument. Er darf NICHT aus dem Markup kommen — das Skript ' +
    'läuft vor dem Ende des Body, dort notiert gäbe es ihn beim Start nicht.');
  assert.equal(bar.style.display, 'block', 'Der Balken bleibt verborgen, obwohl die Seite rollbar ist');
  const thumb = w.document.getElementById('app-scrollbar-thumb');
  assert.ok(thumb && parseInt(thumb.style.height, 10) > 0,
    `Der Griff hat keine Höhe: ${thumb && thumb.style.height}`);
});

test('ohne Rollbereich verschwindet er wieder', () => {
  // Gegenrichtung: Ein Balken über einer Seite, die ganz ins Fenster passt,
  // wäre nur Zierrat — und ohne diese Prüfung wäre der Test auch grün, wenn
  // die Sichtbarkeit fest verdrahtet wäre.
  const w = buehne({ scrollHeight: 700, innerHeight: 800 });
  w.eval('initScrollbalken();');
  assert.equal(w.document.getElementById('app-scrollbar').style.display, 'none');
});

test('das Neuzeichnen ist gedrosselt', () => {
  // zeichneScrollbalken() LIEST Layout (scrollHeight). Ungedrosselt erzwingt
  // jedes Scroll-Ereignis eine Neuberechnung — dutzende Male je Sekunde. Die
  // Seite fühlt sich dann zäh an, obwohl der Server längst geantwortet hat.
  const code = scrollbalkenCode();
  assert.match(code, /requestAnimationFrame\(/,
    'Das Neuzeichnen hängt ungedrosselt am Scroll-Ereignis');
  const i = code.indexOf("addEventListener('scroll'");
  assert.ok(i > 0, 'Kein Scroll-Zuhörer');
  assert.match(code.slice(0, i), /angefordert/,
    'Der Zuhörer ruft nicht die gedrosselte Fassung');
});

test('das Etikett verschwindet nach dem Ziehen wieder', () => {
  // Marcos Bild
  // Ausführlich: docs/begruendungen/test/app-scrollbar.test.js.md#code
  const code = scrollbalkenCode();
  const i = code.indexOf('const ende =');
  assert.ok(i > 0, 'Kein Ende-Handler');
  // Bis zum ENDE des Handlers schneiden, nicht nach fester Länge: Die
  // Begründung im Kommentar ist länger als jedes Fenster, das ich raten würde
  // — dieselbe Falle, die in diesem Projekt schon fünfmal zugeschlagen hat.
  const fn = code.slice(i, code.indexOf('\n  };', i));
  assert.match(fn, /label\.style\.display = ''/,
    'Die inline gesetzte Sichtbarkeit wird nach dem Ziehen nicht zurückgenommen — ' +
    'dann bleibt das Etikett in jedem Reiter stehen');
});

test('das Etikett wird beim Verlassen des Katalogs abgemeldet', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '25-navigation.js'), 'utf8');
  assert.match(gal, /if \(tab !== 'catalog'\) setScrollLabel\(null\)/,
    'Beim Reiterwechsel wird die Etikett-Funktion nicht abgemeldet');
});

test('das Etikett bleibt leer, solange es niemand anmeldet', () => {
  // Der Balken gehört der ganzen Anwendung; das Jahr ist eine Zutat des
  // Katalogs. Ohne Anmeldung darf dort nichts stehen — sonst zeigte jeder
  // Reiter eine Zahl, die für ihn nichts bedeutet.
  const code = scrollbalkenCode();
  assert.match(code, /export let scrollLabelFn = null|let scrollLabelFn = null/,
    'Es gibt keine Anmeldestelle für das Etikett');
  assert.match(code, /scrollLabelFn \? scrollLabelFn\(\) : null/,
    'Das Etikett fragt die angemeldete Funktion nicht ab');
});
