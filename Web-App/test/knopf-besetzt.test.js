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
 * Der arbeitende Knopf behält seine Beschriftung — und seine Breite.
 *
 * ── Zwei Meldungen, dieselbe Stelle ─────────────────────────────────────────
 *
 * Marcos Video vom 22.09., Reiter „Teileliste": Beim Druck auf „Bereits
 * vorhandene Teile eintragen" zuckt die ganze Zeile kurz zusammen und springt
 * zurück. NACHGEMESSEN an den Einzelbildern (1458×576, 30 Bilder/s): zweimal
 * je sieben Bilder, also gut 0,2 s — Bilder 8–14 und 56–62. Verändert ist der
 * Streifen y 256–269 über die volle Breite x 137–856, also Knopf UND beide
 * Kästchen daneben. Die Zahl dunkler Bildpunkte darin fällt von 1258 auf 723.
 *
 * Nach der ersten Reparatur (Breite einfrieren) blieb die Zeile stehen, aber
 * Marco sah weiter hin: „verschwindet der Button nach wie vor kurz und man
 * sieht ganz kurz Punkt." Er hatte recht — die Breite stand, der Knopf war
 * trotzdem leer, weil knopfBesetzt() die Beschriftung gegen
 * Auslassungspunkte tauschte.
 *
 * ── Was jetzt gilt ──────────────────────────────────────────────────────────
 *
 * Die Beschriftung wird gar nicht mehr angefasst. Dass der Knopf arbeitet,
 * zeigen die Sperre, der Zeiger und ein Streifen an der Unterkante
 * (.besetzt in styles.css) — alles drei ohne jede Auswirkung auf die Breite.
 * Nur wer ausdrücklich einen Wartetext mitgibt, bekommt einen; das tut allein
 * die PDF-Erzeugung, die ihren Fortschritt hineinschreibt. Für DIESEN Fall
 * bleibt das Einfrieren der Breite nötig.
 *
 * ── Warum dieser Test und keine Quelltext-Regel ─────────────────────────────
 *
 * Eine Regel „im Quelltext muss minWidth vorkommen" wäre mit einem Kommentar
 * zufrieden. Hier läuft die ECHTE Funktion aus public/js/01-core.js unter
 * jsdom, mit einer gestellten offsetWidth — jsdom rechnet kein Layout, also
 * ist die Breite das einzige, was gestellt werden muss.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Beschriftung wieder gegen „…" getauscht → Schritt 1 rot.
 *   b) Die Klasse `besetzt` nicht mehr gesetzt → Schritt 1 rot.
 *   c) Das Einfrieren der Breite entfernt → Schritt 5 rot.
 *   d) Die Freigabe setzt minWidth blind auf '' → Schritt 3 rot.
 */
test('knopfBesetzt(): Beschriftung und Breite bleiben, solange der Knopf besetzt ist', () => {
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

  const BESCHRIFTUNG = '📦 Bereits vorhandene Teile eintragen';
  const dom = new JSDOM(`<button class="btn bs" id="b">${BESCHRIFTUNG}</button>`);
  const btn = dom.window.document.getElementById('b');
  // jsdom rechnet kein Layout; offsetWidth ist dort immer 0. Die gemessene
  // Breite des echten Knopfes kommt deshalb von Hand herein.
  const breite = (px) => Object.defineProperty(btn, 'offsetWidth', { value: px, configurable: true });
  breite(235);

  // 1. Besetzt: Beschriftung steht, der Zustand ist trotzdem sichtbar.
  const frei = knopfBesetzt(btn);
  assert.equal(btn.textContent, BESCHRIFTUNG,
    'Die Beschriftung darf nicht weichen — genau das meinte Marco mit „man ' +
    'sieht ganz kurz Punkt".');
  assert.ok(btn.classList.contains('besetzt'),
    'Ohne diese Klasse fehlt jedes Zeichen, dass der Knopf arbeitet — ' +
    'die Regel dazu steht in styles.css.');
  assert.equal(btn.disabled, true);

  // 2. Freigegeben: alles zurück.
  frei();
  assert.equal(btn.textContent, BESCHRIFTUNG);
  assert.equal(btn.classList.contains('besetzt'), false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.style.minWidth, '', 'Die Vorgabe war leer, also muss sie leer zurückkommen.');

  // 3. Ein Knopf mit EIGENER Mindestbreite behält sie.
  btn.style.minWidth = '300px';
  knopfBesetzt(btn)();
  assert.equal(btn.style.minWidth, '300px',
    'Die Freigabe darf nicht blind leeren, sonst verliert der Knopf seine eigene Vorgabe.');
  btn.style.minWidth = '';

  // 4. Ein unsichtbarer Knopf (offsetWidth 0) bekommt nichts aufgedrückt.
  breite(0);
  knopfBesetzt(btn);
  assert.equal(btn.style.minWidth, '', 'Bei Breite 0 gibt es nichts einzufrieren.');
  btn.disabled = false;
  btn.classList.remove('besetzt');

  // 5. MIT eigenem Wartetext: Der Text wechselt — und die Breite wird
  //    festgehalten, sonst risse dieser Knopf die Zeile mit.
  breite(235);
  const freiPdf = knopfBesetzt(btn, 'erstelle…');
  assert.equal(btn.textContent, 'erstelle…');
  assert.equal(btn.style.minWidth, '235px',
    'Wechselt die Beschriftung doch, schrumpft der Knopf — dann muss die ' +
    'Breite stehen bleiben.');
  freiPdf();
  assert.equal(btn.textContent, BESCHRIFTUNG, 'Danach kommt die ursprüngliche Beschriftung zurück.');

  // 6. Die Freigabe darf eine ANDERE Beschriftung setzen (QR: „Neu generieren").
  knopfBesetzt(btn)('Neu generieren');
  assert.equal(btn.textContent, 'Neu generieren');
});
