/**
 * Barrierefreiheit — die strukturellen Zusicherungen.
 *
 * ── Ausgangslage ────────────────────────────────────────────────────────────
 * In 83 KB index.html stand genau EIN aria-Attribut, kein einziges role=, und
 * keines der 59 <label> war mit seinem Feld verknüpft: Das Muster war
 * durchgehend `<label>Text</label><input id="x">` — nebeneinander, aber ohne
 * for=. Für einen Screenreader ist das Feld damit unbeschriftet, und ein Klick
 * auf die Beschriftung setzt den Fokus nicht ins Feld.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Bewusst nur Struktur, keine Optik und keine konkreten Texte:
 *   1. Jedes Formularfeld ist beschriftet — per for=, per umschliessendem
 *      Label oder per aria-label.
 *   2. Jedes for= zeigt auf ein Feld, das es gibt (ein Tippfehler wäre sonst
 *      unsichtbar und genauso kaputt wie gar kein Label).
 *   3. Modale Overlays tragen role="dialog" und aria-modal.
 *
 * Ausführen: npm test
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** Felder, die bewusst keine sichtbare Beschriftung brauchen. */
const EXEMPT = new Set([
  'cfg-import-file',        // verstecktes <input type="file">, ausgelöst über einen beschrifteten Knopf
]);

/** Alle id-tragenden Formularfelder aus dem Markup. */
function formFields() {
  return [...HTML.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
    .map(m => ({ tag: m[1], attrs: m[2], raw: m[0] }))
    .filter(f => /\bid="/.test(f.attrs))
    .map(f => ({ ...f, id: f.attrs.match(/\bid="([^"]+)"/)[1] }));
}

test('jedes Formularfeld ist beschriftet', () => {
  const labelledFor = new Set([...HTML.matchAll(/<label for="([^"]+)"/g)].map(m => m[1]));
  // Umschliessende Labels: <label …><input id="x">
  const wrapped = new Set([...HTML.matchAll(/<label\b[^>]*>\s*<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]));

  const bare = formFields().filter(f =>
    !labelledFor.has(f.id) &&
    !wrapped.has(f.id) &&
    !/aria-label=/.test(f.attrs) &&
    !/type="hidden"/.test(f.attrs) &&
    !EXEMPT.has(f.id));

  assert.deepEqual(bare.map(f => f.id), [],
    `Ohne Beschriftung: ${bare.map(f => f.id).join(', ')}`);
});

test('jedes for= zeigt auf ein existierendes Feld', () => {
  const fieldIds = new Set(formFields().map(f => f.id));
  const dangling = [...HTML.matchAll(/<label for="([^"]+)"/g)]
    .map(m => m[1])
    .filter(id => !fieldIds.has(id));
  assert.deepEqual(dangling, [], `for= ohne Ziel: ${dangling.join(', ')}`);
});

test('ein umschliessendes Label trägt kein fremdes for=', () => {
  // Beim maschinellen Nachrüsten der for=-Attribute sind zwei Labels erwischt
  // worden, die ihr Feld UMSCHLIESSEN — sie zeigten danach auf das jeweils
  // nächste fremde Feld. Ein Klick hätte dann den Fokus woanders hin gesetzt.
  const wrong = [...HTML.matchAll(/<label for="([^"]+)"[^>]*>\s*<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)]
    .filter(m => m[1] !== m[2])
    .map(m => `${m[1]} → ${m[2]}`);
  assert.deepEqual(wrong, [], `Fehlzuordnung: ${wrong.join(', ')}`);
});

test('modale Overlays sind als Dialog ausgezeichnet', () => {
  const modals = [...HTML.matchAll(/<div class="ovl" id="([a-z0-9-]*modal)"([^>]*)>/g)];
  assert.ok(modals.length >= 5, `Nur ${modals.length} Modals gefunden — Prüfung liefe ins Leere`);
  const missing = modals
    .filter(m => !/role="dialog"/.test(m[2]) || !/aria-modal="true"/.test(m[2]))
    .map(m => m[1]);
  assert.deepEqual(missing, [], `Ohne Dialog-Semantik: ${missing.join(', ')}`);
});

test('die Sprache steht am <html>-Element', () => {
  // Ohne lang= rät der Screenreader die Aussprache — bei gemischt deutsch-
  // englischen Oberflächen hörbar falsch. utils/indexHtml.ts setzt den Wert
  // serverseitig passend zur ausgelieferten Sprachdatei.
  assert.match(HTML, /<html[^>]*\slang="[a-z]{2}"/, 'lang= fehlt am <html>');
});

test('bedeutungstragende Zeichen in der Finanztabelle sind erklärt', () => {
  // Die Preisstatus-Spalte besteht aus einem einzigen Zeichen. Ohne title
  // (Maus) und aria-label (Vorleseprogramm) ist sie unlesbar — Marco musste
  // nachfragen, was ⚡ und 🔴 bedeuten sollten. Kommentare vorher ausblenden,
  // sonst hält dieser Erklärtext die Prüfung selbst grün.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '04-finance.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  const badges = [...src.matchAll(/<span class="pst[^"]*"([^>]*)>/g)].map(m => m[1]);
  assert.equal(badges.length, 2, `Erwartet genau zwei Zustände (Preis da / Preis fehlt), gefunden: ${badges.length}`);
  for (const attrs of badges) {
    assert.match(attrs, /\btitle="/,      `Plakette ohne title: ${attrs}`);
    assert.match(attrs, /\baria-label="/, `Plakette ohne aria-label: ${attrs}`);
  }

  // Die Texte kommen aus den Sprachdateien, nicht als Literal im Code.
  for (const key of ['finance.price_loaded', 'finance.price_failed', 'finance.price_status']) {
    assert.ok(src.includes(`'${key}'`), `Schlüssel ${key} wird nicht verwendet`);
  }
});
