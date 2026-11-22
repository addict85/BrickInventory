/**
 * Frontend modules: does a file call a name that ANOTHER module
 * declares without importing it?
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, ohneKommentare } = require('./helpers/sources');
const JS_DIR = path.join(ROOT, 'public', 'js');

/**
 * Names a file declares at the TOPMOST level (column 0).
 *
 * Deliberately only without indentation: otherwise function parameters like the
 * `resolve` from `new Promise(resolve => …)` would land in the list of project-known
 * names, and every other file with its own promise would be falsely
 * flagged.
 */
function declaredTop(src) {
  const namen = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  return namen;
}

/** All declarations of a file, also nested ones — for “is it there locally?". */
function declared(src) {
  const namen = new Set();
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g))
    namen.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
  return namen;
}

/** Names a file imports (including renaming via `as`). */
function imported(src) {
  const namen = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const roh of m[1].split(',')) {
      const n = roh.split(' as ').pop().trim();
      if (n) namen.add(n);
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) namen.add(m[1]);
  return namen;
}

/**
 * `file:Name` -> reason why the hit there is not a real call
 * (ohneKommentare() only cuts off comments from the start of the line, not
 * `code(); // … bar (…)`).
 */
const KNOWN_WRONG_HITS = new Map([
  ['set-csv-import.js:bar', 'Kommentar „show the global bar (…)“ nennt das Wort, kein Aufruf von monitor.js'],
]);

test('every frontend module imports what it calls', () => {
  const dateien = fs
    .readdirSync(JS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    // logviewer.js runs in its own popup window without a module system and brings
    // its helpers along itself — it shares no namespace with the rest.
    .filter(f => f !== 'logviewer.js');
  assert.ok(dateien.length > 8, `nur ${dateien.length} Frontend-Module gefunden`);

  const sources = new Map();
  for (const f of dateien) sources.set(f, ohneKommentare(fs.readFileSync(path.join(JS_DIR, f), 'utf8')));

  // i18n.js belongs to it
  sources.set('../i18n.js', ohneKommentare(fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')));

  // All names declared ANYWHERE in the frontend. Only these are
  // checked — thereby the test does not trigger on browser globals.
  const bekannt = new Map();
  for (const [f, src] of sources) for (const n of declaredTop(src)) bekannt.set(n, f);

  const fehlend = [];
  for (const [f, src] of sources) {
    const local = declared(src);
    const imp = imported(src);
    for (const [name, herkunft] of bekannt) {
      if (herkunft === f || local.has(name) || imp.has(name) || KNOWN_WRONG_HITS.has(`${f}:${name}`)) continue;
      // Call of the name, not as a property (obj.name) and not as a
      // string in an action list.
      const call = new RegExp(`(?<![.\\w$'"\`])${name}\\s*\\(`);
      if (call.test(src)) fehlend.push(`public/js/${f}: ruft ${name}() aus ${herkunft} ohne Import`);
    }
  }

  assert.deepEqual(fehlend, [], `Aufrufe über Modulgrenzen ohne Import:\n  ${fehlend.join('\n  ')}`);
});
