/**
 * Frontend-Tests für public/js/10-mobile.js in jsdom.
 *
 * Unter 640px verwandelt mobile.css jede .dt-Tabelle in eine Kartenliste. Damit
 * dann noch erkennbar ist, welcher Wert wozu gehört, braucht jede <td> die
 * Beschriftung ihrer Spalte in data-label — das CSS blendet sie über ::before
 * ein.
 *
 * Diese Attribute setzt ein MutationObserver nachträglich, statt alle zehn
 * Tabellen-Templates in sechs Dateien anzufassen. Der Nutzen steht und fällt
 * damit, dass die Zuordnung stimmt: mehrzeilige Köpfe (Finanztabellen) und
 * colspan (Gruppenzeilen) kommen in dieser Codebasis beide vor.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', '10-mobile.js'), 'utf8');

/** Frisches Dokument mit geladenem 10-mobile.js. */
function boot(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml || ''}</body></html>`,
    { runScripts: 'outside-only' });
  dom.window.eval(SRC);
  return dom;
}

test('data-label kommt aus der Kopfzeile', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Nr.</th><th>Name</th><th>Preis</th></tr></thead>
      <tbody><tr><td>75192-1</td><td>Falcon</td><td>CHF 800</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('td')];
  assert.deepEqual(tds.map(td => td.getAttribute('data-label')),
    ['Nr.', 'Name', 'Preis']);
});

test('bei mehrzeiligem Kopf zählt die unterste Zeile', () => {
  // Kommt in den Finanztabellen vor: eine Gruppenüberschrift über den
  // eigentlichen Spaltennamen.
  const dom = boot(`
    <table class="dt">
      <thead>
        <tr><th colspan="2">Zeitraum</th></tr>
        <tr><th>Von</th><th>Bis</th></tr>
      </thead>
      <tbody><tr><td>2024</td><td>2026</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.deepEqual(tds.map(td => td.getAttribute('data-label')), ['Von', 'Bis']);
});

test('colspan verschiebt die Zuordnung nicht', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
      <tbody><tr><td colspan="2">zusammen</td><td>dritte</td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.equal(tds[0].getAttribute('data-label'), 'A');
  assert.equal(tds[1].getAttribute('data-label'), 'C',
    'Nach einem colspan=2 muss die nächste Zelle Spalte C treffen, nicht B');
});

test('leere Spaltenköpfe ergeben ein leeres Label', () => {
  // Aktionsspalten (Löschen-Button) haben kein <th>-Text; mobile.css blendet
  // die Beschriftung dann per content:none aus.
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody><tr><td>X</td><td><button>×</button></td></tr></tbody>
    </table>`);
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.equal(tds[1].getAttribute('data-label'), '');
});

test('nachträglich eingefügte Tabellen werden ebenfalls beschriftet', async () => {
  // Der eigentliche Zweck des Observers: Die Listen werden per innerHTML
  // gebaut, lange nach dem Laden des Skripts.
  const dom = boot('<div id="host"></div>');
  dom.window.document.getElementById('host').innerHTML = `
    <table class="dt">
      <thead><tr><th>Teil</th><th>Menge</th></tr></thead>
      <tbody><tr><td>3001</td><td>4</td></tr></tbody>
    </table>`;
  await new Promise(r => setTimeout(r, 20));   // MutationObserver ist asynchron
  const tds = [...dom.window.document.querySelectorAll('tbody td')];
  assert.deepEqual(tds.map(td => td.getAttribute('data-label')), ['Teil', 'Menge']);
});

test('vorhandene data-label werden nicht überschrieben', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td data-label="eigen">x</td></tr></tbody>
    </table>`);
  assert.equal(dom.window.document.querySelector('td').getAttribute('data-label'), 'eigen');
});

test('Tabellen ohne .dt bleiben unangetastet', () => {
  const dom = boot(`
    <table>
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td>x</td></tr></tbody>
    </table>`);
  assert.equal(dom.window.document.querySelector('td').hasAttribute('data-label'), false);
});

test('eine Tabelle wird nur einmal verarbeitet', () => {
  const dom = boot(`
    <table class="dt">
      <thead><tr><th>Kopf</th></tr></thead>
      <tbody><tr><td>x</td></tr></tbody>
    </table>`);
  const table = dom.window.document.querySelector('table');
  assert.equal(table.dataset.labelled, '1',
    'Ohne Markierung liefe der Observer bei jeder DOM-Änderung erneut über alle Tabellen');
});

test('mobile.css deckt beide Designs ab und steht ganz in Media Queries', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.css'), 'utf8');
  // Alles ausserhalb einer @media-Regel würde den Desktop verändern.
  const outside = css
    .replace(/\/\*[\s\S]*?\*\//g, '')          // Kommentare weg
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')  // Media-Blöcke weg
    .trim();
  assert.equal(outside, '',
    `Regeln ausserhalb von @media würden den Desktop treffen:\n${outside.slice(0, 300)}`);

  assert.match(css, /\[data-theme="brick"\]/,
    'Das Stein-Design braucht eigene Regeln für Noppen und Innenabstände');
  assert.match(css, /#login-screen/,
    'Die Login-Seite muss mit abgedeckt sein');
  assert.match(css, /font-size:\s*16px/,
    'Unter 16px zoomt iOS beim Fokussieren in Eingabefelder hinein');
});

test('index.html lädt mobile.css nach beiden Designs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const iTheme = html.indexOf('themes/brick.css');
  const iMobile = html.indexOf('mobile.css');
  const iBase = html.indexOf('styles.css');
  assert.ok(iMobile > 0, 'mobile.css wird nicht eingebunden');
  assert.ok(iMobile > iTheme && iMobile > iBase,
    'mobile.css muss NACH styles.css und dem Theme kommen, sonst gewinnt das Theme');
  // 10-mobile.js steht seit der Bündelung nicht mehr als eigenes <script>-Tag
  // in index.html, sondern in js/app.bundle.js. Geprüft wird deshalb, dass es
  // Teil des Bündels ist — inhaltlich dieselbe Zusicherung.
  // Seit der Umstellung auf ES-Module gibt es keine Dateiliste mehr, sondern
  // einen Modulgraphen: js/main.js importiert die Teile, esbuild bündelt sie.
  const entry = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(entry, /'\.\/10-mobile\.js'/,
    '10-mobile.js wird von js/main.js nicht importiert und würde nicht ausgeliefert');
  assert.match(html, /app\.bundle\.js/, 'Das Frontend-Bündel wird nicht eingebunden');
});
