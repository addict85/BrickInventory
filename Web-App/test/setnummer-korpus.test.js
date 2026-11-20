/**
 * Der GEMEINSAME Korpus (shared/setnummer-korpus.json): Web-App und Android-App
 * müssen dieselbe Setnummer lesen. Die Android-Seite führt denselben Korpus in
 * SetnummerKorpusTest aus; jede Seite prüft ihren Code, keine liest den der anderen.
 *
 * Selbstbeweis über Mindestzahlen: Griffe das Einlesen nicht, wären die
 * Schleifen leer und der Test grün, ohne etwas geprüft zu haben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { setnummerCandidates } = _req('src/catalog/productTitle.js');

const ROOT = path.join(__dirname, '..');
const CORPUS_FILE = path.join(ROOT, '..', 'shared', 'setnummer-korpus.json');
const korpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8')).faelle;

test('jeder Fall des gemeinsamen Korpus liefert denselben ersten Kandidaten', () => {
  let withExpectation = 0,
    withoutCandidate = 0,
    threeDigit = 0;
  for (const [i, fall] of korpus.entries()) {
    const k = setnummerCandidates(fall.text, 2026);
    const ist = k[0] ?? null;
    assert.equal(
      ist,
      fall.erwartet,
      `Korpusfall ${i}: ${JSON.stringify(fall.text)}\n` +
        `  erwartet: ${fall.erwartet}\n  bekommen: ${ist}  (alle: ${JSON.stringify(k)})\n` +
        `  warum: ${fall.warum}`,
    );
    if (fall.erwartet === null) withoutCandidate++;
    else withExpectation++;
    if (fall.erwartet !== null && fall.erwartet.length === 3) threeDigit++;
  }

  // Selbstbeweis 1: Der Korpus wurde wirklich gelesen.
  assert.ok(korpus.length >= 15, `nur ${korpus.length} Fälle — Datei geschrumpft?`);
  // Selbstbeweis 2: Beide Richtungen sind vertreten. Ohne das könnte der Korpus
  // zu lauter Nulltreffern verkommen und trotzdem grün sein.
  assert.ok(withExpectation >= 10, `nur ${withExpectation} Fälle mit erwarteter Nummer`);
  assert.ok(withoutCandidate >= 2, `nur ${withoutCandidate} Fälle, die gar nichts liefern dürfen`);
  // Selbstbeweis 3: Der Anlass dieser Runde — dreistellige Altsets — ist
  // abgedeckt. Fällt die Unterstützung wieder raus, wird es rot.
  assert.ok(threeDigit >= 2, `nur ${threeDigit} dreistellige Setnummern im Korpus`);
});

test('jeder Korpusfall hat eine Begründung', () => {
  // Ein Fall ohne `warum` ist in einem halben Jahr nicht mehr zu bewerten —
  // und wer ihn dann rot sieht, weiss nicht, ob er ihn ändern darf.
  for (const [i, fall] of korpus.entries()) {
    assert.equal(typeof fall.text, 'string', `Fall ${i} ohne Text`);
    assert.ok((fall.warum || '').length >= 20, `Fall ${i} ohne Begründung: ${fall.warum}`);
    assert.ok(
      fall.erwartet === null || typeof fall.erwartet === 'string',
      `Fall ${i}: "erwartet" muss ein String oder null sein`,
    );
  }
});
