'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die BrickLink-Wunschliste der Webapp wird maskiert.
 * Ausführlich: docs/begruendungen/test/wunschliste-xml.test.js.md#wurzel
 */

const WURZEL = path.join(__dirname, '..');
const ohneKommentare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');

test('die Webapp maskiert jedes Textfeld der Wunschliste', () => {
  const src = ohneKommentare(
    fs.readFileSync(path.join(WURZEL, 'public', 'js', '19-bricklink-xml.js'), 'utf8'));
  // Kein Ausschnitt zwischen <INVENTORY> und </INVENTORY> mehr
  // Ausführlich: docs/begruendungen/test/wunschliste-xml.test.js.md#stelle
  assert.ok(src.includes('<INVENTORY>'),
    'Der XML-Aufbau der Wunschliste ist nicht mehr zu finden');
  const block = src;

  for (const feld of ['ITEMTYPE', 'ITEMID', 'CONDITION']) {
    const m = new RegExp(`<${feld}>\\$\\{([^}]+)\\}</${feld}>`).exec(block);
    assert.ok(m, `<${feld}> steht nicht mehr im Aufbau — Muster veraltet?`);
    assert.ok(m[1].startsWith('esc('),
      `<${feld}> setzt „${m[1]}" ROH ein. Bei einem manuell erfassten Teil hat der ` +
      'Mensch den Wert getippt; ein & oder < macht die Wunschliste kaputt oder ' +
      'schiebt Elemente hinein.');
  }
});

test('esc() deckt die fuenf XML-Entitaeten ab', () => {
  // Der Grund, warum die Webapp KEINEN eigenen XML-Maskierer bekommt. Faellt
  // eine der fuenf Ersetzungen aus esc() heraus, ist diese Entscheidung falsch
  // — und das soll hier auffallen und nicht in einer kaputten Wunschliste.
  // Ausführlich: docs/begruendungen/test/wunschliste-xml.test.js.md#fn-stelle
  const fn = fs.readFileSync(path.join(WURZEL, 'public', 'js', '00-escapen.js'), 'utf8');
  assert.ok(fn.includes('export function esc('),
    'js/00-escapen.js enthaelt kein esc() mehr — dann prueft der Rest hier nichts.');
  for (const [zeichen, entitaet] of
       [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]) {
    assert.ok(fn.includes(entitaet),
      `esc() ersetzt „${zeichen}" nicht mehr durch ${entitaet} — dann taugt es ` +
      'nicht mehr fuer die Wunschliste, und die braucht einen eigenen Maskierer.');
  }
});

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
