'use strict';
const test = require('node:test');
const assert = require('node:assert');

/**
 * Die BrickLink-Wunschliste der Webapp wird maskiert.
 * Ausführlich: docs/begruendungen/test/wunschliste-xml.test.js.md#wurzel
 *
 * Gegenproben der am 08.11.2026 gestrichenen Fälle: Maskierung jedes Textfelds
 * und die fünf Entitäten von esc() laufen am Modul in bricklink-wanted-xml.test.js
 * (ITEMTYPE ohne esc() → Fall 5 rot; ' nicht ersetzt → Fall 5b rot).
 */

const ohneKommentare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');

test('der Zeitplan im Monitor geht durch denselben Escaper wie sein Nachbar', () => {
  // Der Server prueft die Werte (routes/api_v1/admin.ts) — hier kann heute
  // nichts Boesartiges ankommen. Der Punkt ist die Gleichbehandlung: In
  // derselben Zeile ging `data-arg` durch esc() und `value` nicht. Eine Zeile,
  // die dieselbe Regel zweimal verschieden anwendet, ist der Anfang der …
  // Ausführlich: docs/begruendungen/test/wunschliste-xml.test.js.md#core
  const core = ohneKommentare(require('./helpers/sources').coreQuelle());
  const treffer = [...core.matchAll(/class="job-sched-input[^"]*"[^`]*?value="\$\{([^}]+)\}"/g)];
  assert.strictEqual(treffer.length, 2,
    `${treffer.length} Zeitplan-Eingabefelder gefunden, erwartet 2 — Muster veraltet?`);
  // In html`` maskiert die Vorlage selbst; ausserhalb muss esc() dastehen.
  const inHtml = (/** @type {number} */ i) => core.slice(core.lastIndexOf('`', i) - 4, core.lastIndexOf('`', i)) === 'html';
  for (const m of treffer)
    assert.ok(m[1].startsWith('esc(') || inHtml(m.index ?? 0),
      `Das Zeitplan-Feld setzt „${m[1]}" roh ein, waehrend data-arg daneben esc() nutzt`);
});
