/**
 * Die Cloudflare-Pause faellt nie auf null.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * Beim Einschalten von noUncheckedIndexedAccess wurde `CF_DELAYS_MS[block.retries]`
 * zu `number | undefined`. Der naheliegende Fix ist `?? 0` — und der waere hier
 * der gefaehrlichste: keine Pause, also weiter gegen eine Cloudflare-Sperre
 * laufen, die genau deshalb verhaengt wurde.
 *
 * GEGENGEPROBT: Mit `?? 0` meldet der Uebersetzer NICHTS. Die Zeile ist dann
 * typkorrekt und still falsch. Der Schalter zeigt die Stelle, die richtige
 * Antwort muss man selbst finden — und dieser Test haelt sie fest, weil der
 * Uebersetzer es nicht kann.
 *
 * Geprueft wird die Leiter selbst und der Rueckfall am Ende: Nach der letzten
 * Stufe gilt die letzte Stufe weiter, nicht null.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, ohneKommentare } = require('./helpers/sources');
const fs = require('node:fs');
const path = require('node:path');

const quelle = ohneKommentare(
  fs.readFileSync(path.join(ROOT, 'jobs', 'instructionQueue.ts'), 'utf8'));

test('die Pausenleiter steigt und beginnt nicht bei null', () => {
  const m = quelle.match(/CF_DELAYS_MS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'CF_DELAYS_MS nicht gefunden — Anker veraltet?');
  const stufen = m[1].split(',').map(x => eval(x.trim())).filter(Number.isFinite);
  assert.ok(stufen.length >= 3, `nur ${stufen.length} Stufen — Anker veraltet?`);
  assert.ok(stufen.every(x => x > 0), `eine Stufe ist nicht positiv: ${stufen.join(', ')}`);
  for (let i = 1; i < stufen.length; i++) {
    assert.ok(stufen[i] > stufen[i - 1],
      `die Leiter steigt nicht: ${stufen[i - 1]} → ${stufen[i]}`);
  }
});

test('der Rueckfall hinter der letzten Stufe ist NICHT null', () => {
  // Die Zeile, die den Wert holt. Ein `?? 0` darin waere typkorrekt und still
  // falsch — deshalb wird hier der Rueckfall selbst geprueft, nicht der Typ.
  const zeile = quelle.split('\n').find(z => /const delayMs\s*=/.test(z));
  assert.ok(zeile, 'die Zuweisung von delayMs nicht gefunden — Anker veraltet?');

  const rueckfaelle = [...zeile.matchAll(/\?\?\s*([^;\s]+)/g)].map(x => x[1]);
  assert.ok(rueckfaelle.length >= 1,
    'delayMs hat keinen Rueckfall. Unter noUncheckedIndexedAccess ist der ' +
    'Wert `number | undefined`; ohne Rueckfall uebersetzt das gar nicht.');

  for (const r of rueckfaelle) {
    assert.notEqual(r, '0',
      'Der Rueckfall der Cloudflare-Pause ist 0. Das heisst: keine Pause, also ' +
      'sofort weiter gegen eine Sperre, die genau deshalb verhaengt wurde. ' +
      'Richtig ist die LETZTE Stufe der Leiter.');
  }
  assert.ok(zeile.includes('CF_DELAYS_MS.length - 1'),
    'Der Rueckfall greift nicht auf die letzte Stufe der Leiter zurueck.');
});
