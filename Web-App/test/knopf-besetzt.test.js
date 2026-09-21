/**
 * knopfBesetzt() richtig aufrufen — der Knopf, der seinen eigenen Quelltext zeigt.
 *
 * ── Marcos Bild ─────────────────────────────────────────────────────────────
 *
 * Im Reiter „Merkliste" stand an der Stelle des Knopfes „Auf die
 * Merkliste" der MINIFIZIERTE QUELLTEXT der Funktion:
 *
 *     async()=>{let e=await f("POST","/v1/wanted",{set_number:t,…
 *
 * ── Warum ───────────────────────────────────────────────────────────────────
 *
 * Die Hilfsfunktion hat diese Form (public/js/01-core.js):
 *
 *     export function knopfBesetzt(btn, laeuft = '…') {
 *       const vorher = btn.textContent;
 *       btn.disabled = true;
 *       btn.textContent = laeuft;
 *       return (text) => { … };            // ← FREIGABE
 *     }
 *
 * Das zweite Argument ist die BESCHRIFTUNG waehrend der Arbeit, und der
 * Rueckgabewert gibt den Knopf wieder frei. Drei Stellen in
 * 16-merkliste.js haben sie aufgerufen, als nehme sie einen Rueckruf
 * entgegen:
 *
 *     await knopfBesetzt(G('mk-add'), async () => { … });
 *
 * Damit passierte zweierlei: Die Funktion landete als TEXT auf dem Knopf, und
 * ihr Rumpf lief NIE. „Auf die Merkliste" tat also gar nichts — deshalb
 * stand darunter weiter „Noch keine Wünsche". Dasselbe bei „Auf die
 * Merkliste" im Katalog-Detail und beim Bestaetigen der Uebernahme.
 *
 * ── Warum ein Test und kein Kommentar ───────────────────────────────────────
 *
 * Kein bestehender Test konnte das sehen: Sie lesen Quelltext und pruefen,
 * DASS etwas dasteht — nicht, ob ein Aufruf zur Form der gerufenen Funktion
 * passt. Diese Pruefung tut genau das, und zwar fuer alle Dateien auf einmal.
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ────────────────────────
 *   a) Eine der drei Stellen auf die alte Form zurueckgedreht → rot.
 *   b) Die Freigabe nicht mehr aufgehoben (`knopfBesetzt(btn);` allein) → rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

/** Der Inhalt der Klammergruppe ab `auf` — Zeichenketten und Kommentare respektiert. */
function gruppe(t, auf) {
  let tiefe = 0, i = auf;
  while (i < t.length) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { i = t.indexOf('\n', i); continue; }
    if (c === '/' && t[i + 1] === '*') { i = t.indexOf('*/', i) + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '(') tiefe++;
    else if (c === ')') { tiefe--; if (!tiefe) return t.slice(auf + 1, i); }
    i++;
  }
  throw new Error('keine passende Klammer');
}

test('knopfBesetzt(): zweites Argument ist eine Beschriftung, kein Rückruf', () => {
  const dateien = fs.readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const falsch = [], ungenutzt = [];
  let gefunden = 0;
  for (const name of dateien) {
    const src = fs.readFileSync(path.join(JS, name), 'utf8');
    for (const m of src.matchAll(/knopfBesetzt\s*\(/g)) {
      // Die Definition selbst und die Einfuhr überspringen.
      const davor = src.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(davor) || /import .*$/.test(davor)) continue;
      gefunden++;
      const zeile = src.slice(0, m.index).split('\n').length;
      const args = gruppe(src, m.index + m[0].length - 1);
      // Zweites Argument auf oberster Ebene abtrennen.
      let tiefe = 0, zweites = null;
      for (let i = 0; i < args.length; i++) {
        const c = args[i];
        if ('([{'.includes(c)) tiefe++;
        else if (')]}'.includes(c)) tiefe--;
        else if (c === ',' && tiefe === 0) { zweites = args.slice(i + 1).trim(); break; }
      }
      if (zweites && /^(async\b|\(|function\b)/.test(zweites))
        falsch.push(`${name}:${zeile}`);
      // Und der Rückgabewert MUSS irgendwo landen — sonst bleibt der Knopf
      // für immer besetzt.
      if (!/(=|return|\?|:)\s*$/.test(davor.trimEnd() + ' '.repeat(0)) &&
          !/[=?:]\s*$/.test(davor.trimEnd()))
        ungenutzt.push(`${name}:${zeile}`);
    }
  }
  assert.ok(gefunden >= 5, `Nur ${gefunden} Aufrufe gefunden — greift die Suche noch?`);
  assert.deepEqual(falsch, [],
    'Hier wird eine FUNKTION als Beschriftung übergeben. Sie landet als Text ' +
    'auf dem Knopf, und ihr Rumpf läuft nie — genau der Fehler aus Marcos Bild.');
  assert.deepEqual(ungenutzt, [],
    'Hier wird die Freigabe weggeworfen. Der Knopf bleibt dann dauerhaft ' +
    'deaktiviert und trägt weiter „…" als Beschriftung.');
});
