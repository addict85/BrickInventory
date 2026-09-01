/**
 * Ein gefangener Fehler ergibt IMMER einen lesbaren Text.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * `catch (e) { … e.message … }` stand an 91 Stellen, und der gefangene Wert
 * war `any`. In JavaScript darf aber alles geworfen werden, nicht nur ein
 * Error: eine Zeichenkette (`throw 'kaputt'`), ein Objekt ohne `message`, bei
 * einem abgelehnten Versprechen auch `undefined`. In genau diesen Faellen war
 * `e.message` seinerseits `undefined` — und beim Nutzer stand
 * „Fehler: undefined", also die eine Meldung, mit der niemand etwas anfangen
 * kann.
 *
 * Der Schalter `useUnknownInCatchVariables` hat die Stellen sichtbar gemacht;
 * fehlertext() behebt sie inhaltlich. Dieser Test haelt das Verhalten fest —
 * der Schalter allein wuerde eine Fassung durchgehen lassen, die zwar
 * uebersetzt, aber weiterhin „undefined" liefert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fehlertext, fehlerCode } = require('./helpers/sources').buildAndRequire()('utils/httpError.js');

test('fehlertext liefert nie "undefined"', () => {
  // Der Normalfall.
  assert.equal(fehlertext(new Error('kaputt')), 'kaputt');

  // ── Die vier Faelle, die vorher „undefined" ergaben ──────────────────────
  assert.equal(fehlertext('kaputt'), 'kaputt', 'eine geworfene Zeichenkette ist die Meldung');
  assert.equal(fehlertext({ message: 'aus einem Fremdmodul' }), 'aus einem Fremdmodul',
    'Error-artige Objekte ohne Error-Prototyp zaehlen auch — so kommen sie ueber Prozessgrenzen');
  assert.equal(fehlertext(undefined), 'Unbekannter Fehler');
  assert.equal(fehlertext(null), 'Unbekannter Fehler');

  // Ein Error OHNE Text faellt auf String(e) zurueck und ergibt 'Error'.
  // Ich hatte hier 'Unbekannter Fehler' erwartet — der Test hat mich
  // korrigiert. 'Error' ist die bessere Antwort: Sie sagt wenigstens, dass
  // eine Ausnahme vorlag, und die Regel, um die es geht, lautet ohnehin
  // „niemals leer und niemals undefined" (siehe die Schleife darunter).
  assert.equal(fehlertext(new Error('')), 'Error');

  // Kein Wert darf als leerer String herauskommen — sonst steht in der
  // Oberflaeche „Fehler: " und der Nutzer sieht wieder nichts.
  for (const wert of [0, false, {}, [], new Error(), Symbol('x')]) {
    const t = fehlertext(wert);
    assert.equal(typeof t, 'string', `${String(wert)} ergibt keinen String`);
    assert.ok(t.length > 0, `${String(wert)} ergibt einen leeren Text`);
  }
});

test('fehlertext gibt NICHT das ganze Objekt preis', () => {
  // Ein geworfener Datenbankfehler traegt gern die vollstaendige Abfrage samt
  // Parametern. Die darf nicht in einer Meldung landen, die bis zur
  // Oberflaeche laufen kann.
  const dbFehler = Object.assign(new Error('duplicate key'), {
    query: 'INSERT INTO users (password_hash) VALUES ($1)',
    parameters: ['geheim'],
  });
  const t = fehlertext(dbFehler);
  assert.equal(t, 'duplicate key');
  assert.ok(!t.includes('geheim'), 'Parameter duerfen nicht in der Meldung stehen');
  assert.ok(!t.includes('INSERT'), 'die Abfrage darf nicht in der Meldung stehen');
});

test('fehlerCode liest Node- und Postgres-Codes', () => {
  assert.equal(fehlerCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  // Postgres liefert numerische Codes (23505 = Eindeutigkeitsverletzung).
  assert.equal(fehlerCode(Object.assign(new Error('x'), { code: 23505 })), '23505',
    'ein numerischer Code wird zur Zeichenkette — sonst schluege jeder Vergleich fehl');
  // Ohne Code ist undefined die richtige Antwort: Jeder Vergleich damit
  // schlaegt sauber fehl, statt zufaellig zu treffen.
  assert.equal(fehlerCode(new Error('x')), undefined);
  assert.equal(fehlerCode('kaputt'), undefined);
  assert.equal(fehlerCode(null), undefined);
});
