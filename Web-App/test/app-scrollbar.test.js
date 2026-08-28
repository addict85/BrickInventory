/**
 * Der eigene Scrollbalken der Anwendung erscheint wirklich.
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 * „Der Scrollbalken des Browsers ist nun ausgeblendet, aber die App hat keinen
 * eigenen."
 *
 * ── Die Ursache, und warum sie so leicht zu übersehen war ───────────────────
 * `app.bundle.js` ist ein KLASSISCHES Skript — kein Modul, kein `defer`. Es
 * läuft, sobald der Parser es erreicht, und das ist VOR allem, was danach im
 * Markup steht. Das `<div id="app-scrollbar">` stand am Ende des Body, hinter
 * dem Skript. Beim Start gab es das Element also noch nicht,
 * `initScrollbalken()` kehrte still um (`if (!bar) return`) — und weil der
 * Balken des Browsers per CSS verborgen ist, hatte die Anwendung GAR KEINEN.
 *
 * Ein stiller Rückzug an einer Stelle, die nur einmal beim Start durchlaufen
 * wird: Keine Fehlermeldung, kein Eintrag in der Konsole, nichts zu sehen
 * ausser dem fehlenden Balken.
 *
 * Deshalb erzeugt die Anwendung das Element jetzt SELBST. Damit hängt der
 * Balken an keiner Reihenfolge im HTML mehr — und dieser Test prüft nicht die
 * Reihenfolge, sondern das Ergebnis: Ist die Seite rollbar, ist der Balken da.
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
 *
 * Er lag bis Nachtrag 136 in 01-core.js, und dieser Test schnitt ihn an der
 * Kommentarmarke „═══ Eigener Scrollbalken" heraus — der Rest der Datei bindet
 * beim Auswerten an Elemente der ganzen Oberfläche (Anmeldeformular, Reiter,
 * Dialoge), und die hier alle nachzubauen hiesse, das halbe index.html zu
 * kopieren.
 *
 * Seit dem Umzug IST js/15-scrollbar.js genau dieser Abschnitt. Der Schnitt
 * entfällt; die Importzeile am Kopf muss weg, weil hier kein Modulsystem läuft
 * (G() stellt die Bühne unten selbst bereit).
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
  assert.ok(thumb && parseInt(thumb.style.height) > 0,
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
  // ── Marcos Bild (Nachtrag 110) ────────────────────────────────────────────
  // Das Jahr „2027" stand in der GALERIE oben rechts, ohne dass jemand zog.
  //
  // Zwei Ursachen, beide in meinem Code:
  //
  // 1. Die CSS-Regel zeigt das Etikett nur während `.dragging`. rollen() setzt
  //    aber `style.display` DIREKT am Element, und eine Inline-Angabe schlägt
  //    jede Regel. Nach dem Loslassen blieb sie stehen — also blieb das
  //    Etikett stehen, in jedem Reiter.
  // 2. Der Katalog meldete seine Funktion nie ab. Sie lieferte weiter ein
  //    Jahr, auch dort, wo die Zahl nichts bedeutet.
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
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
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
