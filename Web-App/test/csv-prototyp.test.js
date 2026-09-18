const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Eine CSV-Kopfzeile darf die Prototypenkette nicht treffen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `npm audit` meldet fuer csv-parse: „Prototype replacement still reachable via
 * columns path". utils/csvExport.ts benutzte `columns: true` — damit wird jede
 * Kopfspalte zu einem Objektschluessel, `__proto__` eingeschlossen. Die CSV
 * kommt vom Benutzer (Import von Sets, Teilen, Minifiguren), der Pfad ist also
 * erreichbar.
 *
 * Behoben ist es in der Bibliothek erst ab Hauptversion 7. Diese Pruefung
 * haengt nicht daran: Sie laeuft gegen den echten Einleser und zeigt, dass die
 * drei gefaehrlichen Namen NICHT im Ergebnis landen — egal, welche Version
 * installiert ist.
 *
 * ── Warum nicht nur die Quelle geprueft wird ────────────────────────────────
 *
 * Ein Blick in den Quelltext („steht da `columns:` mit einer Funktion?") waere
 * wieder eine Rezeptpruefung. In dieser Sitzung sind drei Fehler genau daran
 * vorbeigelaufen: Der Glanz stimmte im Rezept und kam nicht an; der
 * Design-Wechsel nannte den richtigen Helfer und erreichte ihn nicht. Hier
 * laeuft deshalb der Parser selbst.
 */

/** Den Einleser so aufrufen, wie der Import es tut. */
function einlesen(csv) {
  const { parse } = require('csv-parse/sync');
  // Dieselbe Konfiguration wie utils/csvExport.ts — inklusive der Filterung.
  const GEFAEHRLICH = new Set(['__proto__', 'constructor', 'prototype']);
  return parse(csv, {
    columns: (kopf) => kopf.map(n => {
      const rein = String(n || '').trim();
      return GEFAEHRLICH.has(rein) ? false : rein;
    }),
    skip_empty_lines: true, trim: true, delimiter: ',',
    relax_column_count: true, relax_quotes: true,
  });
}

test('eine Spalte __proto__ landet nicht in der Prototypenkette', () => {
  const vorher = Object.prototype.polluted;
  const records = einlesen('set_number,__proto__\n10497-1,{"polluted":true}\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].set_number, '10497-1',
    'Die echte Spalte geht verloren — der Filter greift zu weit');
  assert.equal(Object.prototype.polluted, vorher,
    'Object.prototype wurde veraendert — die Kopfzeile hat die Kette getroffen');
  assert.ok(!Object.prototype.hasOwnProperty.call(records[0], '__proto__'),
    'Der Datensatz traegt einen __proto__-Schluessel');
});

test('auch constructor und prototype werden verworfen', () => {
  for (const name of ['constructor', 'prototype']) {
    const r = einlesen(`set_number,${name}\n10497-1,x\n`);
    assert.equal(r[0].set_number, '10497-1');
    assert.ok(!Object.prototype.hasOwnProperty.call(r[0], name),
      `Die Spalte "${name}" ist im Datensatz gelandet`);
  }
});

test('gewoehnliche Spalten bleiben unberuehrt', () => {
  // Selbstbeweis: Ein Filter, der ALLES verwirft, wuerde die beiden Regeln
  // oben ebenfalls bestehen — und den Import unbrauchbar machen.
  const r = einlesen('set_number,quantity,note\n10497-1,2,Geschenk\n');
  assert.deepEqual(r, [{ set_number: '10497-1', quantity: '2', note: 'Geschenk' }]);
});

test('der Einleser im Baum benutzt denselben Filter', () => {
  // Die drei Regeln oben laufen gegen eine Kopie der Konfiguration. Diese hier
  // bindet sie an die echte Datei — sonst pruefte der Test sich selbst.
  const fs = require('node:fs');
  const path = require('node:path');
  const roh = fs.readFileSync(path.join(__dirname, '..', 'utils', 'csvExport.ts'), 'utf8');
  // Kommentare zuerst weg. Ohne diesen Schritt meldete die Regel ihre eigene
  // BEGRUENDUNG: Der Kommentar an der Stelle erklaert, warum `columns: true`
  // dort nicht mehr stehen darf — und nennt es dabei. Dieselbe Falle ist in
  // dieser Sitzung schon der Haftungs- und der Deckelfarben-Pruefung gestellt
  // worden; sie faellt nur auf, weil die Zusicherung sofort anschlaegt.
  const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n');
  assert.ok(!/columns:\s*true/.test(quelle),
    'utils/csvExport.ts steht wieder auf `columns: true` — dann ist der Pfad ' +
    'offen, den npm audit meldet.');
  assert.match(quelle, /GEFAEHRLICHE_SPALTEN = new Set\(\['__proto__', 'constructor', 'prototype'\]\)/,
    'Die Liste der gefaehrlichen Spaltennamen weicht von der hier geprueften ab');
});
