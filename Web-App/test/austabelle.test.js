/**
 * Nachschlagetabellen mit Schlüssel von aussen (Nachtrag 155).
 *
 * Der Befund: `TABELLE[schluessel]` liefert in JavaScript auch GEERBTE
 * Eigenschaften, und die sind wahrheitswertig. Die verbreitete Absicherung
 * `TABELLE[k] || VORGABE` greift deshalb genau dann nicht, wenn sie soll.
 *
 * Diese Datei prüft den Helfer selbst UND die drei Stellen, an denen das Muster
 * stand — die beiden tragenden über den Quelltext, weil ein ORDER BY bzw. ein
 * multer-fileFilter ohne laufende DB/Upload nicht sinnvoll zu fahren sind.
 * Für das Verhalten der Routen gibt es die DB-Suiten daneben.
 */
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const { ausTabelle } = require(path.join(ROOT, 'dist', 'utils', 'validate.js'));

const TABELLE = { year_desc: 'rb.year DESC', name_asc: 'rb.name ASC' };

test('bekannter Schlüssel liefert den Wert', () => {
  assert.strictEqual(ausTabelle(TABELLE, 'name_asc', 'VORGABE'), 'rb.name ASC');
});

test('unbekannter Schlüssel liefert die Vorgabe', () => {
  assert.strictEqual(ausTabelle(TABELLE, 'gibtsnicht', 'VORGABE'), 'VORGABE');
});

test('geerbte Eigenschaften zählen NICHT als Treffer', () => {
  // Das ist der eigentliche Befund. Ohne hasOwnProperty käme hier die
  // Object-Funktion bzw. Object.prototype zurück — beides wahrheitswertig,
  // beides landete ungeprüft im SQL.
  for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.strictEqual(ausTabelle(TABELLE, k, 'VORGABE'), 'VORGABE', `Schlüssel ${k}`);
  }
});

test('Gegenprobe: der naive Zugriff FÄLLT bei denselben Schlüsseln durch', () => {
  // Belegt, dass der Test oben etwas prüft und nicht ohnehin grün wäre.
  const naiv = k => TABELLE[k] || 'VORGABE';
  assert.strictEqual(naiv('gibtsnicht'), 'VORGABE');          // hier gleich
  assert.notStrictEqual(naiv('constructor'), 'VORGABE');      // hier NICHT
  assert.notStrictEqual(naiv('__proto__'), 'VORGABE');
});

test('nicht-string Schlüssel werden gefahrlos behandelt', () => {
  for (const k of [undefined, null, 42, {}, ['name_asc'], true]) {
    const r = ausTabelle(TABELLE, k, 'VORGABE');
    // Ein Array mit einem gültigen Wert darf über einzelwert() greifen —
    // alles andere fällt auf die Vorgabe.
    assert.ok(r === 'VORGABE' || r === 'rb.name ASC', `Schlüssel ${JSON.stringify(k)} ergab ${r}`);
  }
});

test('ohne Vorgabe kommt undefined statt eines geerbten Werts', () => {
  assert.strictEqual(ausTabelle(TABELLE, 'constructor'), undefined);
  assert.strictEqual(ausTabelle(TABELLE, 'name_asc'), 'rb.name ASC');
});

// ── Die drei Fundstellen: kein direkter Tabellenzugriff mehr ────────────────

const STELLEN = [
  ['routes/api_v1/catalog.ts', 'SORTS',              /SORTS\s*\[/],
  ['utils/handlers/sets.ts',   'SET_SORTS',          /SET_SORTS\s*\[/],
  ['routes/sets.ts',           'INSTR_EXT_BY_MIME',  /INSTR_EXT_BY_MIME\s*\[/],
];

for (const [datei, name, muster] of STELLEN) {
  test(`${datei}: ${name} wird nicht mehr direkt indiziert`, () => {
    // Kommentarzeilen heraus: Die Begründung ÜBER dem Code nennt das alte
    // Muster absichtlich, und darauf soll dieser Test nicht anspringen.
    const code = fs.readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n')
      .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*') && !z.trim().startsWith('/*'))
      .join('\n');
    assert.ok(!muster.test(code),
      `${datei} greift noch direkt auf ${name}[…] zu — ausTabelle() verwenden.`);
    assert.match(code, new RegExp(`ausTabelle\\(\\s*${name}`),
      `${datei} sollte ausTabelle(${name}, …) benutzen.`);
  });
}
