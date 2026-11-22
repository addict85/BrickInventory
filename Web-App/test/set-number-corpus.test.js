/**
 * The SHARED corpus (shared/setnummer-korpus.json): web app and Android app
 * must read the same set number. The Android side runs the same corpus in
 * SetnummerKorpusTest; each side checks its own code, neither reads the other's.
 *
 * Self-proof via minimum numbers: if the reading did not apply, the
 * loops would be empty and the test green without having checked anything.
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

test('every case of the shared corpus yields the same first candidate', () => {
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

  // Self-proof 1: the corpus was really read.
  assert.ok(korpus.length >= 15, `nur ${korpus.length} Fälle — Datei geschrumpft?`);
  // Self-proof 2: both directions are represented. Without that the corpus could
  // degenerate into nothing but zero hits and still be green.
  assert.ok(withExpectation >= 10, `nur ${withExpectation} Fälle mit erwarteter Nummer`);
  assert.ok(withoutCandidate >= 2, `nur ${withoutCandidate} Fälle, die gar nichts liefern dürfen`);
  // Self-proof 3: the occasion of this round — three-digit legacy sets — is
  // covered. If the support drops out again, it turns red.
  assert.ok(threeDigit >= 2, `nur ${threeDigit} dreistellige Setnummern im Korpus`);
});

test('every corpus case has a rationale', () => {
  // A case without `warum` can no longer be assessed in half a year —
  // and whoever then sees it red does not know whether he may change it.
  for (const [i, fall] of korpus.entries()) {
    assert.equal(typeof fall.text, 'string', `Fall ${i} ohne Text`);
    assert.ok((fall.warum || '').length >= 20, `Fall ${i} ohne Begründung: ${fall.warum}`);
    assert.ok(
      fall.erwartet === null || typeof fall.erwartet === 'string',
      `Fall ${i}: "erwartet" muss ein String oder null sein`,
    );
  }
});
