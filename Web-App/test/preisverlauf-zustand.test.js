'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Der Preisverlauf zeigt nur Zustaende, zu denen es eine Erfassung gibt.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Das gezeigte Teil hat nur einen Kaufpreis mit dem Zustand gebraucht.
 * Trotzdem wird im Preisverlauf auch eine Linie mit 'neu' angezeigt."
 *
 * ── Was der Fund war ────────────────────────────────────────────────────────
 * Nicht die fehlende Regel, sondern die HALB vorhandene: Fuer Sets stand sie
 * seit langem in getSetPriceHistory, mit ausfuehrlicher Begruendung. Fuer
 * manuell erfasste Teile und Minifiguren war derselbe Aufbau eine Funktion
 * weiter unten OHNE sie geschrieben. Eine Regel an zwei Orten, und nur einer
 * kannte sie — die wiederkehrende Fehlerart dieses Projekts.
 *
 * Der Test haelt fest, dass es bei EINEM Ort bleibt.
 */

const WURZEL = path.join(__dirname, '..');

/** Kommentare raus — sonst liest die Pruefung ihre eigene Begruendung. */
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
}

const quelle = ohneKommentare(
  fs.readFileSync(path.join(WURZEL, 'utils', 'priceHistory.ts'), 'utf8'));

test('die Regel steht an genau einer Stelle', () => {
  const definitionen = quelle.match(/export function zustaendeFuerVerlauf\(/g) || [];
  assert.strictEqual(definitionen.length, 1,
    `zustaendeFuerVerlauf ist ${definitionen.length}-mal definiert — genau einmal gehoert sie dorthin`);
});

test('beide Verlaeufe fragen dieselbe Regel', () => {
  // Zwei Aufrufe: einer fuer Sets (getSetPriceHistory), einer fuer manuell
  // erfasste Teile und Figuren (manualPriceHistory).
  const aufrufe = quelle.match(/zustaendeFuerVerlauf\(/g) || [];
  // Die Definition zaehlt mit, deshalb drei.
  assert.strictEqual(aufrufe.length, 3,
    `zustaendeFuerVerlauf kommt ${aufrufe.length}-mal vor (Definition + zwei Aufrufe erwartet). ` +
    'Fehlt einer, zeichnet der eine Verlauf Zustaende, die der andere weglaesst.');
});

test('kein Verlauf baut seine Reihen mehr an der Regel vorbei', () => {
  // Genau das war der Fehler: buildChart bekam beide Zustaende fest
  // aufgezaehlt, ohne zu fragen, ob es zu ihnen eine Erfassung gibt.
  assert.doesNotMatch(quelle,
    /buildChart\(\[\s*\{\s*name:\s*'N'/,
    'Ein buildChart-Aufruf zaehlt die Zustaende wieder fest auf, statt ' +
    'zustaendeFuerVerlauf zu fragen — dann erscheint eine Linie „neu" auch fuer ' +
    'ein nur gebraucht gekauftes Teil.');
});

test('die Rohdaten bleiben vollstaendig', () => {
  // Gefiltert wird, was GEZEICHNET wird. history_new/history_used sind die
  // Rohdaten; sie stillschweigend zu kuerzen waere ein zweiter, unsichtbarer
  // Eingriff in die Antwort.
  assert.match(quelle, /history_new:\s*historyNew,\s*history_used:\s*historyUsed/,
    'Die Rohreihen werden nicht mehr unveraendert mitgeliefert');
});
