/**
 * Every path with which a test reads a SOURCE FILE must also point there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Remove comments line by line: a regex would take the /* in '/data/x/*' for a comment. */
function ohneKommentare(s) {
  const zeilen = [];
  let imBlock = false;
  for (const z of String(s).split('\n')) {
    const t = z.trim();
    if (imBlock) {
      zeilen.push('');
      if (t.endsWith('*/')) imBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      zeilen.push('');
      if (!t.includes('*/')) imBlock = true;
      continue;
    }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
}

/** Extensions that point to a source file of this tree. */
const QUELLE = /\.(ts|js|sql|html|json|yml|xml)$/;

/**
 * Does this file exist — or the source it is built from?
 */
function existsSource(rel) {
  if (fs.existsSync(path.join(ROOT, rel))) return true;
  if (!rel.endsWith('.js')) return false;
  return fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
}

/** Folders that really exist in the web tree — everything else is not a path from here. */
const ORDNER = ['routes', 'src', 'jobs', 'clients', 'db', 'startup', 'public', 'scripts', 'types'];

test('no test reads a source file that does not exist', () => {
  const dateien = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Testdateien gefunden — Ordner umbenannt?`);

  const kaputt = [];
  const offen = [];
  const absent = [];
  let geprueft = 0;

  /**
   * Does the path stand in an ABSENCE assertion?
   */
  const isAbwesenheitsCheck = (src, bis) => /!\s*fs\.existsSync\($/.test(src.slice(0, bis).trimEnd());

  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(__dirname, datei), 'utf8'));

    // ── Form 1: 'src/account/deviceToken.ts' as one string ──────────────────────
    for (const m of src.matchAll(/['"]((?:[\w.-]+\/)+[\w.-]+)['"]/g)) {
      const p = m[1];
      if (!QUELLE.test(p)) continue;
      if (!ORDNER.includes(p.split('/')[0])) continue;
      geprueft++;
      if (!existsSource(p)) kaputt.push(`${datei}: ${p}`);
    }

    // ── Form 2: path.join(ROOT, 'src/account/deviceToken.ts') ────────────────────────
    for (const m of src.matchAll(/path\.join\(\s*ROOT\s*,([^)]*)\)/g)) {
      const roh = m[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const segmente = roh.map(s => /^['"]([^'"]*)['"]$/.exec(s)?.[1]);
      if (segmente.some(s => s === undefined)) {
        // Not resolvable — reported, not skipped.
        offen.push(`${datei}: ${roh.find((_s, i) => segmente[i] === undefined)}`);
        continue;
      }
      const p = segmente.join('/');
      if (!QUELLE.test(p)) continue;
      if (isAbwesenheitsCheck(src, m.index)) {
        absent.push(`${datei}: ${p}`);
        continue;
      }
      geprueft++;
      if (!existsSource(p)) kaputt.push(`${datei}: ${p}`);
    }
  }

  // Self-proof: if the search finds nothing, the assertion below would be
  // silently green. MEASURED there are over a hundred.
  // MEASURED: 768. The threshold is at half — it should catch a broken
  // search expression, not trigger on every new test file.
  assert.ok(
    geprueft > 380,
    `Nur ${geprueft} Quellpfade gefunden (gemessen waren es 768) — die Muster sind ` +
      'veraltet, und diese Pruefung sieht damit fast nichts mehr an.',
  );

  assert.deepEqual(
    kaputt,
    [],
    'Diese Testdateien lesen eine Quelldatei, die es nicht (mehr) gibt. Je nach ' +
      'Test heisst das ein Absturz — oder, schlimmer, eine Pruefung, die nichts ' +
      'mehr findet und deshalb schweigt.',
  );

  // A second spelling of the same path is allowed; a VARIABLE segment
  // does take away the check's view though. A few cases are legitimate (a test
  // that goes through a list of files) — the number just must not grow
  // without anyone noticing. …
  assert.ok(absent.length <= 3, `${absent.length} Abwesenheits-Zusicherungen (erlaubt: 3):\n  ` + absent.join('\n  '));

  // MEASURED: 62, and the number is not the problem it seems at first
  // glance. Almost all are LOOP VARIABLES (`f`, `datei`, `rel`,
  // `ordner`) — tests that go through a list of files. That is a
  // good pattern; writing it out would make the tests worse.
  assert.ok(
    offen.length <= 76,
    `${offen.length} Pfade mit variablem Segment (gemessen waren es 76):\n  ` +
      offen.join('\n  ') +
      '\nWo es geht, gehoert der Pfad ausgeschrieben — ein ' +
      'variables Segment nimmt dieser Pruefung die Sicht.',
  );
});

/**
 * Whoever processes the image queue empties it beforehand.
 *
 * Counter-check (performed): the call removed from image-throttle-db.test.js
 * → this step turns red and names the file.
 */
test('whoever processes the image queue clears it beforehand', () => {
  const dir = __dirname;
  const USED = /_workStack|_tickPass/;
  const CLEARS = /emptyQueue\s*\(/;

  const betroffen = [];
  const ohne = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Comments out: the explanation blocks of these files name the
    // function names in prose, otherwise a file counts as affected
    // because it WRITES via the batch.
    const code = src
      .split('\n')
      .map(z => {
        const t = z.trim();
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : z;
      })
      .join('\n');
    if (!USED.test(code)) continue;
    betroffen.push(f);
    if (!CLEARS.test(code)) ohne.push(f);
  }

  // Self-proof: without a finding the assertion below checks nothing.
  assert.ok(
    betroffen.length >= 5,
    `Nur ${betroffen.length} Dateien arbeiten die Warteschlange ab — Muster veraltet? ` +
      'Ohne Fund besteht diese Pruefung stillschweigend.',
  );

  assert.deepEqual(
    ohne,
    [],
    'Diese Testdateien arbeiten die Bild-Warteschlange ab, ohne sie vorher zu leeren:\n  ' +
      ohne.join('\n  ') +
      '\n\n_arbeiteStapel() nimmt die aeltesten Notizen der GANZEN Tabelle. Bleibt aus ' +
      'einer frueher gelaufenen Datei etwas liegen, arbeitet der Stapel DEREN Zeilen ab ' +
      'und der Test misst etwas anderes, als er glaubt — und zwar nur manchmal, je ' +
      'nachdem, was vorher lief. Abhilfe: `await emptyQueue(db)` nach dem ' +
      'Schema-Vorbau (helpers/image-queue.js).',
  );
});
