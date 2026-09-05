'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Der Kaufpreis wird uebernommen — und seine Herkunft benannt.
 *
 * ── Zwei Befunde, eine Tatsache (Nachtrag 167) ──────────────────────────────
 * BrickLink fuehrt zu vielen Teilen und Figuren nur EINEN Zustand. Daraus
 * folgten Marcos zwei Meldungen, die sich zu widersprechen schienen:
 *
 *   „Der Zustand hat keinen Einfluss auf den Preis"  — der Rueckfall war unsichtbar
 *   „Teilweise wird der Kaufpreis nicht geladen"     — ohne Rueckfall blieb es leer
 *
 * Seine Entscheidung: uebernehmen UND kennzeichnen. Dieser Test haelt beide
 * Haelften fest — denn genau eine davon wegzulassen ist der Rueckfall in je
 * einen der beiden Fehler.
 */

const WURZEL = path.join(__dirname, '..');
const APP = path.join(WURZEL, '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch', 'brickinventoryapp');

function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');
}
const lies = (...p) => ohneKommentare(fs.readFileSync(path.join(WURZEL, ...p), 'utf8'));

test('der Rueckfall wird nicht mehr verworfen', () => {
  // Das war der zu scharfe Fix aus Nachtrag 166. Steht er wieder da, bleibt
  // der Kaufpreis fuer alles leer, was BrickLink nur in einem Zustand fuehrt.
  for (const datei of ['parts.ts', 'minifigs.ts']) {
    const src = lies('routes', datei);
    assert.doesNotMatch(src, /is_fallback\)\s*(return null|continue)/,
      `routes/${datei} verwirft den Rueckfall wieder — dann bleibt der Kaufpreis leer`);
  }
});

test('beide Preisabrufe geben die Herkunft mit', () => {
  for (const datei of ['parts.ts', 'minifigs.ts']) {
    const src = lies('routes', datei);
    assert.match(src, /ausZustand: priceData\?\.is_fallback \? \(priceData\.condition_used \|\| null\) : null/,
      `routes/${datei} meldet nicht, aus welchem Zustand der Preis stammt — ` +
      'dann steht die Zahl unkommentiert da, und der Zustand sieht wieder ' +
      'aus wie eine Angabe ohne Wirkung');
  }
});

test('der Rueckfall wird in beiden Preisabrufen markiert', () => {
  // ── Uebernommen aus test/zustand-kein-rueckfall.test.js ───────────────────
  //
  // Jene Datei sicherte die Regel aus Nachtrag 166 („einen Rueckfall gar nicht
  // erst annehmen"). Die hat Marco mit seiner Entscheidung ersetzt, und ein
  // Test, der das Gegenteil des Gewollten festhaelt, ist schlimmer als keiner.
  //
  // DIESE Zusicherung ueberlebt den Wechsel — sie wird sogar wichtiger: Ohne
  // `is_fallback` wuesste niemand, dass der Preis aus dem anderen Zustand
  // stammt, und die Kennzeichnung fiele lautlos weg. Aus einer Bedingung des
  // Verwerfens ist die Grundlage des Benennens geworden.
  const fc = lies('utils', 'financeCalc.ts');
  for (const name of ['async function fetchMinifigPrice', 'async function fetchPartPrice']) {
    const i = fc.indexOf(name);
    assert.ok(i > 0, `${name} ist nicht mehr zu finden`);
    const body = fc.slice(i, fc.indexOf('\nasync function', i + 10) + 1 || undefined);
    assert.match(body, /is_fallback:\s*true/,
      `${name} markiert den Zustands-Rueckfall nicht mehr — dann kann keine ` +
      'Stelle mehr sagen, aus welchem Zustand der Preis kommt.');
  }
});

test('die Herkunft erreicht beide Antworten', () => {
  for (const datei of ['parts.ts', 'minifigs.ts']) {
    const src = lies('routes', datei);
    assert.match(src, /price_from_condition: preisAusZustand/,
      `routes/${datei} liefert die Herkunft nicht aus — dann kann keine ` +
      'Oberflaeche sie zeigen');
  }
});

test('eine eingetippte Zahl fragt gar nicht erst nach dem Markt', () => {
  // Sonst stuende ein Herkunftshinweis an einem Preis, den der Mensch selbst
  // eingegeben hat — und daneben ein ueberfluessiger BrickLink-Aufruf.
  const regel = lies('utils', 'preisRegel.ts');
  assert.match(regel, /const markt = unitPrice !== null \? null : await marktpreis\(zustand\)/,
    'Der Marktpreis wird auch bei eigener Eingabe geholt');
  assert.match(regel, /preisAusZustand: \(kaufpreis > 0 && markt\?\.ausZustand\) \? markt\.ausZustand : null/,
    'Eine Herkunft ohne uebernommenen Wert waere ein Hinweis auf nichts');
});

test('beide Oberflaechen zeigen den Hinweis, aus je EINER Stelle', () => {
  const web = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'public', 'js', '06-minifigs.js'), 'utf8'));
  assert.strictEqual((web.match(/function preisHerkunftHinweis\(/g) || []).length, 1,
    'Der Hinweis der Webapp ist nicht (mehr) an genau einer Stelle gebaut');
  assert.strictEqual((web.match(/preisHerkunftHinweis\(d\.price_from_condition\)/g) || []).length, 2,
    'Der Hinweis fehlt bei einer der beiden Erfassungen (Teile / Figuren)');

  const app = ohneKommentare(fs.readFileSync(
    path.join(APP, 'ui', 'PartsFeature.kt'), 'utf8'));
  assert.strictEqual((app.match(/fun MainViewModel\.erfassungsMeldung\(/g) || []).length, 1,
    'Der Hinweis der App ist nicht an genau einer Stelle gebaut');
  // `= erfassungsMeldung(` misst die AUFRUFE. Ein blosses
  // `erfassungsMeldung\(` zaehlte die Definition mit und meldete 3 statt 2 —
  // eine Zahl, die etwas anderes zaehlt als sie behauptet, taugt auch als
  // Selbstbeweis nichts.
  assert.strictEqual((app.match(/= erfassungsMeldung\(/g) || []).length, 2,
    'Der Hinweis fehlt bei einer der beiden Erfassungen der App');
  assert.match(app, /r\.data\.priceFromCondition/,
    'Die App liest die Herkunft nicht aus der Antwort');
});

test('die Texte gibt es in beiden Sprachen und beiden Oberflaechen', () => {
  for (const sprache of ['de', 'en']) {
    const loc = fs.readFileSync(path.join(WURZEL, 'public', 'locales', `${sprache}.js`), 'utf8');
    for (const schluessel of ['price.from_other_condition_new', 'price.from_other_condition_used'])
      assert.ok(loc.includes(schluessel), `${schluessel} fehlt in locales/${sprache}.js`);
  }
  for (const ordner of ['values', 'values-de']) {
    const xml = fs.readFileSync(path.join(
      WURZEL, '..', 'Android-App', 'app', 'src', 'main', 'res', ordner, 'strings.xml'), 'utf8');
    for (const schluessel of ['price_from_other_condition_new', 'price_from_other_condition_used'])
      assert.ok(xml.includes(`name="${schluessel}"`), `${schluessel} fehlt in ${ordner}/strings.xml`);
  }
});
