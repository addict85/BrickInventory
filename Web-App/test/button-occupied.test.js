/**
 * Call knopfBesetzt() correctly — the button that shows its own source text.
 *
 * ── Counter-checks (performed, result in the commit) ───────────────────────
 *   a) one of the three places turned back to the old form → red.
 *   b) the release no longer undone (`knopfBesetzt(btn);` alone) → red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

/** The content of the bracket group from `auf` — strings and comments respected. */
function gruppe(t, auf) {
  let tiefe = 0,
    i = auf;
  while (i < t.length) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') {
      i = t.indexOf('\n', i);
      continue;
    }
    if (c === '/' && t[i + 1] === '*') {
      i = t.indexOf('*/', i) + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < t.length && t[i] !== q) {
        if (t[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '(') tiefe++;
    else if (c === ')') {
      tiefe--;
      if (!tiefe) return t.slice(auf + 1, i);
    }
    i++;
  }
  throw new Error('keine passende Klammer');
}

test('knopfBesetzt(): the second argument is a label, not a callback', () => {
  const dateien = fs.readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const falsch = [],
    ungenutzt = [];
  let gefunden = 0;
  for (const name of dateien) {
    const src = fs.readFileSync(path.join(JS, name), 'utf8');
    for (const m of src.matchAll(/knopfBesetzt\s*\(/g)) {
      // Skip the definition itself and the import.
      const davor = src.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(davor) || /import .*$/.test(davor)) continue;
      gefunden++;
      const zeile = src.slice(0, m.index).split('\n').length;
      const args = gruppe(src, m.index + m[0].length - 1);
      // Split off the second argument at the top level.
      let tiefe = 0,
        zweites = null;
      for (let i = 0; i < args.length; i++) {
        const c = args[i];
        if ('([{'.includes(c)) tiefe++;
        else if (')]}'.includes(c)) tiefe--;
        else if (c === ',' && tiefe === 0) {
          zweites = args.slice(i + 1).trim();
          break;
        }
      }
      if (zweites && /^(async\b|\(|function\b)/.test(zweites)) falsch.push(`${name}:${zeile}`);
      // And the return value MUST land somewhere — otherwise the button stays
      // occupied forever.
      if (!/(=|return|\?|:)\s*$/.test(davor.trimEnd() + ' '.repeat(0)) && !/[=?:]\s*$/.test(davor.trimEnd()))
        ungenutzt.push(`${name}:${zeile}`);
    }
  }
  assert.ok(gefunden >= 5, `Nur ${gefunden} Aufrufe gefunden — greift die Suche noch?`);
  assert.deepEqual(
    falsch,
    [],
    'Hier wird eine FUNKTION als Beschriftung übergeben. Sie landet als Text ' +
      'auf dem Knopf, und ihr Rumpf läuft nie — genau der Fehler aus Marcos Bild.',
  );
  assert.deepEqual(
    ungenutzt,
    [],
    'Hier wird die Freigabe weggeworfen. Der Knopf bleibt dann dauerhaft ' +
      'deaktiviert und trägt weiter „…" als Beschriftung.',
  );
});

/**
 * The working button keeps its label — and its width. Counter-checks:
 *   a) label swapped for “…" again → step 1 red.
 *   b) the class `besetzt` no longer set → step 1 red.
 *   c) freezing the width removed → step 5 red.
 *   d) the release blindly sets minWidth to '' → step 3 red.
 */
test('knopfBesetzt(): label and width stay as long as the button is busy', () => {
  const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

  // Take the real function from the source text — not rebuilt.
  const src = fs.readFileSync(path.join(JS, 'dom.js'), 'utf8');
  const auf = src.indexOf('export function knopfBesetzt');
  assert.ok(auf > 0, 'knopfBesetzt() nicht gefunden — umbenannt?');
  const start = src.indexOf('{', src.indexOf(')', auf));
  let tiefe = 0,
    ende = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') tiefe++;
    else if (src[i] === '}') {
      tiefe--;
      if (!tiefe) {
        ende = i;
        break;
      }
    }
  }
  const quelle = src.slice(auf, ende + 1).replace(/^export\s+/, '');
  const knopfBesetzt = new Function(`${quelle}; return knopfBesetzt;`)();

  const LABEL = '📦 Bereits vorhandene Teile eintragen';
  const dom = new JSDOM(`<button class="btn bs" id="b">${LABEL}</button>`);
  const btn = dom.window.document.getElementById('b');
  // jsdom computes no layout; offsetWidth is always 0 there. The measured
  // width of the real button is therefore passed in by hand.
  const breite = px => Object.defineProperty(btn, 'offsetWidth', { value: px, configurable: true });
  breite(235);

  // 1. Occupied: the label stays, the state is visible anyway.
  const frei = knopfBesetzt(btn);
  assert.equal(
    btn.textContent,
    LABEL,
    'Die Beschriftung darf nicht weichen — genau das meinte Marco mit „man ' + 'sieht ganz kurz Punkt".',
  );
  assert.ok(
    btn.classList.contains('besetzt'),
    'Ohne diese Klasse fehlt jedes Zeichen, dass der Knopf arbeitet — ' + 'die Regel dazu steht in styles.css.',
  );
  assert.equal(btn.disabled, true);

  // 2. Released: everything back.
  frei();
  assert.equal(btn.textContent, LABEL);
  assert.equal(btn.classList.contains('besetzt'), false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.style.minWidth, '', 'Die Vorgabe war leer, also muss sie leer zurückkommen.');

  // 3. A button with its OWN minimum width keeps it.
  btn.style.minWidth = '300px';
  knopfBesetzt(btn)();
  assert.equal(
    btn.style.minWidth,
    '300px',
    'Die Freigabe darf nicht blind leeren, sonst verliert der Knopf seine eigene Vorgabe.',
  );
  btn.style.minWidth = '';

  // 4. An invisible button (offsetWidth 0) gets nothing imposed.
  breite(0);
  knopfBesetzt(btn);
  assert.equal(btn.style.minWidth, '', 'Bei Breite 0 gibt es nichts einzufrieren.');
  btn.disabled = false;
  btn.classList.remove('besetzt');

  // 5. WITH its own waiting text: the text changes — and the width is
  //    held, otherwise this button would tear the line along.
  breite(235);
  const freePdf = knopfBesetzt(btn, 'erstelle…');
  assert.equal(btn.textContent, 'erstelle…');
  assert.equal(
    btn.style.minWidth,
    '235px',
    'Wechselt die Beschriftung doch, schrumpft der Knopf — dann muss die ' + 'Breite stehen bleiben.',
  );
  freePdf();
  assert.equal(btn.textContent, LABEL, 'Danach kommt die ursprüngliche Beschriftung zurück.');

  // 6. The release may set a DIFFERENT label (QR: “Neu generieren").
  knopfBesetzt(btn)('Neu generieren');
  assert.equal(btn.textContent, 'Neu generieren');
});
