/**
 * A caught error ALWAYS yields a readable text.
 *
 * Counter-check (09.11.2026): in fehlertext() the line for error-like objects without a prototype deleted
 * → red: “fehlertext never returns "undefined"”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { errorMessage, errorCode } = require('./helpers/sources').buildAndRequire()('src/infra/error.js');

test('fehlertext never returns "undefined"', () => {
  // The normal case.
  assert.equal(errorMessage(new Error('kaputt')), 'kaputt');

  // ── The four cases that used to yield “undefined" ────────────────────────
  assert.equal(errorMessage('kaputt'), 'kaputt', 'a thrown string is the message');
  assert.equal(
    errorMessage({ message: 'aus einem Fremdmodul' }),
    'aus einem Fremdmodul',
    'Error-like objects without the Error prototype count too — that is how they cross process boundaries',
  );
  assert.equal(errorMessage(undefined), 'Unbekannter Fehler');
  assert.equal(errorMessage(null), 'Unbekannter Fehler');

  // An Error WITHOUT text falls back to String(e) and yields 'Error'.
  // I had expected 'Unbekannter Fehler' here — the test corrected
  // me. 'Error' is the better answer: it at least says that
  // an exception occurred, and the rule in question is anyway
  // “never empty and never undefined" (see the loop below).
  assert.equal(errorMessage(new Error('')), 'Error');

  // No value may come out as an empty string — otherwise the
  // UI shows “Fehler: " and the user again sees nothing.
  for (const wert of [0, false, {}, [], new Error(), Symbol('x')]) {
    const t = errorMessage(wert);
    assert.equal(typeof t, 'string', `${String(wert)} ergibt keinen String`);
    assert.ok(t.length > 0, `${String(wert)} results in an empty text`);
  }
});

test('fehlertext does NOT give away the whole object', () => {
  // A thrown database error likes to carry the complete query including
  // parameters. That must not land in a message that can reach the
  // UI.
  const dbError = Object.assign(new Error('duplicate key'), {
    query: 'INSERT INTO users (password_hash) VALUES ($1)',
    parameters: ['geheim'],
  });
  const t = errorMessage(dbError);
  assert.equal(t, 'duplicate key');
  assert.ok(!t.includes('geheim'), 'Parameters must not appear in the message');
  assert.ok(!t.includes('INSERT'), 'the query must not appear in the message');
});

test('errorCode reads Node and Postgres codes', () => {
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  // Postgres delivers numeric codes (23505 = uniqueness violation).
  assert.equal(
    errorCode(Object.assign(new Error('x'), { code: 23505 })),
    '23505',
    'a numeric code becomes a string — otherwise every comparison would fail',
  );
  // Without a code undefined is the right answer: every comparison with it
  // fails cleanly instead of hitting by chance.
  assert.equal(errorCode(new Error('x')), undefined);
  assert.equal(errorCode('kaputt'), undefined);
  assert.equal(errorCode(null), undefined);
});
