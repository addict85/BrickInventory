'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die BrickLink-Wunschliste wird in BEIDEN Oberflaechen maskiert.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Die Android-App hatte einen XML-Maskierer und wandte ihn auf alle drei
 * Textfelder an (BrickLinkWunschliste.kt, maskiert()). Die Webapp setzte
 * dieselben Felder roh ein.
 *
 * Bei einem MANUELL erfassten Teil tippt der Mensch die Nummer. Ein `&` darin
 * macht aus der Wunschliste eine Datei, die BrickLink nicht liest; ein `<`
 * kann Elemente einfuegen, die niemand geschrieben hat. Dass es nie auffiel,
 * liegt daran, dass Teilenummern meist harmlos sind — das Kennzeichen dieser
 * Fehlerart: Zwei Fassungen einer Regel fallen nicht auf, solange die Daten
 * zufaellig mitspielen.
 *
 * ── Warum kein zweiter Escaper in der Webapp ────────────────────────────────
 * esc() ersetzt genau die fuenf Entitaeten, um die es geht (& < > " ').
 * Ein eigener XML-Maskierer daneben waere die dritte Fassung derselben Regel.
 */

const WURZEL = path.join(__dirname, '..');
const APP = path.join(WURZEL, '..', 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp');

const ohneKommentare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');

test('die Webapp maskiert jedes Textfeld der Wunschliste', () => {
  const src = ohneKommentare(
    fs.readFileSync(path.join(WURZEL, 'public', 'js', '08-init.js'), 'utf8'));
  const ab = src.indexOf('<INVENTORY>');
  assert.ok(ab > 0, 'Der XML-Aufbau der Wunschliste ist nicht mehr zu finden');
  const block = src.slice(ab, src.indexOf('</INVENTORY>', ab));

  for (const feld of ['ITEMTYPE', 'ITEMID', 'CONDITION']) {
    const m = new RegExp(`<${feld}>\\$\\{([^}]+)\\}</${feld}>`).exec(block);
    assert.ok(m, `<${feld}> steht nicht mehr im Aufbau — Muster veraltet?`);
    assert.ok(m[1].startsWith('esc('),
      `<${feld}> setzt „${m[1]}" ROH ein. Bei einem manuell erfassten Teil hat der ` +
      'Mensch den Wert getippt; ein & oder < macht die Wunschliste kaputt oder ' +
      'schiebt Elemente hinein.');
  }
});

test('die App maskiert dieselben Felder', () => {
  // Die Gegenprobe zur Regel oben: Faellt sie auf EINER Seite weg, laufen die
  // beiden Oberflaechen wieder auseinander — genau das war der Befund.
  const kt = ohneKommentare(fs.readFileSync(
    path.join(APP, 'util', 'BrickLinkWunschliste.kt'), 'utf8'));
  assert.match(kt, /private fun maskiert\(/,
    'Der XML-Maskierer der App ist weg');
  for (const feld of ['ITEMTYPE', 'ITEMID', 'CONDITION']) {
    const m = new RegExp(`<${feld}>"\\)\\.append\\(([^)]+\\)?)\\)`).exec(kt);
    assert.ok(m, `<${feld}> steht nicht mehr im Aufbau der App`);
    assert.ok(m[1].startsWith('maskiert('),
      `<${feld}> setzt „${m[1]}" in der App roh ein`);
  }
});

test('esc() deckt die fuenf XML-Entitaeten ab', () => {
  // Der Grund, warum die Webapp KEINEN eigenen XML-Maskierer bekommt. Faellt
  // eine der fuenf Ersetzungen aus esc() heraus, ist diese Entscheidung falsch
  // — und das soll hier auffallen und nicht in einer kaputten Wunschliste.
  const core = fs.readFileSync(path.join(WURZEL, 'public', 'js', '01-core.js'), 'utf8');
  const fn = core.slice(core.indexOf('export function esc('),
                        core.indexOf('export function escJs('));
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
  const core = ohneKommentare(
    fs.readFileSync(path.join(WURZEL, 'public', 'js', '01-core.js'), 'utf8'));
  const treffer = [...core.matchAll(/class="job-sched-input"[^`]*?value="\$\{([^}]+)\}"/g)];
  assert.strictEqual(treffer.length, 2,
    `${treffer.length} Zeitplan-Eingabefelder gefunden, erwartet 2 — Muster veraltet?`);
  for (const m of treffer)
    assert.ok(m[1].startsWith('esc('),
      `Das Zeitplan-Feld setzt „${m[1]}" roh ein, waehrend data-arg daneben esc() nutzt`);
});
