/**
 * Every key the UI calls also stands in the dictionary.
 *
 * Counter-check: `t('zz.missing.key')` appended to public/js/catalog.js → red “every called i18n key is in the dictionary”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadTranslations } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');

/** All source files of the UI — without comments, without the bundle. */
function ui() {
  const out = [];
  const run = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // locales/ itself contains the keys as a definition, not as a call.
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) run(p);
        continue;
      }
      if (!/\.(js|html)$/.test(e.name) || e.name === 'app.bundle.js') continue;
      // Comments out FIRST: i18n.js documents its own usage with
      // `t('key')` in a comment. Without this step the sample call
      // counts as a real location — exactly the trap that
      // test/helpers/sources.js warns about.
      out.push([
        path.relative(ROOT, p),
        fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ]);
    }
  };
  run(path.join(ROOT, 'public'));
  return out;
}

const CALL = /\bt(?:Raw)?\(\s*'([a-z0-9_.]+)'|\bt(?:Raw)?\(\s*"([a-z0-9_.]+)"|data-i18n(?:-tab)?="([a-z0-9_.]+)"/g;

test('every called i18n key is in the dictionary', () => {
  const { de, en } = loadTranslations();
  const existing = new Set([...Object.keys(de), ...Object.keys(en)]);
  assert.ok(existing.size >= 400, `Only ${existing.size} keys loaded — path or format outdated?`);

  const files = ui();
  assert.ok(files.length >= 15, `Only ${files.length} source files found`);

  const called = new Map();
  for (const [rel, src] of files)
    for (const m of src.matchAll(CALL)) {
      const k = m[1] || m[2] || m[3];
      if (!called.has(k)) called.set(k, rel);
    }
  // Self-proof: if the pattern no longer matches, the set would be empty and the
  // test green without having checked anything. MEASURED there are 542.
  assert.ok(called.size >= 300, `Only ${called.size} call sites found — pattern outdated?`);

  // Composed keys (`t('monitor.job.' + k)`) end in a dot.
  const prefixes = [...called.keys()].filter(k => k.endsWith('.'));
  assert.equal(
    prefixes.length,
    1,
    `${prefixes.length} composed keys (${prefixes.join(', ')}) — expected ` +
      'is exactly one (monitor.job.). A second one needs the same safeguard ' +
      'as it: check the result against the key and fall back to something ' +
      'else.',
  );

  const absent = [...called]
    .filter(([k]) => !k.endsWith('.') && !existing.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(
    absent,
    [],
    'The UI calls these keys, but they do not exist:\n  ' +
      absent.join('\n  ') +
      '\nt() then outputs the key itself — visible in the text, in the aria-label ' +
      'the screen reader reads it aloud.',
  );
});

/**
 * And the form of the call?
 */
test('every data-i18n form is also evaluated by applyLang', () => {
  const i18n = fs
    .readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // dataset.i18nAttr → data-i18n-attr; dataset.i18n → data-i18n.
  const allowed = new Set(
    [...i18n.matchAll(/\bdataset\.(i18n[A-Za-z]*)/g)].map(
      m => 'data-' + m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    ),
  );
  assert.ok(
    allowed.size >= 3,
    `Only ${allowed.size} forms found in i18n.js (${[...allowed].join(', ')}) — pattern outdated?`,
  );

  const usedBy = new Map();
  for (const [rel, src] of ui())
    for (const m of src.matchAll(/\b(data-i18n[a-z-]*)\s*=/g)) if (!usedBy.has(m[1])) usedBy.set(m[1], rel);
  // MEASURED there are four forms, 386 occurrences.
  assert.ok(usedBy.size >= 2, `Only ${usedBy.size} data-i18n forms found in the markup`);

  const ineffective = [...usedBy]
    .filter(([f]) => !allowed.has(f))
    .map(([f, rel]) => `${f}   (${rel})`)
    .sort();
  assert.deepEqual(
    ineffective,
    [],
    'applyLang() does not evaluate these data-i18n forms:\n  ' +
      ineffective.join('\n  ') +
      `\nOnly these are evaluated: ${[...allowed].sort().join(', ')}. An attribute that ` +
      'is none of them looks like a translation and leaves the text as it ' +
      'is in the source — in every language.',
  );
});
