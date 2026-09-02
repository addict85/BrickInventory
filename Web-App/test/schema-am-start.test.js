/**
 * Keine Schema-Anweisung im Anfragepfad.
 *
 * Der Wächter selbst steht in scripts/check-schema-am-start.js — samt der
 * Begründung, woher die Regel kommt und was der erste, zu weit gefasste
 * Entwurf gemeldet hat. Hier wird er nur ausgeführt, damit er beim normalen
 * `npm test` mitläuft und nicht nur, wenn jemand daran denkt.
 *
 * Dasselbe Muster wie bei check-antwortfelder.js und
 * check-doppelte-operanden.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('keine Schema-Anweisung in routes/ oder utils/handlers/', () => {
  const skript = path.join(__dirname, '..', 'scripts', 'check-schema-am-start.js');
  let ausgabe = '';
  try {
    ausgabe = execFileSync(process.execPath, [skript], { encoding: 'utf8' });
  } catch (e) {
    assert.fail((e.stdout || '') + (e.stderr || ''));
  }
  assert.match(ausgabe, /^GRUEN/m, ausgabe);
});
