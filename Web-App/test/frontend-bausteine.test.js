/**
 * Wiederkehrende Ansichtsteile stehen an EINER Stelle.
 * Ausführlich: docs/begruendungen/test/frontend-bausteine.test.js.md#kopf
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
  // `class="dr${zKlasse}"`: die Zeile kann eine Zusatzklasse tragen.
  for (const klasse of [/class="dr[$"]/, /class="dl"/, /class="dv"/, /class="lade-geruest/, /class="skelett-zeile"/]) {
    assert.match(src, klasse, `${BAUSTEIN} erzeugt ${klasse} nicht mehr`);
  }
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const regel of ['.dr', '.dl', '.dv', '.lade-geruest', '.skelett-zeile']) {
    assert.ok(new RegExp('\\' + regel + '[\\s,{:]').test(css),
      `styles.css kennt ${regel} nicht — Baustein und Stylesheet passen nicht zusammen`);
  }
});
