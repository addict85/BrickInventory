/**
 * Call buttonBusy() correctly — the button that shows its own source text.
 *
 * ── Counter-checks (performed, result in the commit) ───────────────────────
 *   a) one of the three places turned back to the old form → red.
 *   b) the release no longer undone (`buttonBusy(btn);` alone) → red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

/** The content of the bracket group from `opened` — strings and comments respected. */
function group(t, opened) {
  let depth = 0,
    i = opened;
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
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (!depth) return t.slice(opened + 1, i);
    }
    i++;
  }
  throw new Error('no matching bracket');
}

test('buttonBusy(): the second argument is a label, not a callback', () => {
  const files = fs.readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(files.length >= 10, `Only ${files.length} scripts — does the search still match?`);

  const wrong = [],
    unused = [];
  let found = 0;
  for (const name of files) {
    const src = fs.readFileSync(path.join(JS, name), 'utf8');
    for (const m of src.matchAll(/buttonBusy\s*\(/g)) {
      // Skip the definition itself and the import.
      const before = src.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(before) || /import .*$/.test(before)) continue;
      found++;
      const row = src.slice(0, m.index).split('\n').length;
      const args = group(src, m.index + m[0].length - 1);
      // Split off the second argument at the top level.
      let depth = 0,
        secondOne = null;
      for (let i = 0; i < args.length; i++) {
        const c = args[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
          secondOne = args.slice(i + 1).trim();
          break;
        }
      }
      if (secondOne && /^(async\b|\(|function\b)/.test(secondOne)) wrong.push(`${name}:${row}`);
      // And the return value MUST land somewhere — otherwise the button stays
      // occupied forever.
      if (!/(=|return|\?|:)\s*$/.test(before.trimEnd() + ' '.repeat(0)) && !/[=?:]\s*$/.test(before.trimEnd()))
        unused.push(`${name}:${row}`);
    }
  }
  assert.ok(found >= 5, `Only ${found} calls found — does the search still match?`);
  assert.deepEqual(
    wrong,
    [],
    'A FUNCTION is passed as the label here. It ends up as text ' +
      'on the button, and its body never runs — exactly the bug from Marco’s screenshot.',
  );
  assert.deepEqual(
    unused,
    [],
    'The release is thrown away here. The button then stays permanently ' + 'disabled and keeps „…“ as its label.',
  );
});

/**
 * The working button keeps its label — and its width. Counter-checks:
 *   a) label swapped for “…" again → step 1 red.
 *   b) the class `occupied` no longer set → step 1 red.
 *   c) freezing the width removed → step 5 red.
 *   d) the release blindly sets minWidth to '' → step 3 red.
 */
test('buttonBusy(): label and width stay as long as the button is busy', () => {
  const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

  // Take the real function from the source text — not rebuilt.
  const src = fs.readFileSync(path.join(JS, 'dom.js'), 'utf8');
  const opened = src.indexOf('export function buttonBusy');
  assert.ok(opened > 0, 'buttonBusy() not found — renamed?');
  const start = src.indexOf('{', src.indexOf(')', opened));
  let depth = 0,
    end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (!depth) {
        end = i;
        break;
      }
    }
  }
  const source = src.slice(opened, end + 1).replace(/^export\s+/, '');
  const buttonOccupied = new Function(`${source}; return buttonBusy;`)();

  const LABEL = '📦 Bereits vorhandene Teile eintragen';
  const dom = new JSDOM(`<button class="btn bs" id="b">${LABEL}</button>`);
  const btn = dom.window.document.getElementById('b');
  // jsdom computes no layout; offsetWidth is always 0 there. The measured
  // width of the real button is therefore passed in by hand.
  const width = px => Object.defineProperty(btn, 'offsetWidth', { value: px, configurable: true });
  width(235);

  // 1. Occupied: the label stays, the state is visible anyway.
  const free = buttonOccupied(btn);
  assert.equal(
    btn.textContent,
    LABEL,
    'The label must not go away — that is exactly what Marco meant with „man ' + 'sieht ganz kurz Punkt“.',
  );
  assert.ok(
    btn.classList.contains('occupied'),
    'Without this class there is no sign that the button is working — ' + 'the rule for it is in styles.css.',
  );
  assert.equal(btn.disabled, true);

  // 2. Released: everything back.
  free();
  assert.equal(btn.textContent, LABEL);
  assert.equal(btn.classList.contains('occupied'), false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.style.minWidth, '', 'The default was empty, so it must come back empty.');

  // 3. A button with its OWN minimum width keeps it.
  btn.style.minWidth = '300px';
  buttonOccupied(btn)();
  assert.equal(
    btn.style.minWidth,
    '300px',
    'The release must not clear blindly, otherwise the button loses its own default.',
  );
  btn.style.minWidth = '';

  // 4. An invisible button (offsetWidth 0) gets nothing imposed.
  width(0);
  buttonOccupied(btn);
  assert.equal(btn.style.minWidth, '', 'At width 0 there is nothing to freeze.');
  btn.disabled = false;
  btn.classList.remove('occupied');

  // 5. WITH its own waiting text: the text changes — and the width is
  //    held, otherwise this button would tear the line along.
  width(235);
  const freePdf = buttonOccupied(btn, 'erstelle…');
  assert.equal(btn.textContent, 'erstelle…');
  assert.equal(
    btn.style.minWidth,
    '235px',
    'If the label changes after all, the button shrinks — then the ' + 'width must stay.',
  );
  freePdf();
  assert.equal(btn.textContent, LABEL, 'Afterwards the original label comes back.');

  // 6. The release may set a DIFFERENT label (QR: “Neu generieren").
  buttonOccupied(btn)('Neu generieren');
  assert.equal(btn.textContent, 'Neu generieren');
});
