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

/**
 * Der Knopf darf beim Drücken nicht schrumpfen.
 *
 * ── Marcos Video vom 22.09. ─────────────────────────────────────────────────
 *
 * Im Reiter „Teileliste" zuckt beim Druck auf „📦 Bereits vorhandene Teile
 * eintragen" die ganze Zeile kurz zusammen und springt zurück — mit ihr die
 * beiden Kästchen rechts daneben.
 *
 * ── Nachgemessen an den Einzelbildern ───────────────────────────────────────
 *
 * Aus dem Video (1458×576, 30 Bilder/s) fallen genau zwei Stellen auf, je
 * sieben Bilder lang (≈ 0,23 s): Bilder 8–14 und 56–62. Verändert ist dabei
 * der Streifen y 256–269 über die volle Breite x 137–856, also Knopf UND
 * beide Kästchen. Die Zahl dunkler Bildpunkte darin fällt von 1258 auf 723
 * und kommt danach auf 1233 zurück — Text verschwindet und kehrt wieder.
 *
 * ── Die Ursache ─────────────────────────────────────────────────────────────
 *
 * knopfBesetzt() tauscht die Beschriftung gegen „…". Das ist rund 200 px
 * schmaler, und weil die Zeile ein flex-Behälter ist, rutscht alles rechts
 * daneben nach. Die Anfrage dauert nur zwei Zehntelsekunden — und genau das
 * macht daraus ein Flackern statt einer sichtbaren Bewegung.
 *
 * ── Warum dieser Test und keine Quelltext-Regel ─────────────────────────────
 *
 * Eine Regel „im Quelltext muss minWidth vorkommen" wäre mit einem Kommentar
 * zufrieden. Hier läuft die ECHTE Funktion aus public/js/01-core.js unter
 * jsdom, mit einer gestellten offsetWidth — jsdom rechnet kein Layout, also
 * ist die Breite das einzige, was gestellt werden muss.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Das Einfrieren wieder entfernt → Schritt 1 rot.
 *   b) Die Freigabe setzt minWidth blind auf '' → Schritt 3 rot.
 */
test('knopfBesetzt(): die Breite bleibt, während der Knopf besetzt ist', () => {
  const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

  // Die echte Funktion aus dem Quelltext holen — nicht nachgebaut.
  const src = fs.readFileSync(path.join(JS, '01-core.js'), 'utf8');
  const auf = src.indexOf('export function knopfBesetzt');
  assert.ok(auf > 0, 'knopfBesetzt() nicht gefunden — umbenannt?');
  const start = src.indexOf('{', src.indexOf(')', auf));
  let tiefe = 0, ende = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') tiefe++;
    else if (src[i] === '}') { tiefe--; if (!tiefe) { ende = i; break; } }
  }
  const quelle = src.slice(auf, ende + 1).replace(/^export\s+/, '');
  const knopfBesetzt = new Function(`${quelle}; return knopfBesetzt;`)();

  const dom = new JSDOM('<button id="b">📦 Bereits vorhandene Teile eintragen</button>');
  const btn = dom.window.document.getElementById('b');
  const beschriftung = btn.textContent;
  // jsdom rechnet kein Layout; offsetWidth ist dort immer 0. Die gemessene
  // Breite des echten Knopfes kommt deshalb von Hand herein.
  Object.defineProperty(btn, 'offsetWidth', { value: 235, configurable: true });

  // 1. Besetzt: schmale Beschriftung, aber die Breite steht.
  const frei = knopfBesetzt(btn);
  assert.equal(btn.textContent, '…');
  assert.equal(btn.style.minWidth, '235px',
    'Ohne eingefrorene Breite schrumpft der Knopf um rund 200 px und die ' +
    'ganze Zeile rutscht nach — genau das Flackern aus Marcos Video.');

  // 2. Freigegeben: alles zurück.
  frei();
  assert.equal(btn.textContent, beschriftung);
  assert.equal(btn.style.minWidth, '', 'Die Vorgabe war leer, also muss sie leer zurückkommen.');

  // 3. Ein Knopf mit EIGENER Mindestbreite behält sie.
  btn.style.minWidth = '300px';
  knopfBesetzt(btn)();
  assert.equal(btn.style.minWidth, '300px',
    'Die Freigabe darf nicht blind leeren, sonst verliert der Knopf seine eigene Vorgabe.');

  // 4. Ein unsichtbarer Knopf (offsetWidth 0) bekommt nichts aufgedrückt.
  btn.style.minWidth = '';
  Object.defineProperty(btn, 'offsetWidth', { value: 0, configurable: true });
  knopfBesetzt(btn);
  assert.equal(btn.style.minWidth, '', 'Bei Breite 0 gibt es nichts einzufrieren.');
});
