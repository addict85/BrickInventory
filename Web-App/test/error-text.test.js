/**
 * A caught error ALWAYS yields a readable text.
 *
 * Counter-check (09.11.2026): in fehlertext() the line for error-like objects without a prototype deleted
 * → red: “fehlertext never returns "undefined"”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fehlertext, fehlerCode } = require('./helpers/sources').buildAndRequire()('src/infra/error.js');

test('fehlertext never returns "undefined"', () => {
  // The normal case.
  assert.equal(fehlertext(new Error('kaputt')), 'kaputt');

  // ── The four cases that used to yield “undefined" ────────────────────────
  assert.equal(fehlertext('kaputt'), 'kaputt', 'eine geworfene Zeichenkette ist die Meldung');
  assert.equal(
    fehlertext({ message: 'aus einem Fremdmodul' }),
    'aus einem Fremdmodul',
    'Error-artige Objekte ohne Error-Prototyp zaehlen auch — so kommen sie ueber Prozessgrenzen',
  );
  assert.equal(fehlertext(undefined), 'Unbekannter Fehler');
  assert.equal(fehlertext(null), 'Unbekannter Fehler');

  // An Error WITHOUT text falls back to String(e) and yields 'Error'.
  // I had expected 'Unbekannter Fehler' here — the test corrected
  // me. 'Error' is the better answer: it at least says that
  // an exception occurred, and the rule in question is anyway
  // “never empty and never undefined" (see the loop below).
  assert.equal(fehlertext(new Error('')), 'Error');

  // No value may come out as an empty string — otherwise the
  // UI shows “Fehler: " and the user again sees nothing.
  for (const wert of [0, false, {}, [], new Error(), Symbol('x')]) {
    const t = fehlertext(wert);
    assert.equal(typeof t, 'string', `${String(wert)} ergibt keinen String`);
    assert.ok(t.length > 0, `${String(wert)} ergibt einen leeren Text`);
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
  const t = fehlertext(dbError);
  assert.equal(t, 'duplicate key');
  assert.ok(!t.includes('geheim'), 'Parameter duerfen nicht in der Meldung stehen');
  assert.ok(!t.includes('INSERT'), 'die Abfrage darf nicht in der Meldung stehen');
});

test('fehlerCode reads Node and Postgres codes', () => {
  assert.equal(fehlerCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  // Postgres delivers numeric codes (23505 = uniqueness violation).
  assert.equal(
    fehlerCode(Object.assign(new Error('x'), { code: 23505 })),
    '23505',
    'ein numerischer Code wird zur Zeichenkette — sonst schluege jeder Vergleich fehl',
  );
  // Without a code undefined is the right answer: every comparison with it
  // fails cleanly instead of hitting by chance.
  assert.equal(fehlerCode(new Error('x')), undefined);
  assert.equal(fehlerCode('kaputt'), undefined);
  assert.equal(fehlerCode(null), undefined);
});
