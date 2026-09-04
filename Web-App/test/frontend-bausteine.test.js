/**
 * Wiederkehrende Ansichtsteile stehen an EINER Stelle.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * 01-core.js sammelt WERKZEUGE: Escaping, Bild-URLs, Formatierung, Toasts,
 * Theme. Was fehlte, waren Bausteine für die ANSICHT — und die standen deshalb
 * als HTML-Zeichenkette in jedem Modul neu:
 *
 *   Detailzeile   15× in vier Modulen
 *   Ladeanzeige    5× in vier Modulen
 *
 * Wer die Detailzeile ändern will — Abstand, Trennlinie, Verhalten auf dem
 * Telefon —, musste alle fünfzehn finden. Und wer eine neue Detailansicht
 * baute, schrieb die sechzehnte ab, samt der Frage, ob `dl` oder `dt` die
 * richtige Klasse war.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Das Markup steht nur noch in 01-bausteine.js. Gefunden statt aufgezählt: Ein
 * neues Modul, das die Zeile wieder von Hand schreibt, fällt auf.
 *
 * KEIN Test auf den Wortlaut der Klassennamen — `dr`/`dl`/`dv` sind eine
 * innere Angelegenheit des Bausteins und dürfen sich ändern, solange CSS und
 * Baustein zusammenpassen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');
const BAUSTEIN = '01-bausteine.js';

/** Alle Frontend-Module ausser dem Bündel und dem Baustein selbst. */
function module_() {
  const alle = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
  const gefiltert = alle.filter(f => f !== 'app.bundle.js' && f !== BAUSTEIN);
  // Selbstbeweis: Findet die Schleife nichts, wäre jede Prüfung unten
  // stillschweigend grün.
  assert.ok(gefiltert.length >= 10,
    `nur ${gefiltert.length} Frontend-Module gefunden — Pfad falsch?`);
  return gefiltert;
}

test('die Detailzeile wird nirgends mehr von Hand gebaut', () => {
  const treffer = [];
  for (const f of module_()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((z, i) => {
      if (z.includes('class="dr"')) treffer.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(treffer, [],
    'Diese Stellen bauen die Detailzeile selbst:\n  ' + treffer.join('\n  ') +
    `\nSie gehört in ${BAUSTEIN} — detailZeile(label, wert, optionen).`);
});

test('die Ladeanzeige wird nirgends mehr von Hand gebaut', () => {
  const treffer = [];
  for (const f of module_()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((z, i) => {
      if (z.includes('class="loading"')) treffer.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(treffer, [],
    'Diese Stellen bauen die Ladeanzeige selbst:\n  ' + treffer.join('\n  ') +
    `\nSie gehört in ${BAUSTEIN} — ladeAnzeige(text, optionen).`);
});

test('der Baustein erzeugt das Markup, das die Stylesheets erwarten', () => {
  // Nicht der Wortlaut der Funktion, sondern ihr Ergebnis: Die drei Klassen
  // müssen so herauskommen, wie styles.css sie anspricht — sonst sieht die
  // Zeile nach dem Umzug anders aus, und das fällt an keinem anderen Test auf.
  const src = fs.readFileSync(path.join(JS, BAUSTEIN), 'utf8');
  for (const klasse of ['class="dr"', 'class="dl"', 'class="dv"', 'class="loading"', 'class="spin"']) {
    assert.ok(src.includes(klasse), `${BAUSTEIN} erzeugt ${klasse} nicht mehr`);
  }
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const regel of ['.dr', '.dl', '.dv', '.loading', '.spin']) {
    assert.ok(new RegExp('\\' + regel + '[\\s,{:]').test(css),
      `styles.css kennt ${regel} nicht — Baustein und Stylesheet passen nicht zusammen`);
  }
});
