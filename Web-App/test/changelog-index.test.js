/**
 * Der Index der Fix-Historie und die Teile in CHANGELOG/ müssen zusammenpassen.
 *
 * ── Warum es diese Prüfung gibt (Nachtrag 148) ──────────────────────────────
 * CHANGELOG-fixes.md war auf 640 KB in EINER Datei gewachsen und liegt jetzt
 * als Teile im Ordner CHANGELOG/. Eine Aufteilung hat genau einen wunden
 * Punkt: Sie hält, solange jemand daran denkt. Wird ein Teil ergänzt und die
 * Tabelle nicht, führt der Index in die Irre — und ein Index, dem man nicht
 * trauen kann, ist schlechter als keiner, weil man ihm erst glaubt und dann
 * doch alles durchsucht.
 *
 * Geprüft wird deshalb die BEZIEHUNG, nicht der Wortlaut: jede Datei steht in
 * der Tabelle, jede Tabellenzeile hat eine Datei, und die Nachtragsnummern
 * überschneiden sich nicht. Der Text der Einträge selbst wird nicht angefasst.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { ROOT } = require('./helpers/sources');
const INDEX = path.join(ROOT, 'CHANGELOG-fixes.md');
const DIR   = path.join(ROOT, 'CHANGELOG');

/** Die Dateinamen, die die Tabelle im Index nennt. */
function ausTabelle() {
  const src = fs.readFileSync(INDEX, 'utf8');
  return [...src.matchAll(/^\|\s*\[([^\]]+\.md)\]\(CHANGELOG\/[^)]+\)/gm)].map(m => m[1]);
}

/** Die Dateien, die es wirklich gibt. */
function aufPlatte() {
  return fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort();
}

test('jeder Teil steht im Index und umgekehrt', () => {
  const tabelle = ausTabelle().sort();
  const platte  = aufPlatte();

  assert.ok(platte.length >= 5,
    `Nur ${platte.length} Teile gefunden — liegt die Historie noch in CHANGELOG/?`);
  assert.deepEqual(tabelle, platte,
    'Tabelle in CHANGELOG-fixes.md und Ordner CHANGELOG/ laufen auseinander');
});

test('kein Nachtrag steht in zwei Teilen', () => {
  const gesehen = new Map();          // Nummer → Datei
  const doppelt = [];
  for (const f of aufPlatte()) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/^## Nachtrag (\d+)\b/gm)) {
      const n = Number(m[1]);
      if (gesehen.has(n)) doppelt.push(`Nachtrag ${n}: ${gesehen.get(n)} und ${f}`);
      else gesehen.set(n, f);
    }
  }
  assert.deepEqual(doppelt, [], `Nachtrag mehrfach abgelegt:\n  ${doppelt.join('\n  ')}`);

  // Untergrenze aus demselben Grund wie in require-exports.test.js: Bricht das
  // Suchmuster (etwa weil Überschriften anders heissen), prüfte diese Regel
  // stillschweigend nichts mehr und bliebe grün.
  assert.ok(gesehen.size > 100,
    `Nur ${gesehen.size} nummerierte Nachträge gefunden — greift das Muster noch?`);
});

test('jeder Teil nennt am Anfang, wohin er gehört', () => {
  const ohne = aufPlatte().filter(f =>
    !fs.readFileSync(path.join(DIR, f), 'utf8')
       .slice(0, 400).includes('CHANGELOG-fixes.md'));
  assert.deepEqual(ohne, [],
    'Diese Teile verweisen nicht zurück auf den Index: ' + ohne.join(', '));
});

test('der Index selbst bleibt kurz', () => {
  // Der ganze Zweck der Aufteilung. 20 KB sind grosszügig — die Tabelle wächst
  // um eine Zeile je 25 Nachträge.
  const kb = fs.statSync(INDEX).size / 1024;
  assert.ok(kb < 20,
    `CHANGELOG-fixes.md ist wieder auf ${kb.toFixed(0)} KB gewachsen — ` +
    'gehören die neuen Einträge in einen Teil unter CHANGELOG/?');
});
