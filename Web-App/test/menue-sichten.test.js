/**
 * Jede Sicht hinter dem Menü ist erreichbar — und jeder Eintrag führt irgendwohin.
 *
 * ── Woher diese Prüfung kommt ───────────────────────────────────────────────
 *
 * Marcos Vorgabe vom 16.10.: „Gerne den Reiter Einstellungen mit den Punkten
 * belassen die nur der Administrator setzen kann, und die restlichen Seiten
 * oben Rechts hinter dem Benutzernamen als Aufklappbares Menu mit 3 -
 * anzeigen."
 *
 * Damit gibt es in der Webapp zum ersten Mal Flächen, die KEIN Reiter
 * erreicht. Genau diese Sorte ist in der Android-App schon einmal unsichtbar
 * geworden: `Screen.Settings` stand dort im Navigationsgraphen und kam im
 * ganzen Baum genau einmal vor — in seiner eigenen Registrierung. Marco fand
 * die Einstellungen nicht, weil es keinen Weg dorthin gab; seither hält
 * ErreichbareRoutenTest das fest.
 *
 * Hier ist die Lage dieselbe, nur in HTML: Eine `.tab`-Fläche ohne Eintrag im
 * Menü ist unsichtbar, ein Eintrag ohne Fläche tut beim Klick nichts, und ein
 * Eintrag ohne Lader zeigt eine leere Seite. Keines davon meldet der Browser.
 *
 * ── Gegenproben (durchgeführt, Befunde gemessen) ────────────────────────────
 *
 *   data-arg="gutscheine" → "gutschein"   -> Fälle 1, 2 UND 3 rot
 *   data-arg="daten"      → "datenX"      -> Fälle 1, 2 UND 3 rot
 *   SICHTEN-Eintrag `app` entfernt        -> Fall 3 rot
 *
 * Die ersten beiden ziehen drei Fälle mit, und das ist kein Mangel, sondern
 * die Kette: Ein verschriebener Eintrag hat keine Fläche (1), lässt seine
 * Fläche unerreichbar zurück (2) und passt nicht mehr zur Lader-Tabelle (3).
 * Vorhergesagt hatte ich je einen Fall — gemessen waren es drei.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const NAV  = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');

/** Die Namen aus dem Menü — `data-click="oeffneSicht" data-arg="…"`. */
function menueEintraege() {
  return [...HTML.matchAll(/data-click="oeffneSicht"\s+data-arg="([\w-]+)"/g)].map(m => m[1]);
}

/** Alle `.tab`-Flächen, die kein Reiter in der Leiste anspricht. */
function sichtFlaechen() {
  const reiter = new Set([...HTML.matchAll(/class="ntab[^"]*"[^>]*data-tab="([\w-]+)"/g)]
    .map(m => m[1]));
  return [...HTML.matchAll(/<div class="tab[^"]*" id="tab-([\w-]+)"/g)]
    .map(m => m[1])
    .filter(n => !reiter.has(n));
}

test('jeder Menüeintrag hat seine Fläche', () => {
  const eintraege = menueEintraege();
  // Selbstnachweis: Ohne Treffer wäre die Schleife darunter still grün.
  assert.ok(eintraege.length >= 5,
    `Nur ${eintraege.length} Menüeinträge gefunden — greift das Muster noch?`);
  const ohneFlaeche = eintraege.filter(n => !HTML.includes(`<div class="tab" id="tab-${n}">`));
  assert.deepEqual(ohneFlaeche, [],
    'Diese Menüeinträge zeigen auf eine Fläche, die es nicht gibt — der Klick ' +
    `täte nichts: ${ohneFlaeche.join(', ')}`);
});

test('jede Sicht ist über das Menü erreichbar', () => {
  const flaechen = sichtFlaechen();
  assert.ok(flaechen.length >= 5,
    `Nur ${flaechen.length} Sichten gefunden — greift das Muster noch?`);
  const eintraege = new Set(menueEintraege());
  const ohneWeg = flaechen.filter(n => !eintraege.has(n));
  assert.deepEqual(ohneWeg, [],
    'Diese Flächen hängen im Markup, aber kein Menüeintrag führt dorthin:\n  ' +
    ohneWeg.join('\n  ') +
    '\nEine Seite, die niemand öffnen kann, ist keine Seite — sie ist ' +
    'Markup mit Pflegekosten. (Dieselbe Regel wie ErreichbareRoutenTest in ' +
    'der Android-App.)');
});

test('jede Sicht lädt, was sie zeigt', () => {
  // `const SICHTEN = { … };` in js/02-gallery.js — die Zuordnung Name → Lader.
  const block = NAV.slice(NAV.indexOf('const SICHTEN = {'));
  const ende  = block.indexOf('\n};');
  assert.ok(ende > 0, 'SICHTEN nicht gefunden — umbenannt?');
  const namen = [...block.slice(0, ende).matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(namen.sort(), menueEintraege().sort(),
    'Menü und Lader-Tabelle nennen nicht dieselben Sichten. Ein Eintrag ohne ' +
    'Lader öffnet eine Seite, auf der nichts steht — und das sieht aus wie ' +
    '„keine Daten vorhanden".');
});

test('der Reiter „Einstellungen" ist Verwaltersache', () => {
  // Marcos Vorgabe: nur noch, was ein Administrator setzen kann. Deshalb ist
  // der Reiter wie das Monitoring vorgeblendet und wird erst für Admins
  // sichtbar (js/01-core.js).
  assert.match(HTML, /id="ntab-settings"[^>]*style="display:none"/,
    'Der Einstellungs-Reiter steht wieder für alle da — für Nicht-Admins wäre ' +
    'er leer.');
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-core.js'), 'utf8');
  assert.match(core, /ntab-settings'\);\s*if\s*\(ns\)\s*ns\.style\.display\s*=\s*''/,
    'Niemand blendet den Reiter für Admins wieder ein — dann fehlt er auch dort.');
});
