'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die BrickLink-Wunschliste der Webapp wird maskiert.
 *
 * ── Der Befund, aus dem dieser Test kam ─────────────────────────────────────
 * Die Android-App hatte einen XML-Maskierer und wandte ihn auf alle drei
 * Textfelder an; die Webapp setzte dieselben Felder roh ein.
 *
 * Bei einem MANUELL erfassten Teil tippt der Mensch die Nummer. Ein `&` darin
 * macht aus der Wunschliste eine Datei, die BrickLink nicht liest; ein `<`
 * kann Elemente einfuegen, die niemand geschrieben hat. Dass es nie auffiel,
 * liegt daran, dass Teilenummern meist harmlos sind — das Kennzeichen dieser
 * Fehlerart: Zwei Fassungen einer Regel fallen nicht auf, solange die Daten
 * zufaellig mitspielen.
 *
 * ── Was sich geaendert hat ──────────────────────────────────────────────────
 * Die App hat die Wunschliste nicht mehr: Marco hat die BrickLink-Funktion
 * aus dem Teile-Reiter entfernen lassen, und mit ihr fiel
 * BrickLinkWunschliste.kt weg. Die dritte Pruefung dieses Tests — „die App
 * maskiert dieselben Felder" — ist damit gegenstandslos und ENTFERNT statt
 * uebersprungen: Ein Test, der auf eine geloeschte Datei zeigt, stuerzt ab
 * oder schweigt, und beides ist schlechter als seine Abwesenheit.
 *
 * Die Regel selbst bleibt und gilt weiter — fuer die Oberflaeche, die den
 * Export noch hat.
 *
 * ── Warum kein zweiter Escaper in der Webapp ────────────────────────────────
 * esc() ersetzt genau die fuenf Entitaeten, um die es geht (& < > " ').
 * Ein eigener XML-Maskierer daneben waere eine zweite Fassung derselben Regel.
 *
 * ── Zwei Umzuege am 20.10., und warum sie noetig waren ──────────────────────
 *
 * 1. Der XML-Aufbau liegt nicht mehr in js/08-init.js, sondern in
 *    js/19-bricklink-xml.js. Diese Datei greift NICHT auf das Dokument zu —
 *    deshalb kann test/bricklink-wanted-xml.test.js sie einlesen und das
 *    FORMAT pruefen (keine XML-Deklaration, Groessengrenze, keine erfundene
 *    Farbe). In js/08-init.js ging das nicht: Sie laedt die Teileliste und
 *    braucht dafuer `document`.
 *
 * 2. esc() liegt nicht mehr in js/01-core.js, sondern in js/00-escapen.js.
 *    Das ist die Folge aus 1.: Der Aufbau muss maskieren, js/01-core.js
 *    laesst sich aber ohne Dokument nicht laden (GEMESSEN: „document is not
 *    defined"). Die Wahl war, esc() zu KOPIEREN — also genau die zweite
 *    Fassung, die dieser Test verbietet — oder es dorthin zu legen, wo beide
 *    Seiten es erreichen. js/01-core.js reicht es weiter, jeder bestehende
 *    `import { esc } from './01-core.js'` gilt unveraendert.
 */

const WURZEL = path.join(__dirname, '..');
const ohneKommentare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');

test('die Webapp maskiert jedes Textfeld der Wunschliste', () => {
  const src = ohneKommentare(
    fs.readFileSync(path.join(WURZEL, 'public', 'js', '19-bricklink-xml.js'), 'utf8'));
  // ── Kein Ausschnitt zwischen <INVENTORY> und </INVENTORY> mehr ──────────
  //
  // Hier stand genau das, und es passte zum alten Aufbau: EIN Template, das
  // den Rahmen und die Felder in einem Zug zusammensetzte. Seit dem Umzug
  // baut item() die Felder und baueWantedXml() den Rahmen — zwischen den
  // beiden INVENTORY-Marken steht also nichts mehr, und der Ausschnitt war
  // LEER. Die Prüfung meldete „<ITEMTYPE> steht nicht mehr im Aufbau", und
  // das war richtig gemeldet: Sie hatte nichts mehr zu lesen.
  //
  // Gelesen wird deshalb die ganze Datei. Sie enthält nur dieses eine
  // Format; ein Ausschnitt gewinnt hier nichts und kann ins Leere zeigen.
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
  //
  // Gelesen wird js/00-escapen.js (siehe Umzug 2 im Kopf). Die Datei enthaelt
  // NUR esc(), deshalb braucht es hier keinen Ausschnitt mehr — und damit
  // auch keinen Anker auf die naechste Funktion, der beim naechsten Umbau
  // ins Leere zeigt.
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
  // die dieselbe Regel zweimal verschieden anwendet, ist der Anfang der
  // naechsten Luecke.
  // coreQuelle() statt eines Dateinamens: Die Jobliste zog in Nachtrag 141 nach
  // js/01-monitor.js um. Ein Test, der den Ablageort nennt, wird davon grün,
  // dass sein Gegenstand weg ist — hier fiel er nur auf, weil er die Anzahl
  // der Treffer prüft und nicht bloß deren Form.
  const core = ohneKommentare(require('./helpers/sources').coreQuelle());
  const treffer = [...core.matchAll(/class="job-sched-input"[^`]*?value="\$\{([^}]+)\}"/g)];
  assert.strictEqual(treffer.length, 2,
    `${treffer.length} Zeitplan-Eingabefelder gefunden, erwartet 2 — Muster veraltet?`);
  for (const m of treffer)
    assert.ok(m[1].startsWith('esc('),
      `Das Zeitplan-Feld setzt „${m[1]}" roh ein, waehrend data-arg daneben esc() nutzt`);
});
