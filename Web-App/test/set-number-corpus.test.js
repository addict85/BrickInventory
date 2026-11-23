/**
 * The SHARED corpus (shared/setnummer-korpus.json): web app and Android app
 * must read the same set number. The Android side runs the same corpus in
 * SetnummerKorpusTest; each side checks its own code, neither reads the other's.
 *
 * Self-proof via minimum numbers: if the reading did not apply, the
 * loops would be empty and the test green without having checked anything.
 *
 * Counter-check: the rationale of the first case in shared/setnummer-korpus.json renamed → red “every corpus case has a rationale”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { setNumberCandidates } = _req('src/catalog/productTitle.js');

const ROOT = path.join(__dirname, '..');
const CORPUS_FILE = path.join(ROOT, '..', 'shared', 'setnummer-korpus.json');
const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8')).faelle;

test('every case of the shared corpus yields the same first candidate', () => {
  let withExpectation = 0,
    withoutCandidate = 0,
    threeDigit = 0;
  for (const [i, fall] of corpus.entries()) {
    const k = setNumberCandidates(fall.text, 2026);
    const actual = k[0] ?? null;
    assert.equal(
      actual,
      fall.erwartet,
      `corpus case ${i}: ${JSON.stringify(fall.text)}\n` +
        `  expected: ${fall.erwartet}\n  got: ${actual}  (all: ${JSON.stringify(k)})\n` +
        `  why: ${fall.warum}`,
    );
    if (fall.erwartet === null) withoutCandidate++;
    else withExpectation++;
    if (fall.erwartet !== null && fall.erwartet.length === 3) threeDigit++;
  }

  // Self-proof 1: the corpus was really read.
  assert.ok(corpus.length >= 15, `only ${corpus.length} cases — has the file shrunk?`);
  // Self-proof 2: both directions are represented. Without that the corpus could
  // degenerate into nothing but zero hits and still be green.
  assert.ok(withExpectation >= 10, `only ${withExpectation} cases with an expected number`);
  assert.ok(withoutCandidate >= 2, `only ${withoutCandidate} cases that must return nothing at all`);
  // Self-proof 3: the occasion of this round — three-digit legacy sets — is
  // covered. If the support drops out again, it turns red.
  assert.ok(threeDigit >= 2, `only ${threeDigit} three-digit set numbers in the corpus`);
});

test('every corpus case has a rationale', () => {
  // A case without `warum` can no longer be assessed in half a year —
  // and whoever then sees it red does not know whether he may change it.
  for (const [i, fall] of corpus.entries()) {
    assert.equal(typeof fall.text, 'string', `case ${i} without text`);
    assert.ok((fall.warum || '').length >= 20, `case ${i} without a reason: ${fall.warum}`);
    assert.ok(
      fall.erwartet === null || typeof fall.erwartet === 'string',
      `case ${i}: „erwartet“ must be a string or null`,
    );
  }
});
