/**
 * Auf dem Handy erscheint bei Zahlenfeldern die Zahlentastatur.
 *
 * ── Marcos Vorgabe vom 28.09. ───────────────────────────────────────────────
 *
 *   „Bitte auch in der Webapp sicherstellen, dass wenn man mit einem mobilen
 *    Device aufruft, dass in allen Eingabefeldern nur das Zahlenfeld
 *    erscheint."
 *
 * ── Warum `type="number"` allein nicht reicht ───────────────────────────────
 *
 * Es reicht MEISTENS: Chrome und Safari zeigen dann eine Ziffernblock-Tastatur.
 * Aber es ist eine Typ-Angabe, keine Tastatur-Angabe — was der Browser daraus
 * macht, ist ihm überlassen. Mehrere Android-Tastaturen zeigen dort die volle
 * Tastatur mit einer Ziffernreihe obendrauf, und bei Preisen sitzt das Komma
 * dann nicht auf dem Block.
 *
 * `inputmode` sagt es direkt und ist genau dafür da: `numeric` für ganze
 * Zahlen (Menge, Port, Kontingent), `decimal` für alles mit Komma (Preise,
 * Schwellen). Beides zusammen — der Typ für die VALIDIERUNG, der Modus für die
 * TASTATUR.
 *
 * ── Warum die Regel nur `type="number"` verlangt ────────────────────────────
 *
 * Ein Feld ist für diese Prüfung genau dann ein Zahlenfeld, wenn es sich
 * selbst so nennt. Nach „sieht numerisch aus" zu suchen hiesse raten: Die
 * Teilenummer „3001pb01" und die Figurennummer „sw0001" sehen wie Zahlen aus
 * und sind keine — eine Zahlentastatur machte sie unbenutzbar. Wer ein neues
 * Zahlenfeld anlegt, schreibt `type="number"` ohnehin hin; genau dort greift
 * die Regel.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) inputmode bei #add-price entfernt   → Schritt 1 rot, nennt die Stelle
 *   b) decimal → numeric bei #add-price    → Schritt 2 rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** index.html plus alle Frontend-Bausteine — NICHT das gebaute Bündel. */
function quellen() {
  const js = fs.readdirSync(path.join(ROOT, 'public/js'))
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    .map(f => 'public/js/' + f);
  return ['public/index.html', ...js]
    .map(p => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]);
}

function zahlenfelder() {
  const treffer = [];
  for (const [p, s] of quellen()) {
    for (const m of s.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (!/type=["']?number/.test(tag)) continue;
      treffer.push({ datei: p, zeile: s.slice(0, m.index).split('\n').length, tag });
    }
  }
  return treffer;
}

test('1. jedes type="number" trägt einen inputmode', () => {
  const felder = zahlenfelder();
  // Selbstnachweis: Findet die Suche überhaupt etwas? Ohne das wäre eine
  // leere Liste für immer grün, ohne je ein Feld angesehen zu haben.
  assert.ok(felder.length >= 20,
    `Nur ${felder.length} Zahlenfelder gefunden — Muster veraltet?`);

  const ohne = felder.filter(f => !/inputmode=/i.test(f.tag))
    .map(f => `${f.datei}:${f.zeile}`);
  assert.deepEqual(ohne, [],
    'Diese Zahlenfelder sagen dem Handy nicht, welche Tastatur es zeigen soll:\n  ' +
    ohne.join('\n  ') +
    '\n`numeric` für ganze Zahlen, `decimal` für alles mit Komma.');
});

test('2. Preise und Schwellen bekommen `decimal`, nicht `numeric`', () => {
  // `numeric` ist ein reiner Ziffernblock — ohne Komma. Bei einem Preisfeld
  // heisst das: Man kann 12 tippen, aber nicht 12.50. Der Unterschied fällt
  // erst auf, wenn jemand einen Rappenbetrag eingeben will.
  const falsch = [];
  for (const f of zahlenfelder()) {
    const kommaFeld = /step=["']?0?\.\d/.test(f.tag);
    const modus = (f.tag.match(/inputmode=["']?(\w+)/i) || [])[1];
    if (kommaFeld && modus !== 'decimal') falsch.push(`${f.datei}:${f.zeile} (${modus})`);
  }
  assert.deepEqual(falsch, [],
    'Diese Felder erlauben Kommastellen (step=0.01), zeigen aber einen reinen ' +
    'Ziffernblock:\n  ' + falsch.join('\n  '));
});
