'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ohne BrickLink-Nummer wird der Minifiguren-Preis aus den Teilen geschaetzt.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 * „Bitte noch pruefen, dass bei den Minifiguren der Preis ueber die einzelnen
 * Teile berechnet wird, sofern keine bl-Id vorhanden ist."
 *
 * ── Was die Kette leisten muss ──────────────────────────────────────────────
 *  1. Ohne bl_fig_number wird die EIGENE Nummer bei BrickLink versucht — bei
 *     manuell erfassten Figuren (sw0001 &c.) stimmt sie meist ueberein. Fiele
 *     das weg, liefe die Schaetzung auch dort, wo BrickLink einen echten Preis
 *     hat: mehr Aufrufe, schlechterer Wert.
 *  2. Erst wenn BrickLink NICHTS liefert, wird ueber die Teile geschaetzt.
 *  3. Die Schaetzung landet in Cache und Verlauf — sonst kostet sie bei jedem
 *     Oeffnen der Finanzseite eine Preisabfrage JE TEIL.
 *
 * Jeder dieser drei Schritte ist schon einmal gerissen, ohne dass etwas
 * gescheitert waere: Es kam dann einfach kein Preis.
 */

const WURZEL = path.join(__dirname, '..');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');

const src = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'routes', 'minifigs.ts'), 'utf8'));

/** Der Abruf selbst, nicht die duenne Zahl-Huelle daneben. */
function abruf() {
  const i = src.indexOf('async function figMarktpreisMitHerkunft');
  assert.ok(i > 0, 'Der Minifiguren-Preisabruf ist nicht mehr zu finden');
  const j = src.indexOf('async function getCurrentFigMarketPrice', i);
  assert.ok(j > i, 'Das Ende des Abrufs ist nicht zu bestimmen');
  return src.slice(i, j);
}

test('ohne BrickLink-Nummer wird die eigene Nummer versucht', () => {
  const fn = abruf();
  assert.match(fn, /for \(const num of \[blFigNumber, figNumber\]\)/,
    'Es werden nicht mehr beide Nummern versucht — ohne bl_fig_number bliebe ' +
    'BrickLink ungefragt, obwohl die eigene Nummer dort meist existiert');
  assert.match(fn, /if \(!num\) continue;/,
    'Eine fehlende Nummer wird nicht uebersprungen — dann fragte der Abruf mit null');
});

test('die Schaetzung greift erst, wenn BrickLink nichts liefert', () => {
  const fn = abruf();
  const brickLink = fn.indexOf('fetchMinifigPrice');
  const schaetzung = fn.indexOf('estimateFigPriceFromParts');
  assert.ok(brickLink > 0 && schaetzung > 0,
    'BrickLink-Abruf oder Teile-Schaetzung fehlt im Preisweg');
  assert.ok(schaetzung > brickLink,
    'Die Teile-Schaetzung steht VOR dem BrickLink-Abruf — dann schaetzt sie ' +
    'auch dort, wo es einen echten Marktpreis gibt');
  // Sie steht hinter der Schleife, nicht darin: In der Schleife liefe sie je
  // Nummer einmal.
  assert.match(fn, /\}\s*return \{ preis: await estimateFigPriceFromParts\(figNumber, userId, effCond\), ausZustand: null \};/,
    'Die Schaetzung steht nicht als Rueckfall hinter der Nummern-Schleife');
});

test('die Schaetzung rechnet im ERMITTELTEN Zustand', () => {
  const fn = abruf();
  assert.match(fn, /estimateFigPriceFromParts\(figNumber, userId, effCond\)/,
    'Die Schaetzung bekommt nicht den ermittelten Zustand — dann rechnete sie ' +
    'im Standardzustand, und „neu" und „gebraucht" ergaeben wieder dasselbe');
});

test('die Schaetzung wird zwischengespeichert und fortgeschrieben', () => {
  const i = src.indexOf('async function estimateFigPriceFromParts');
  assert.ok(i > 0, 'estimateFigPriceFromParts ist nicht mehr zu finden');
  const fn = src.slice(i, src.indexOf('\nasync function', i + 10));
  // GELESEN: Ohne das kostete jeder Aufruf eine Preisabfrage je Teil.
  assert.match(fn, /SELECT avg_price FROM minifig_price_cache/,
    'Der Cache wird nicht mehr GELESEN — eine Figur mit fuenfzehn Teilen ' +
    'kostet dann fuenfzehn Abfragen bei jedem Oeffnen der Finanzseite');
  // GESCHRIEBEN: sonst steht im Detail-Dialog bei „Marktpreis" nur ein Strich.
  assert.match(fn, /INSERT INTO minifig_price_cache/,
    'Die Schaetzung wird nicht mehr gespeichert');
  assert.match(fn, /priced === 0\) return null/,
    'Eine Schaetzung ohne ein einziges bepreistes Teil gaebe 0 zurueck statt null');
});
