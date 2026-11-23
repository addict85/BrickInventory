/**
 * Every path with which a test reads a SOURCE FILE must also point there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Remove comments line by line: a regex would take the /* in '/data/x/*' for a comment. */
function withoutComments(s) {
  const lines = [];
  let inBlock = false;
  for (const z of String(s).split('\n')) {
    const t = z.trim();
    if (inBlock) {
      lines.push('');
      if (t.endsWith('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      lines.push('');
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    lines.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return lines.join('\n');
}

/** Extensions that point to a source file of this tree. */
const SOURCE = /\.(ts|js|sql|html|json|yml|xml)$/;

/**
 * Does this file exist — or the source it is built from?
 */
function existsSource(rel) {
  if (fs.existsSync(path.join(ROOT, rel))) return true;
  if (!rel.endsWith('.js')) return false;
  return fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
}

/** Folders that really exist in the web tree — everything else is not a path from here. */
const FOLDER = ['routes', 'src', 'jobs', 'clients', 'db', 'startup', 'public', 'scripts', 'types'];

test('no test reads a source file that does not exist', () => {
  const files = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();
  assert.ok(files.length > 100, `Only ${files.length} test files found — folder renamed?`);

  const broken = [];
  const open = [];
  const absent = [];
  let checked = 0;

  /**
   * Does the path stand in an ABSENCE assertion?
   */
  const isAbsenceCheck = (src, until) => /!\s*fs\.existsSync\($/.test(src.slice(0, until).trimEnd());

  for (const file of files) {
    const src = withoutComments(fs.readFileSync(path.join(__dirname, file), 'utf8'));

    // ── Form 1: 'src/account/deviceToken.ts' as one string ──────────────────────
    for (const m of src.matchAll(/['"]((?:[\w.-]+\/)+[\w.-]+)['"]/g)) {
      const p = m[1];
      if (!SOURCE.test(p)) continue;
      if (!FOLDER.includes(p.split('/')[0])) continue;
      checked++;
      if (!existsSource(p)) broken.push(`${file}: ${p}`);
    }

    // ── Form 2: path.join(ROOT, 'src/account/deviceToken.ts') ────────────────────────
    for (const m of src.matchAll(/path\.join\(\s*ROOT\s*,([^)]*)\)/g)) {
      const raw = m[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const segmentList = raw.map(s => /^['"]([^'"]*)['"]$/.exec(s)?.[1]);
      if (segmentList.some(s => s === undefined)) {
        // Not resolvable — reported, not skipped.
        open.push(`${file}: ${raw.find((_s, i) => segmentList[i] === undefined)}`);
        continue;
      }
      const p = segmentList.join('/');
      if (!SOURCE.test(p)) continue;
      if (isAbsenceCheck(src, m.index)) {
        absent.push(`${file}: ${p}`);
        continue;
      }
      checked++;
      if (!existsSource(p)) broken.push(`${file}: ${p}`);
    }
  }

  // Self-proof: if the search finds nothing, the assertion below would be
  // silently green. MEASURED there are over a hundred.
  // MEASURED: 768. The threshold is at half — it should catch a broken
  // search expression, not trigger on every new test file.
  assert.ok(
    checked > 380,
    `Only ${checked} source paths found (768 were measured) — the patterns are ` +
      'outdated, and this check then looks at almost nothing.',
  );

  assert.deepEqual(
    broken,
    [],
    'These test files read a source file that does not exist (anymore). Depending on the ' +
      'test that means a crash — or, worse, a check that no longer finds ' +
      'anything and therefore stays silent.',
  );

  // A second spelling of the same path is allowed; a VARIABLE segment
  // does take away the check's view though. A few cases are legitimate (a test
  // that goes through a list of files) — the number just must not grow
  // without anyone noticing. …
  assert.ok(absent.length <= 3, `${absent.length} absence assertions (allowed: 3):\n  ` + absent.join('\n  '));

  // MEASURED: 62, and the number is not the problem it seems at first
  // glance. Almost all are LOOP VARIABLES (`f`, `datei`, `rel`,
  // `ordner`) — tests that go through a list of files. That is a
  // good pattern; writing it out would make the tests worse.
  assert.ok(
    open.length <= 76,
    `${open.length} paths with a variable segment (76 were measured):\n  ` +
      open.join('\n  ') +
      '\nWhere possible, the path belongs spelled out — a ' +
      'variable segment takes away this check’s view.',
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

  const affected = [];
  const without = [];
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
    affected.push(f);
    if (!CLEARS.test(code)) without.push(f);
  }

  // Self-proof: without a finding the assertion below checks nothing.
  assert.ok(
    affected.length >= 5,
    `Only ${affected.length} files process the queue — pattern outdated? ` +
      'Without a match this check passes silently.',
  );

  assert.deepEqual(
    without,
    [],
    `These test files process the image queue without emptying it first:\n  ${without.join('\n  ')}\n\n_arbeiteStapel() takes the oldest notes of the WHOLE table. If something is left over from a file that ran earlier, the batch processes THOSE rows and the test measures something other than it believes — and only sometimes, depending on what ran before. Remedy: \`await emptyQueue(db)\` after the schema setup (helpers/image-queue.js).`,
  );
});
